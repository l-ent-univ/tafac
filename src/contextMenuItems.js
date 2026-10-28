// The items of the app's right-click menus (ContextMenu) that several places
// share: a link, a text selection, an e-mail address, and the text « Copier »
// puts on the clipboard for a class or a grade. Pure (the actions come in as
// callbacks), see tests/contextMenuItems.test.js.

// A menu as a place gives it: an array of items, or { items, title, label },
// or nothing. Always { items, title, label }; null when there's nothing.
export function normalizeMenu(menu) {
  if (!menu) return null
  const value = Array.isArray(menu) ? { items: menu } : menu
  const items = tidySeparators(value.items ?? [])
  if (!items.some((item) => item !== 'separator')) return null
  return { items, title: value.title ?? null, label: value.label ?? null }
}

// No separator at either end, nor two in a row: a group left empty (an
// action that doesn't apply here) leaves no gap behind.
export function tidySeparators(items) {
  const tidy = []
  for (const item of items) {
    if (!item) continue
    if (item === 'separator' && (tidy.length === 0 || tidy[tidy.length - 1] === 'separator')) continue
    tidy.push(item)
  }
  while (tidy[tidy.length - 1] === 'separator') tidy.pop()
  return tidy
}

// What a link is, from its attributes: 'mail' (mailto:, its address),
// 'download' (a file the link saves), 'web' (http(s), relative or not), or
// null (javascript:, blob: and the like: the browser's own menu).
// `newTab`: it opens in another tab already (target="_blank").
export function describeLink({ href, target = '', download = null }) {
  const value = String(href ?? '').trim()
  if (!value || value.startsWith('#')) return null
  if (/^mailto:/i.test(value)) {
    const address = decodeMailto(value)
    return address ? { kind: 'mail', href: value, address } : null
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:/i.test(value)) return null
  if (download != null) return { kind: 'download', href: value }
  return { kind: 'web', href: value, newTab: String(target).toLowerCase() === '_blank' }
}

// The first address of a mailto: link (its query, ?subject=…, left out).
export function decodeMailto(href) {
  const raw = String(href ?? '').replace(/^mailto:/i, '').split('?')[0].split(',')[0].trim()
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// A link's menu. « Ouvrir » does what a click does (its own target);
// « Ouvrir dans un nouvel onglet » only when the click stays in this tab.
// An address: a new message to it (`compose`, in Messagerie) and copying
// it. A download: saving it. `actions`: { open, openInNewTab, copy(text),
// compose(address) | null }.
export function linkMenuItems(link, actions) {
  if (!link) return []
  if (link.kind === 'mail') return addressMenuItems({ email: link.address }, actions)
  if (link.kind === 'download') {
    return [{ id: 'download', label: 'Télécharger', icon: 'carbon:download', onSelect: actions.open }]
  }
  return [
    { id: 'open', label: 'Ouvrir', icon: link.newTab ? 'carbon:launch' : 'carbon:arrow-right', onSelect: actions.open },
    link.newTab ? null : { id: 'open-tab', label: 'Ouvrir dans un nouvel onglet', icon: 'carbon:new-tab', onSelect: actions.openInNewTab },
    'separator',
    { id: 'copy-link', label: 'Copier le lien', icon: 'carbon:link', onSelect: () => actions.copy(link.absoluteHref ?? link.href) },
  ].filter(Boolean)
}

// Someone's address (a mail's sender, a recipient, a mailto: link): a new
// message to them when the place can write one, and copying it.
export function addressMenuItems(address, { copy, compose = null }) {
  const email = String(address?.email ?? '').trim()
  if (!email) return []
  return [
    compose ? { id: 'compose', label: 'Nouveau message', icon: 'carbon:edit', onSelect: () => compose({ name: address.name ?? '', email }) } : null,
    { id: 'copy-address', label: 'Copier l’adresse', icon: 'carbon:copy', onSelect: () => copy(email) },
  ].filter(Boolean)
}

// The longest text « Rechercher dans les mails » puts in the search field.
export const SEARCH_TEXT_MAX = 80

// Selected text: copying it, and in Messagerie a search for it (`search`),
// its spaces folded and cut to SEARCH_TEXT_MAX.
export function selectionMenuItems(text, { copy, search = null }) {
  const value = String(text ?? '')
  if (!value.trim()) return []
  const query = value.replace(/\s+/g, ' ').trim().slice(0, SEARCH_TEXT_MAX).trim()
  return [
    { id: 'copy', label: 'Copier', icon: 'carbon:copy', onSelect: () => copy(value) },
    search ? { id: 'search-mail', label: 'Rechercher dans les mails', icon: 'carbon:search', onSelect: () => search(query) } : null,
  ].filter(Boolean)
}

const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

function toTime(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(time) ? time : null
}

// A class as text: its title, its day and hours, then its room, teacher
// and group as known. « Lundi 3 novembre · 08:00 – 10:00 ».
export function classCopyText({ title, start, end, location, teacher, group }) {
  const startTime = toTime(start)
  const endTime = toTime(end)
  const day = startTime == null ? '' : DAY_FORMAT.format(startTime)
  const hours = startTime == null ? '' : `${TIME_FORMAT.format(startTime)}${endTime == null ? '' : ` – ${TIME_FORMAT.format(endTime)}`}`
  return [
    String(title ?? '').trim(),
    [day && day[0].toUpperCase() + day.slice(1), hours].filter(Boolean).join(' · '),
    [location, teacher, group].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n')
}

// A grade as text, as the page shows it: « Contrôle TP1 : 14.5/20 », then
// the subject when it's known and not the title already. `value`: a number
// (on 20) or a label (« ABS », « Excusé »).
export function gradeCopyText({ title, value, subject = null }) {
  const name = String(title ?? '').trim()
  const score = typeof value === 'number'
    ? (Number.isFinite(value) ? `${String(parseFloat(value.toFixed(2)))}/20` : '')
    : String(value ?? '').trim()
  const line = [name, score].filter(Boolean).join(' : ')
  const course = String(subject ?? '').trim()
  return course && course !== name ? `${line}\n${course}` : line
}

// The image types the server shows in place (server/mailMessage.js's
// INLINE_IMAGE_TYPES): any other file only downloads.
const VIEWABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])

// A mail attachment's link to see it in a tab (its download link without
// `download=1`), or null for a file that only downloads.
export function attachmentViewHref({ href, type }) {
  if (!href || !VIEWABLE_TYPES.has(String(type ?? '').split(';')[0].trim().toLowerCase())) return null
  const [path, query = ''] = String(href).split('?')
  const params = new URLSearchParams(query)
  params.delete('download')
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

// An attachment's menu: « Ouvrir » for an image (in a tab), « Télécharger ».
export function attachmentMenuItems(attachment, { open, download }) {
  const viewHref = attachmentViewHref(attachment)
  return [
    viewHref ? { id: 'open', label: 'Ouvrir', icon: 'carbon:launch', onSelect: () => open(viewHref) } : null,
    { id: 'download', label: 'Télécharger', icon: 'carbon:download', onSelect: download },
  ].filter(Boolean)
}
