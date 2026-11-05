import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { parseAttendanceQr } from '../src/attendanceQr.js'
import { loadServerConfig } from '../universities/index.js'

const ORIGIN = 'https://sport.example'
const QR = `${ORIGIN}/local/apsolu/attendance/qrcode.php?keycode=abc123`

test('the attendance link passes, rebuilt from its keycode alone', () => {
  assert.equal(parseAttendanceQr(QR, ORIGIN), QR)
  assert.equal(parseAttendanceQr(`${QR}&next=https://evil.example#x`, ORIGIN), QR)

  const encoded = `${ORIGIN}/local/apsolu/attendance/qrcode.php?keycode=a%2Bb%3D`
  assert.equal(parseAttendanceQr(encoded, ORIGIN), encoded)
})

test('anything else is refused', () => {
  for (const text of [
    'https://evil.example/local/apsolu/attendance/qrcode.php?keycode=abc',
    'https://sport.example.evil.example/local/apsolu/attendance/qrcode.php?keycode=abc',
    'http://sport.example/local/apsolu/attendance/qrcode.php?keycode=abc',
    `${ORIGIN}/login/index.php?keycode=abc`,
    `${ORIGIN}/local/apsolu/attendance/qrcode.php?id=3`,
    `${ORIGIN}/local/apsolu/attendance/qrcode.php?keycode=`,
    'pas une adresse',
    '',
    undefined,
    ['a', 'b'],
  ]) {
    assert.equal(parseAttendanceQr(text, ORIGIN), null, String(text))
  }

  assert.equal(parseAttendanceQr(QR, null), null)
})

async function withApp(universityId, run) {
  const app = createEntAuthApp(await loadServerConfig(universityId), {
    analytics: {},
    session: { secret: 'b'.repeat(44), production: false },
  })
  const server = app.listen(0)
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.close()
  }
}

const open = (base, url, cookie = '') => fetch(
  `${base}/__ent_auth/attendance/open?url=${encodeURIComponent(url)}`,
  { redirect: 'manual', headers: { cookie } },
)

test('the route refuses a foreign link, and hands a signed-out or demo student the QR page', () => withApp('univ-rennes', async (base) => {
  const qr = 'https://mon-espace.siuaps.univ-rennes.fr/local/apsolu/attendance/qrcode.php?keycode=abc'
  const login = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
  })
  const demoCookie = login.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')

  assert.equal((await open(base, 'https://evil.example/')).headers.get('location'), '/')
  assert.equal((await open(base, qr)).headers.get('location'), qr)
  assert.equal((await open(base, qr, demoCookie)).headers.get('location'), qr)
}))

test('a university without the feature has no such route', () => withApp('univ-exemple', async (base) => {
  assert.equal((await open(base, 'https://x.example/')).status, 404)
}))
