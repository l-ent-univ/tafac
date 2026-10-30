import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import {
  buildCustomSignatureRequest,
  findCustomSignature,
  frameSignature,
  pickPartageSignature,
  plainSignatureToHtml,
  readSignatureContent,
  readZimbraSignatures,
  sanitizeSignatureHtml,
  signatureHtmlToText,
} from '../server/mailSignature.js'
import { buildMailSignature, normalizeComposePayload, readIdentitySignatureIds } from '../server/mailSend.js'
import { isValidMailMessageId } from '../server/mailMessage.js'
import { isValidZimbraUploadId } from '../server/mailUpload.js'
import {
  CUSTOM_SIGNATURE_MAX_LENGTH,
  normalizeCustomSignatureText,
  pickShownSignature,
  plainSignatureHtml,
  readMailSignatures,
  signatureLogin,
} from '../src/mailSignatureChoice.js'
import { buildComposePayload } from '../src/mailSendPayload.js'
import { loadServerConfig } from '../universities/index.js'

const ids = { isValidMessageId: isValidMailMessageId, isValidUploadId: isValidZimbraUploadId }

// ── The webmail's answers ──

test('GetSignatures: both content shapes, ids checked, names cleaned', () => {
  const signatures = readZimbraSignatures({
    signature: [
      { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: ' Pro\n ', content: [{ type: 'text/html', _content: '<div><b>Camille</b></div>' }, { type: 'text/plain', _content: 'Camille' }] },
      { id: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Tafac', content: { type: 'text/plain', _content: 'Camille\r\nMMI 2​  \n\n\n\nfin' } },
      { id: '<script>', name: 'x', content: [] },
      { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'twice', content: [] },
      { name: 'no id' },
    ],
  })
  assert.deepEqual(signatures.map((entry) => [entry.id.slice(-1), entry.name]), [['1', 'Pro'], ['2', 'Tafac']])
  assert.deepEqual(signatures[0], { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Pro', html: '<div><b>Camille</b></div>', text: 'Camille', hasImages: false })
  // A text one: its lines, tidied, as HTML too (escaped).
  assert.equal(signatures[1].text, 'Camille\nMMI 2\n\nfin')
  assert.equal(signatures[1].html, '<div>Camille</div><div>MMI 2</div><div><br /></div><div>fin</div>')
  assert.equal(findCustomSignature(signatures).id.slice(-1), '2')
  // A lone signature, not a list; nothing at all.
  assert.equal(readZimbraSignatures({ signature: { id: 'abc', name: 'Seule', content: { type: 'text/plain', _content: 'x' } } }).length, 1)
  assert.deepEqual(readZimbraSignatures(null), [])
  assert.deepEqual(readZimbraSignatures({ signature: 'nope' }), [])
})

test('a webmail signature\'s HTML: a tight allowlist, no image, no script', () => {
  const { html, hasImages } = sanitizeSignatureHtml(`
    <div><br></div>
    <table><tr><td><img src="https://tracker.example/x.png"><img src="data:image/png;base64,AAAA"></td><td><strong style="color:#123456;background:url(https://x)">Camille</strong></td></tr></table>
    <p style="font-size:12px;position:fixed;font-family:Comic">BUT <font color="red" face="x">MMI</font></p>
    <a href="javascript:alert(1)">piège</a> <a href="https://iut.fr" onclick="x()" style="color:red">site</a> <a href="mailto:c@u.fr">c@u.fr</a>
    <script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe>
    <span class="x" id="y" style="font-weight:bold;color:expression(alert(1))">gras</span>
    <div><br></div><p>&nbsp;</p>`)
  assert.equal(hasImages, true)
  assert.doesNotMatch(html, /<img|<script|<style|<iframe|<table|<td|<font|javascript:|onclick|class=|id=|url\(|position|font-family|expression/i)
  assert.match(html, /<strong style="color:#123456">Camille<\/strong>/)
  assert.match(html, /<p style="font-size:12px">BUT <span style="color:red">MMI<\/span><\/p>/)
  assert.match(html, /<a>piège<\/a> <a href="https:\/\/iut.fr">site<\/a> <a href="mailto:c@u.fr">c@u.fr<\/a>/)
  assert.match(html, /<span style="font-weight:bold">gras<\/span>/)
  // The empty lines around it go.
  assert.doesNotMatch(html, /^<div><br \/><\/div>|<p>&nbsp;<\/p>$/)
  assert.ok(html.startsWith('<div><div><div>'))
})

test('a signature\'s text version: lines, lists, links', () => {
  const clean = sanitizeSignatureHtml('<div><b>Camille Martin</b><br>BUT MMI</div><p>Voir <a href="https://iut.fr/mmi">le site</a> · <a href="https://iut.fr">https://iut.fr</a> · <a href="mailto:c@u.fr">c@u.fr</a></p><ul><li>un</li><li>deux &amp; trois</li></ul>').html
  assert.equal(signatureHtmlToText(clean), 'Camille Martin\nBUT MMI\nVoir le site (https://iut.fr/mmi) · https://iut.fr · c@u.fr\n- un\n- deux & trois')
  assert.equal(plainSignatureToHtml('<b>x</b> & "y"\n\nz'), '<div>&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</div><div><br /></div><div>z</div>')
})

test('a signature\'s content: HTML too long or empty gives way to its text, the text capped', () => {
  const long = `<div>${'<b>x</b>'.repeat(4000)}</div>`
  const fallback = readSignatureContent({ html: long, text: 'Camille' })
  assert.deepEqual(fallback, { html: '<div>Camille</div>', text: 'Camille', hasImages: false })
  assert.equal(readSignatureContent({ html: '<img src="https://x/y.png">', text: 'Juste du texte' }).text, 'Juste du texte')
  assert.equal(readSignatureContent({ text: 'y'.repeat(9000) }).text.length, 4000)
  assert.deepEqual(readSignatureContent({}), { html: '', text: '', hasImages: false })
})

test('the identities\' signatures: both attribute shapes, the webmail\'s « none »', () => {
  const map = readIdentitySignatureIds({
    identity: [
      { id: 'acc-1', name: 'DEFAULT', _attrs: { zimbraPrefDefaultSignatureId: 'sig-1', zimbraPrefForwardReplySignatureId: 'sig-2' } },
      { id: 'per-1', name: 'Perso', a: [{ n: 'zimbraPrefDefaultSignatureId', _content: '11111111-1111-1111-1111-111111111111' }, { n: 'zimbraPrefForwardReplySignatureId', _content: '<bad>' }] },
    ],
  })
  assert.deepEqual(map.get('acc-1'), { signatureId: 'sig-1', replySignatureId: 'sig-2' })
  assert.deepEqual(map.get('per-1'), { signatureId: '11111111-1111-1111-1111-111111111111', replySignatureId: null })
  assert.equal(readIdentitySignatureIds(null).size, 0)

  const signatures = [
    { id: 'sig-tafac', name: 'Tafac', text: 'mine' },
    { id: 'sig-1', name: 'Nouveau', text: 'new' },
    { id: 'sig-2', name: 'Réponse', text: 'reply' },
  ]
  assert.equal(pickPartageSignature(signatures, map.get('acc-1')).id, 'sig-1')
  assert.equal(pickPartageSignature(signatures, map.get('acc-1'), { reply: true }).id, 'sig-2')
  // « None » or nothing set: their first besides Tafac's.
  assert.equal(pickPartageSignature(signatures, map.get('per-1')).id, 'sig-1')
  assert.equal(pickPartageSignature(signatures, { signatureId: 'gone', replySignatureId: null }).id, 'sig-1')
  assert.equal(pickPartageSignature(signatures.slice(0, 1), null), null)
  assert.equal(pickPartageSignature([], null), null)
})

// ── The custom signature, written ──

test('the custom signature\'s text: tidied, capped, refused past the limit', () => {
  assert.deepEqual(normalizeCustomSignatureText('\n\n  Camille  \r\nMMI\t2\u0007\n\n\n\nfin  \n'), { ok: true, text: '  Camille\nMMI 2\n\nfin' })
  assert.deepEqual(normalizeCustomSignatureText(''), { ok: true, text: '' })
  assert.deepEqual(normalizeCustomSignatureText(42), { ok: false, error: 'mail_signature_invalid' })
  assert.deepEqual(normalizeCustomSignatureText(null), { ok: false, error: 'mail_signature_invalid' })
  assert.equal(normalizeCustomSignatureText('x'.repeat(CUSTOM_SIGNATURE_MAX_LENGTH)).ok, true)
  assert.deepEqual(normalizeCustomSignatureText('x'.repeat(CUSTOM_SIGNATURE_MAX_LENGTH + 1)), { ok: false, error: 'mail_signature_too_long' })
  assert.deepEqual(normalizeCustomSignatureText(Array.from({ length: 31 }, () => 'l').join('\n')), { ok: false, error: 'mail_signature_too_long' })
})

test('the custom signature\'s write: only Tafac\'s, by its id', () => {
  const existing = { id: 'sig-tafac', name: 'Tafac' }
  assert.deepEqual(buildCustomSignatureRequest('Camille <3', null), {
    name: 'CreateSignatureRequest',
    body: { signature: { name: 'Tafac', content: [{ type: 'text/plain', _content: 'Camille <3' }, { type: 'text/html', _content: '<div>Camille &lt;3</div>' }] } },
  })
  assert.deepEqual(buildCustomSignatureRequest('x', existing).body.signature.id, 'sig-tafac')
  assert.equal(buildCustomSignatureRequest('x', existing).name, 'ModifySignatureRequest')
  assert.deepEqual(buildCustomSignatureRequest('', existing), { name: 'DeleteSignatureRequest', body: { signature: { id: 'sig-tafac' } } })
  assert.equal(buildCustomSignatureRequest('', null), null)
})

// ── In the mail sent ──

test('the student\'s signature in the mail: framed, styles inline, « -- » before its text', () => {
  const framed = frameSignature({ html: '<p>Camille</p><a href="https://iut.fr">site</a>', text: 'Camille\nsite (https://iut.fr)' })
  assert.match(framed.html, /^<div style="margin:14px 0 6px;font-size:14px;line-height:1.45;color:#1d1d1f"><p style="margin:0">Camille<\/p><a href="https:\/\/iut.fr" style="color:#1a73e8">site<\/a><\/div>$/)
  assert.equal(framed.text, '-- \nCamille\nsite (https://iut.fr)')
  assert.equal(frameSignature({ html: '<div>x</div>', text: '--\nx' }).text, '--\nx')
  assert.deepEqual(frameSignature(null), { html: '', text: '' })
})

test('the automatic signature\'s login: checked, escaped, never an address', () => {
  const built = buildMailSignature({ name: 'Camille Martin', login: 'e2101234', university: 'Université Rennes 2', establishment: 'Université Rennes 2' })
  assert.match(built.html, /<div>Identifiant : e2101234<\/div>/)
  assert.equal(built.text, '-- \nCamille Martin\nIdentifiant : e2101234\nUniversité Rennes 2')
  for (const login of ['camille@univ-rennes2.fr', '<b>x</b>', 'a'.repeat(33), '', null, 42]) {
    const other = buildMailSignature({ name: 'Camille Martin', login })
    assert.doesNotMatch(other.html, /Identifiant/)
    assert.equal(other.text, '-- \nCamille Martin')
  }
  assert.equal(signatureLogin(' e2101234 '), 'e2101234')
  assert.equal(signatureLogin('prenom.nom-2_x'), 'prenom.nom-2_x')
  assert.equal(signatureLogin('a@b'), null)
})

test('the payload: the signature\'s kind, checked; the automatic one\'s choices only for it', () => {
  const base = { to: [{ email: 'leo@univ.fr' }], sendUid: 'uid-00000001' }
  const read = (signature) => normalizeComposePayload({ ...base, signature }, ids)
  assert.deepEqual(read({ include: true }).value.signature, { include: true, mode: 'auto', group: '', establishment: null })
  assert.deepEqual(read({ include: true, mode: 'partage', group: 'MMI', establishment: 'iutlan', html: '<b>x</b>' }).value.signature, { include: true, mode: 'partage', group: '', establishment: null })
  assert.equal(read({ include: true, mode: 'custom' }).value.signature.mode, 'custom')
  assert.deepEqual(read({ include: true, mode: 'html' }), { ok: false, error: 'mail_send_invalid' })
  assert.deepEqual(read({ include: true, mode: ['auto'] }), { ok: false, error: 'mail_send_invalid' })
  // The page's side.
  const payload = buildComposePayload({ to: [], cc: [], bcc: [], subject: '', html: '', attachments: [], signature: { include: true, mode: 'partage' } })
  assert.deepEqual(payload.signature, { include: true, mode: 'partage' })
  assert.deepEqual(buildComposePayload({ signature: { include: true, mode: 'evil' } }).signature, { include: true })
})

test('the page\'s copy of the signatures: checked, and the one a draft shows', () => {
  const data = readMailSignatures({
    signatures: [
      { id: 'sig-1', name: 'Pro', html: '<div>Pro</div>', text: 'Pro', hasImages: true },
      { id: 'sig-2', name: 'Réponse', html: '<div>Re</div>', text: 'Re' },
      { id: 'sig-t', name: 'Tafac', html: '<div>Moi</div>', text: 'Moi' },
      { id: '<x>', name: 'bad' },
    ],
    identities: [{ id: 'acc', signatureId: 'sig-1', replySignatureId: 'sig-2' }, { id: 'perso', signatureId: 'unknown', replySignatureId: null }],
    customId: 'sig-t',
    maxLength: 999_999,
  })
  assert.equal(data.signatures.length, 3)
  assert.equal(data.maxLength, CUSTOM_SIGNATURE_MAX_LENGTH)
  assert.deepEqual(data.identities[1], { id: 'perso', signatureId: null, replySignatureId: null })
  assert.equal(pickShownSignature(data, 'partage').id, 'sig-1')
  assert.equal(pickShownSignature(data, 'partage', { identityId: 'acc', reply: true }).id, 'sig-2')
  assert.equal(pickShownSignature(data, 'partage', { identityId: 'perso' }), null)
  assert.equal(pickShownSignature(data, 'custom').id, 'sig-t')
  assert.equal(pickShownSignature(data, 'auto'), null)
  assert.equal(pickShownSignature(null, 'custom'), null)
  assert.deepEqual(readMailSignatures(null), { signatures: [], identities: [], customId: null, maxLength: CUSTOM_SIGNATURE_MAX_LENGTH })
  assert.equal(plainSignatureHtml('<i>a</i>\n'), '<div>&lt;i&gt;a&lt;/i&gt;</div><div><br></div>')
})

// ── The routes, on the demo account (nothing leaves) ──

async function withApp(universityId, run) {
  const config = await loadServerConfig(universityId)
  const app = createEntAuthApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false } })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
  })
  const cookie = response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ')
  try {
    await run({ base, cookie })
  } finally {
    server.close()
  }
}

const call = (base, path, { cookie, body, headers = {} } = {}) => fetch(`${base}/__ent_auth/mail/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json() }))

async function lastSentHtml(base, cookie) {
  const sent = await call(base, 'recent?folder=5', { cookie })
  return (await call(base, `message?id=${sent.body.mail.messages[0].id}`, { cookie })).body.message.html
}

test('the signature routes: the demo\'s Partage one, its custom one in memory, the sends', () => withApp('univ-rennes', async ({ base, cookie }) => {
  assert.equal((await call(base, 'signatures')).status, 401)
  assert.equal((await call(base, 'signatures', { cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  const listed = await call(base, 'signatures', { cookie })
  assert.equal(listed.status, 200)
  assert.equal(listed.headers.get('cache-control'), 'no-store')
  assert.equal(listed.body.customId, null)
  assert.deepEqual(listed.body.identities.map((entry) => entry.signatureId), ['demo-signature-partage', 'demo-signature-partage'])
  const partage = listed.body.signatures[0]
  assert.equal(partage.hasImages, true)
  assert.doesNotMatch(partage.html, /<img/)

  // Writes: refused cross-site, without a session, malformed, too long.
  assert.equal((await call(base, 'signature', { body: { text: 'x' } })).status, 401)
  assert.equal((await call(base, 'signature', { cookie, body: { text: 'x' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.deepEqual((await call(base, 'signature', { cookie, body: { text: 42 } })).body, { error: 'mail_signature_invalid' })
  const tooLong = await call(base, 'signature', { cookie, body: { text: 'x'.repeat(2001) } })
  assert.deepEqual([tooLong.status, tooLong.body], [413, { error: 'mail_signature_too_long' }])
  const written = await call(base, 'signature', { cookie, body: { text: 'Camille <b>M.</b>\nMMI 2' } })
  assert.equal(written.status, 200)
  assert.equal(written.body.customId, 'demo-signature-tafac')
  const custom = written.body.signatures.find((entry) => entry.id === written.body.customId)
  assert.equal(custom.html, '<div>Camille &lt;b&gt;M.&lt;/b&gt;</div><div>MMI 2</div>')

  // Sends: the server's own copy of each kind, whatever the page says.
  const mail = { to: [{ email: 'leo@univ.fr' }], subject: 'Objet', html: '<p>x</p><div data-mail-signature=""></div>' }
  let uid = 0
  const send = (signature) => call(base, 'send', { cookie, body: { ...mail, sendUid: `uid-sig-0000${(uid += 1)}`, signature } })
  assert.equal((await send({ include: true, mode: 'custom', html: '<script>x</script>' })).status, 200)
  let html = await lastSentHtml(base, cookie)
  assert.match(html, /Camille &lt;b&gt;M\.&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script|IUT de Lannion/)
  assert.equal((await send({ include: true, mode: 'partage' })).status, 200)
  html = await lastSentHtml(base, cookie)
  assert.match(html, /<strong>Camille Martin<\/strong>/)
  assert.doesNotMatch(html, /<img|Identifiant/)
  assert.equal((await send({ include: true, mode: 'auto', establishment: 'iutlan' })).status, 200)
  html = await lastSentHtml(base, cookie)
  assert.match(html, /IUT de Lannion/)
  // Rennes doesn't show the login.
  assert.doesNotMatch(html, /Identifiant/)
  assert.equal((await send({ include: true, mode: 'nope' })).status, 400)

  // Emptied: gone.
  const removed = await call(base, 'signature', { cookie, body: { text: '  \n ' } })
  assert.equal(removed.body.customId, null)

  // The writes' own limit: 10 a minute (two counted above).
  const statuses = []
  for (let index = 0; index < 9; index += 1) statuses.push((await call(base, 'signature', { cookie, body: { text: `v${index}` } })).status)
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 429])
}))

test('the automatic signature names the CAS login where the university asks (Rennes 2), from the session', () => withApp('univ-rennes-2', async ({ base, cookie }) => {
  const mail = { to: [{ email: 'leo@univ.fr' }], subject: 'Objet', html: '<p>x</p><div data-mail-signature=""></div>' }
  const sent = await call(base, 'send', { cookie, body: { ...mail, sendUid: 'uid-login-0001', signature: { include: true, establishment: 'rennes2', login: 'someone-else' } } })
  assert.equal(sent.status, 200)
  const html = await lastSentHtml(base, cookie)
  assert.match(html, /Identifiant : demo/)
  assert.doesNotMatch(html, /someone-else/)
}))
