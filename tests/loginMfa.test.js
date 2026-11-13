import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { SESSION_COOKIE_NAME } from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

// The two-factor login (auth.mfa: 'esup-otp') against a university made up
// here: fetch is replaced for every host but the app's own, by a CAS that
// asks jdoe (password 'right') for a code ('123456'), its portal and its
// Esup OTP API. Nothing leaves the machine.
const realFetch = globalThis.fetch
const config = await loadServerConfig('univ-rennes')
const ENT = config.origins.ent
const CAS = config.origins.cas
const ENTRY = `${ENT}${config.auth.portalEntryPath}`
const API = 'https://esup-otp-api.univ-rennes.fr'

const loginForm = (error = '') => `
  ${error ? `<div class="alert alert-danger">${error}</div>` : ''}
  <form method="post" action="login?service=${encodeURIComponent(ENTRY)}">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="execution" value="e1s1"><input type="hidden" name="_eventId" value="submit">
  </form>`

const codePage = (execution, apiUrl) => `
  <form method="post" id="fm1">
    <input type="hidden" name="_eventId_submit" value="Login" />
    <input type="hidden" name="execution" value="${execution}" />
  </form>
  <script type="module">
    const apiUrl = ${JSON.stringify(apiUrl).replaceAll('/', '\\/')};
    const uid = "jdoe";
    const userHash = "h4sh";
  </script>`

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const redirect = (location) => new Response(null, { status: 302, headers: { location } })

// jdoe at the Esup OTP API: an application, and SMS and mail.
const USER = {
  methods: { totp: { active: true, transports: [] }, random_code: { active: true, transports: ['sms', 'mail'] } },
  transports: { sms: '06******12', mail: 'j***@etudiant.example' },
}
// …or mail alone, as a student who set up nothing else.
const MAIL_ONLY_USER = {
  methods: { totp: { active: false, transports: [] }, random_code: { active: false, transports: ['sms'] }, random_code_mail: { active: true, transports: ['mail'] } },
  transports: { mail: 'j***@etudiant.example' },
}

// `apiUrl`: the API the code page names; `apiStatus`: what it answers with;
// `user`: what it says of jdoe.
function fakeUniversity({ apiUrl = API, apiStatus = 200, user = USER } = {}) {
  const calls = []

  return {
    calls,
    async fetch(input, options = {}) {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, options)

      const method = options.method ?? 'GET'
      const form = new URLSearchParams(typeof options.body === 'string' ? options.body : '')
      calls.push({ method, url, form: Object.fromEntries(form) })

      if (url.startsWith(`${CAS}/login`)) {
        if (method === 'GET') return html(loginForm())
        if (form.has('token')) {
          return form.get('token') === '123456' && form.get('execution') === 'e1s2'
            ? redirect(`${ENTRY}?ticket=ST-1`)
            : html(codePage('e1s3', apiUrl))
        }
        return form.get('username') === 'jdoe' && form.get('password') === 'right'
          ? html(codePage('e1s2', apiUrl))
          : html(loginForm('Identifiants incorrects'), 401)
      }

      if (url === ENTRY) return redirect(`${CAS}/login?service=${encodeURIComponent(ENTRY)}`)
      if (url === `${ENTRY}?ticket=ST-1`) return html('<html>portal</html>')
      if (url === `${ENT}/api/v4-3/dlm/layout.json`) return json({ authenticated: 'true', user: 'jdoe' })

      if (url === `${apiUrl}/users/jdoe/h4sh`) return json({ code: 'Ok', user }, apiStatus)
      if (method === 'POST' && url.startsWith(`${apiUrl}/users/jdoe/methods/`)) return json({ code: 'Ok' }, apiStatus)

      return html('not found', 404)
    },
  }
}

async function withLogin({ university = fakeUniversity(), universityConfig = config } = {}, run) {
  const app = createEntAuthApp(universityConfig, {
    analytics: {},
    session: { secret: 'm'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const warn = console.warn
  globalThis.fetch = university.fetch
  // The ADE bootstrap of a login finds no ADE here, and says so.
  console.warn = () => {}

  const login = async (fields) => {
    const response = await realFetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jdoe', password: 'right', ...fields }),
    })
    return { status: response.status, body: await response.json(), response }
  }

  try {
    await run(login, university)
  } finally {
    globalThis.fetch = realFetch
    console.warn = warn
    server.close()
  }
}

const METHODS = { app: true, sms: '06******12', mail: 'j***@etudiant.example' }
const sends = (university) => university.calls.filter((call) => call.method === 'POST' && call.url.startsWith(API))

test('a right password waits for its code, with what the student can type one from', () => withLogin({}, async (login) => {
  const { status, body } = await login()
  assert.equal(status, 401)
  assert.deepEqual(body, { error: 'MFA required.', code: 'mfa_required', mfa: { methods: METHODS, sent: null } })
}))

test('waiting for a code is not a failed attempt', () => withLogin({}, async (login) => {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    assert.equal((await login()).status, 401)
  }
  assert.equal((await login({ otp: '123456' })).status, 200)
}))

test('the right code signs in, sent as `token` with the code page\'s execution', () => withLogin({}, async (login, university) => {
  const { status, body, response } = await login({ otp: '123 456' })
  assert.equal(status, 200)
  assert.equal(body.authenticated, true)
  assert.equal(body.user, 'jdoe')
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`)))

  const tokenPost = university.calls.find((call) => call.form.token)
  assert.deepEqual(tokenPost.form, { token: '123456', execution: 'e1s2', _eventId: 'submit', geolocation: '' })
  // Typing a code asks the API nothing.
  assert.equal(university.calls.some((call) => call.url.startsWith(API)), false)
}))

test('a refused code says so, and counts as a failed attempt', () => withLogin({}, async (login) => {
  const { status, body } = await login({ otp: '000000' })
  assert.equal(status, 401)
  assert.deepEqual(body, { error: 'Invalid OTP.', code: 'mfa_invalid' })

  for (let attempt = 2; attempt <= 7; attempt += 1) {
    assert.equal((await login({ otp: '000000' })).status, 401)
  }
  assert.equal((await login({ otp: '000000' })).status, 429)
}))

test('a code that is not one never reaches the CAS', () => withLogin({}, async (login, university) => {
  const { status, body } = await login({ otp: 'abc' })
  assert.equal(status, 401)
  assert.equal(body.code, 'mfa_invalid')
  assert.equal(university.calls.length, 0)
}))

test('a wrong password is the CAS\'s own answer, without a code', () => withLogin({}, async (login) => {
  const { status, body } = await login({ password: 'wrong' })
  assert.equal(status, 401)
  assert.deepEqual(body, { error: 'Identifiants incorrects' })
}))

test('a code asked by SMS is sent by the API, once', () => withLogin({}, async (login, university) => {
  const { status, body } = await login({ sendCode: 'sms' })
  assert.equal(status, 401)
  assert.deepEqual(body, { error: 'MFA required.', code: 'mfa_required', mfa: { methods: METHODS, sent: 'sms' } })
  assert.deepEqual(sends(university).map((call) => call.url), [`${API}/users/jdoe/methods/random_code/transports/sms/h4sh`])
}))

test('only SMS and mail can be asked for', () => withLogin({}, async (login, university) => {
  const { body } = await login({ sendCode: 'push' })
  assert.deepEqual(body.mfa, { methods: METHODS, sent: null })
  assert.equal(sends(university).length, 0)
}))

test('five codes sent, then a wait', () => withLogin({}, async (login, university) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await login({ sendCode: 'mail' })).body.mfa.sent, 'mail')
  }

  const blocked = await login({ sendCode: 'mail' })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.code, 'mfa_send_limit')
  assert.ok(Number(blocked.response.headers.get('Retry-After')) > 0)
  assert.equal(sends(university).length, 5)
  // The code step itself still answers.
  assert.equal((await login()).body.code, 'mfa_required')
}))

test('mail as the only way to a code: sent without asking, and said', () => {
  const university = fakeUniversity({ user: MAIL_ONLY_USER })
  return withLogin({ university }, async (login) => {
    const { status, body } = await login()
    assert.equal(status, 401)
    assert.deepEqual(body, {
      error: 'MFA required.',
      code: 'mfa_required',
      mfa: { methods: { app: false, sms: null, mail: 'j***@etudiant.example' }, sent: 'mail' },
    })
    assert.deepEqual(sends(university).map((call) => call.url), [`${API}/users/jdoe/methods/random_code_mail/transports/mail/h4sh?auto`])

    // Typing the code sends no other.
    assert.equal((await login({ otp: '123456' })).status, 200)
    assert.equal(sends(university).length, 1)
  })
})

test('codes sent unasked count too: past five, the step opens without one', () => {
  const university = fakeUniversity({ user: MAIL_ONLY_USER })
  return withLogin({ university }, async (login) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal((await login()).body.mfa.sent, 'mail')
    }

    const { status, body } = await login()
    assert.equal(status, 401)
    assert.equal(body.code, 'mfa_required')
    assert.equal(body.mfa.sent, null)
    assert.equal(sends(university).length, 5)
    assert.equal((await login({ sendCode: 'mail' })).status, 429)
  })
})

test('a code that fails to leave unasked is no error', () => {
  const university = fakeUniversity({ user: MAIL_ONLY_USER })
  const fetchUniversity = university.fetch
  university.fetch = (input, options = {}) => (
    options.method === 'POST' && String(input).startsWith(API)
      ? Promise.resolve(json({ code: 'Error' }, 500))
      : fetchUniversity(input, options)
  )
  return withLogin({ university }, async (login) => {
    const { body } = await login()
    assert.equal(body.code, 'mfa_required')
    assert.deepEqual(body.mfa, { methods: { app: false, sms: null, mail: 'j***@etudiant.example' }, sent: null })
  })
})

test('an API that fails: the code step without its methods, no code sent', () => withLogin({ university: fakeUniversity({ apiStatus: 500 }) }, async (login) => {
  assert.deepEqual((await login()).body, { error: 'MFA required.', code: 'mfa_required', mfa: { methods: null, sent: null } })
  assert.deepEqual((await login({ sendCode: 'sms' })).body, { error: 'Could not send the code.', code: 'mfa_send_failed', mfa: { methods: null, sent: null } })
}))

test('an API off the university\'s hosts is never called', () => {
  const university = fakeUniversity({ apiUrl: 'https://otp.elsewhere.example' })
  return withLogin({ university }, async (login) => {
    assert.deepEqual((await login()).body.mfa, { methods: null, sent: null })
    assert.equal((await login({ sendCode: 'sms' })).body.code, 'mfa_send_failed')
    assert.equal(university.calls.some((call) => call.url.includes('elsewhere.example')), false)
    // The code itself still signs in.
    assert.equal((await login({ otp: '123456' })).status, 200)
  })
})

test('without auth.mfa, a CAS that asks for a code is a failed login', () => {
  const { mfa, ...auth } = config.auth
  assert.equal(mfa, 'esup-otp')
  return withLogin({ universityConfig: { ...config, auth } }, async (login, university) => {
    const { status, body } = await login({ otp: '123456' })
    assert.equal(status, 401)
    assert.deepEqual(body, { error: 'CAS login failed. Check your username and password.' })
    assert.equal(university.calls.some((call) => call.form.token || call.url.startsWith(API)), false)
  })
})

test('auth.mfa is Rennes 1\'s only', async () => {
  for (const id of ['univ-rennes-2', 'univ-exemple', 'example-minimal']) {
    assert.equal((await loadServerConfig(id)).auth.mfa, undefined, id)
  }
})
