import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchEsupOtpChannels, pickEsupOtpAutoTransport, readEsupOtpChannels, readEsupOtpPage, sendEsupOtpCode } from '../server/esupOtp.js'

const PAGE = { apiUrl: 'https://otp.univ.example', uid: 'jdoe', userHash: 'h4sh' }

test('the code page of esup-otp-cas 2.x: constants of its module script, as Thymeleaf escapes them', () => {
  const html = `
    <form method="post" id="fm1">
      <input type="hidden" name="_eventId_submit" value="Login" />
      <input type="hidden" name="execution" value="e1s2" />
    </form>
    <script type="module">
      const apiUrl = "https:\\/\\/otp.univ.example\\/";
      const uid = "jdoe";
      const userHash = "h4sh";
      const otpManagerUrl = "https:\\/\\/otp-manager.univ.example";
    </script>`
  assert.deepEqual(readEsupOtpPage(html), PAGE)
})

test('the code page of esup-otp-cas 1.x: `var`, or the hidden fields of its transport form', () => {
  const script = `<script>var apiUrl = "https://otp.univ.example"; var uid = 'jdoe'; var userHash = 'h4sh';</script>`
  assert.deepEqual(readEsupOtpPage(script), PAGE)

  const fields = `
    <script>var apiUrl = "https://otp.univ.example";</script>
    <input type="hidden" name="uid" value="jdoe" id="inputUid" />
    <input type="hidden" id="inputUserHash" value="h4sh" name="userHash" />`
  assert.deepEqual(readEsupOtpPage(fields), PAGE)
})

test('the older code page: data attributes', () => {
  const html = '<div id="data" data-apiurl="https://otp.univ.example" data-userhash="h4sh" data-uid="jdoe"></div>'
  assert.deepEqual(readEsupOtpPage(html), PAGE)
})

test('escapes of a script constant: \\x, \\u and quotes', () => {
  const html = String.raw`<script>const apiUrl = "https:\x2F\x2Fotp.univ.example"; const uid = "jér\"me"; const userHash = "a\\b";</script>`
  assert.deepEqual(readEsupOtpPage(html), { apiUrl: 'https://otp.univ.example', uid: 'jér"me', userHash: 'a\\b' })
})

test('not an Esup OTP page: null', () => {
  assert.equal(readEsupOtpPage('<form><input name="username"><input type="password" name="password"></form>'), null)
  assert.equal(readEsupOtpPage('<script>const apiUrl = "https://otp.univ.example"; const uid = "jdoe";</script>'), null)
  assert.equal(readEsupOtpPage(null), null)
})

test('channels: the application, and SMS and mail where a method sends there', () => {
  const channels = readEsupOtpChannels({
    methods: {
      totp: { active: true, transports: [] },
      random_code: { active: true, transports: ['sms', 'mail'] },
      push: { active: true, transports: ['push'] },
    },
    transports: { sms: '06******12', mail: 'j***@univ.example', push: 'Apple iPhone' },
  })
  assert.deepEqual(channels, {
    app: true,
    sms: { method: 'random_code', to: '06******12' },
    mail: { method: 'random_code', to: 'j***@univ.example' },
  })
})

test('channels: the mail-only method, an inactive one, a transport with nowhere to send', () => {
  assert.deepEqual(readEsupOtpChannels({
    methods: {
      totp: { active: false, transports: [] },
      random_code: { active: false, transports: ['sms', 'mail'] },
      random_code_mail: { active: true, transports: ['mail'] },
    },
    transports: { sms: '06******12', mail: 'j***@univ.example' },
  }), { app: false, sms: null, mail: { method: 'random_code_mail', to: 'j***@univ.example' } })

  assert.deepEqual(readEsupOtpChannels({
    methods: { random_code: { active: true, transports: ['sms', 'mail'] } },
    transports: { sms: '', mail: null },
  }), { app: false, sms: null, mail: null })

  assert.deepEqual(readEsupOtpChannels(undefined), { app: false, sms: null, mail: null })
})

test('a code goes unasked by the only way to one', () => {
  const sms = { method: 'random_code', to: '06******12' }
  const mail = { method: 'random_code_mail', to: 'j***@univ.example' }
  assert.equal(pickEsupOtpAutoTransport({ app: false, sms: null, mail }), 'mail')
  assert.equal(pickEsupOtpAutoTransport({ app: false, sms, mail: null }), 'sms')
  // A choice to make, an application, nothing at all, or no answer: none.
  assert.equal(pickEsupOtpAutoTransport({ app: false, sms, mail }), '')
  assert.equal(pickEsupOtpAutoTransport({ app: true, sms: null, mail }), '')
  assert.equal(pickEsupOtpAutoTransport({ app: false, sms: null, mail: null }), '')
  assert.equal(pickEsupOtpAutoTransport(null), '')
})

function fakeFetch(answer, status = 200) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

test('the API: the student by uid and hash, each escaped', async () => {
  const { calls, fetchImpl } = fakeFetch({ code: 'Ok', user: { methods: { totp: { active: true } }, transports: {} } })
  const channels = await fetchEsupOtpChannels({ ...PAGE, uid: 'j/doe' }, { fetch: fetchImpl })
  assert.deepEqual(channels, { app: true, sms: null, mail: null })
  assert.deepEqual(calls, [{ url: 'https://otp.univ.example/users/j%2Fdoe/h4sh', method: 'GET' }])
})

test('the API: a code sent by the channel\'s method', async () => {
  const { calls, fetchImpl } = fakeFetch({ code: 'Ok' })
  await sendEsupOtpCode(PAGE, { method: 'random_code', to: '06******12' }, 'sms', { fetch: fetchImpl })
  await sendEsupOtpCode(PAGE, { method: 'random_code_mail', to: 'j***@univ.example' }, 'mail', { fetch: fetchImpl, auto: true })
  assert.deepEqual(calls, [
    { url: 'https://otp.univ.example/users/jdoe/methods/random_code/transports/sms/h4sh', method: 'POST' },
    { url: 'https://otp.univ.example/users/jdoe/methods/random_code_mail/transports/mail/h4sh?auto', method: 'POST' },
  ])
})

test('the API: an answer that is not "Ok" is an error', async () => {
  await assert.rejects(fetchEsupOtpChannels(PAGE, { fetch: fakeFetch({ code: 'Error' }).fetchImpl }), /Esup OTP API/)
  await assert.rejects(sendEsupOtpCode(PAGE, { method: 'random_code' }, 'sms', { fetch: fakeFetch({ code: 'Ok' }, 500).fetchImpl }), /500/)
})
