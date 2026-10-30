// The domain of a mail's sender, and whether it's the university's own: the
// cue by the sender's name in the mail page's list and reader
// (src/components/mailSender.js).
//
// A display name is whatever the sender chose to write: « Université de
// Rennes » from x@evil.example reads like the real thing in a list of names.
// The address's domain is what the mail actually came from, so the reader
// always shows it next to the name, and the list shows it for any domain that
// isn't the university's: calm for the usual mail, a cue on the odd one.
// Pure functions (no config import) so tests/mailDomain.test.js can run them
// in Node.

// What follows the last « @ », lowercased, without a trailing dot (a fully
// qualified name). '' when there's no domain to speak of.
export function getMailAddressDomain(email) {
  const value = String(email ?? '').trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0) return ''
  return value.slice(at + 1).replace(/\.+$/, '')
}

function hostnameOf(origin) {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// The university's own mail domains: its config's `mail.ownDomains`
// (universities/<id>/client.js), else the domains of its sites (`origins`:
// the portal, the CAS, Moodle) cut to their last two labels
// (services-numeriques.univ-rennes.fr → univ-rennes.fr), good enough for a
// French university's .fr. None (the neutral config): every domain is shown.
export function resolveOwnMailDomains(config) {
  const listed = Array.isArray(config?.mail?.ownDomains) ? config.mail.ownDomains : []
  const domains = listed.length
    ? listed.map((domain) => String(domain ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    : Object.values(config?.origins ?? {})
      .map(hostnameOf)
      .filter((hostname) => hostname.includes('.') && !/^[\d.]+$/.test(hostname))
      .map((hostname) => hostname.split('.').slice(-2).join('.'))
  return [...new Set(domains.filter(Boolean))]
}

// The domain is one of `ownDomains` or under one (etudiant.univ-rennes.fr,
// listes.etudiant.univ-rennes.fr). Matched on whole labels: neither
// univ-rennes.fr.evil.example nor evil-univ-rennes.fr passes.
export function isOwnMailDomain(domain, ownDomains) {
  const value = String(domain ?? '').toLowerCase()
  if (!value) return false
  return ownDomains.some((own) => value === own || value.endsWith(`.${own}`))
}
