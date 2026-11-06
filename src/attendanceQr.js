// The attendance QR of an APSOLU site (SIUAPS): a link whose visit, signed
// in, records the presence. Only that link is accepted, rebuilt from its
// keycode: a QR is untrusted input, so anything else on it is dropped.
// Pure, see tests/attendanceQr.test.js. Returns the link, or null.
const QR_PATH = '/local/apsolu/attendance/qrcode.php'

export function parseAttendanceQr(text, origin) {
  if (typeof text !== 'string' || !origin) return null

  let url = null
  try {
    url = new URL(text)
  } catch {
    return null
  }

  const keycode = url.searchParams.get('keycode')
  if (url.origin !== origin || url.pathname !== QR_PATH || !keycode) return null
  return `${origin}${QR_PATH}?keycode=${encodeURIComponent(keycode)}`
}
