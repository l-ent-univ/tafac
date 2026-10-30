import universityConfig from '@university'
import { getCachedAppIcons } from '../appIcons'
import { getMailAddressDomain, isOwnMailDomain, resolveOwnMailDomains } from '../mailDomain'

// The sender's badge, in the mail list (MailPage) and the reader
// (MailReader): their first letter on a colour of their own. And the
// domain shown by their name (src/mailDomain.js).

// Read once: the config is filled before the app's modules load and never
// changes after (src/university.js).
const OWN_MAIL_DOMAINS = resolveOwnMailDomains(universityConfig)

// The domain to show next to a sender's name, « @domain »: what the mail
// really came from, whatever name it gives. `always`: the reader's header,
// which shows it for every sender; otherwise (the list, a thread's folded
// mails) only for a domain that isn't the university's. Null when there is
// no name (the address itself is shown then) or no domain.
export function getSenderDomainCue(address, { always = false } = {}) {
  const email = address?.email?.trim() || ''
  const name = address?.name?.trim() || ''
  const domain = getMailAddressDomain(email)
  if (!domain || !name || name.toLowerCase() === email.toLowerCase()) return null
  if (!always && isOwnMailDomain(domain, OWN_MAIL_DOMAINS)) return null
  return `@${domain}`
}

// The sender's first letter, for the square badge before the name.
export function getSenderInitial(label) {
  return label.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? '?'
}

// FNV-1a, like the server's pick of the app tiles' colours.
function hashString(value) {
  let hash = 0x811c9dc5
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// The badge takes a hue of the app tiles' palette (the university's colour
// mode, light and dark), the same one for every mail of a sender. No palette
// cached yet (apps never loaded): a neutral badge.
export function getSenderBadgeStyle(key) {
  const { palette } = getCachedAppIcons()
  const hues = Object.keys(palette)
  const colors = hues.length ? palette[hues[hashString(key) % hues.length]] : null
  if (!colors?.light || !colors?.dark) return null
  return {
    '--app-tile-bg': colors.light.bg,
    '--app-tile-fg': colors.light.fg,
    '--app-tile-bg-dark': colors.dark.bg,
    '--app-tile-fg-dark': colors.dark.fg,
  }
}
