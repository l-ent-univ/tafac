// Text helpers the mail modules share, on the page (src/mail*.js) and on
// the server (server/mailSend.js, mailSignature.js, mailMessage.js,
// portalSession.js) alike: one copy, so a fix lands everywhere.

// Control and format characters (CR, LF, tabs, NUL, the bidi overrides that
// can turn « moc.vinu » or « gpj.exe » around…), private-use and unassigned
// ones, the line and paragraph separators. Global: for replace() only.
export const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu

// A name as it came in a received mail (a sender, a file), safe to show:
// without the control characters, nor the ones that change the direction of
// what follows (« rapport‮fdp.exe » would read « rapportexe.pdf »). The
// joiners of emoji and scripts stay, unlike with CONTROL_CHARACTERS.
const DIRECTION_CHARACTERS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/gu

export const cleanReceivedName = (name) => String(name ?? '').replace(DIRECTION_CHARACTERS, '').trim()

// At most `max` characters, never cutting a surrogate pair in half.
export const capLength = (text, max) => (text.length > max ? Array.from(text).slice(0, max).join('') : text)

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// Text (or nothing) safe in HTML, as text or as a quoted attribute's value.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

// HTML's character references in text: numeric ones (a code point out of
// Unicode's range, or 0, dropped), and the few named ones mail and portal
// pages use; any other left as written. One pass: « &amp;lt; » is « &lt; ».
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[name.toLowerCase()] ?? match
  })
}

// Lines of text as a signature keeps them: NFC, Unix line breaks, a tab a
// space, no control characters, no spaces at a line's end, no empty lines
// around them nor more than one in a row.
export function cleanTextLines(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(CONTROL_CHARACTERS, '').replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
