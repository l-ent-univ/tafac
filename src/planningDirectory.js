// « Salles et personnels » (PlanningDirectoryPanel): the ADE tree's rooms
// and staff as /ade/directory gives them ({ groups, items }, the server's
// buildPortalDirectory), searched and laid out for the panel.

// Lowercase, without accents or punctuation, for matching.
export function foldDirectoryText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const foldedWords = (value) => foldDirectoryText(value).split(' ').filter(Boolean)

// A folder's name as shown: ADE's sort prefixes dropped ("19-Lannion IUT"
// → "Lannion IUT", ".Chercheurs" → "Chercheurs").
export function cleanFolderName(name) {
  return String(name ?? '').replace(/^\.+/, '').replace(/^\d{1,3}-\s*/, '').trim()
}

// A room's seats, from ADE's "[142P]" / "[46p]" suffix; null without.
export function roomCapacity(name) {
  const match = /\[(\d+)\s*p\]/i.exec(String(name ?? ''))
  return match ? Number(match[1]) : null
}

// A room's name without its seats suffix.
export function roomLabel(name) {
  return String(name ?? '').replace(/\s*\[\d+\s*p\]\s*$/i, '').trim()
}

// Rooms, staff, and the students' groups (« Formations »).
const ENTRY_KINDS = new Set(['room', 'person', 'group'])

// The entries with their kind and folders, and what a search reads.
// `directory`: /ade/directory's { groups, items }.
export function prepareDirectory(directory) {
  const groups = Array.isArray(directory?.groups) ? directory.groups : []
  const items = Array.isArray(directory?.items) ? directory.items : []
  return items.flatMap((item) => {
    const [id, name, groupIndex] = Array.isArray(item) ? item : [item?.id, item?.name, item?.group]
    const group = groups[groupIndex]
    if (!id || !name || !group) return []
    const path = Array.isArray(group.path) ? group.path : []
    return [{
      id: String(id),
      name: String(name),
      kind: ENTRY_KINDS.has(group.kind) ? group.kind : 'person',
      path,
      foldedName: foldDirectoryText(name),
      foldedPath: foldDirectoryText(path.join(' ')),
    }]
  })
}

// The student's site, as their group's tree gives it (its first folder:
// "IUT Lannion" of "IUT Lannion / BUT Info-Com"); null without.
export function siteLabelFromSelection(selection) {
  const context = String(selection?.contextLabel ?? '').split(' / ')[0].trim()
  return context || null
}

// Whether a folder is the site's: every word of the site's name in it
// ("IUT Lannion" is "19-Lannion IUT - Institut Universitaire de
// Technologie de Lannion" among the rooms, "IUT Lannion" among the staff).
function folderIsSite(folder, siteWords) {
  const words = new Set(foldedWords(folder))
  return siteWords.length > 0 && siteWords.every((word) => words.has(word))
}

// The entries of `kind` on the student's site: those under a top folder
// named as it. `[]` when none is (or no site is known).
export function siteEntries(entries, kind, siteLabel) {
  const siteWords = foldedWords(siteLabel)
  if (siteWords.length === 0) return []
  return entries.filter((entry) => entry.kind === kind && folderIsSite(entry.path[0], siteWords))
}

const compareNames = (left, right) => left.name.localeCompare(right.name, 'fr', { numeric: true, sensitivity: 'base' })

// How many folders under the site's own make a section's title, by kind:
// a room's building ("Bâtiment 05 - INFO", its type on its row), a
// person's whole department ("Permanents · Informatique"), a group's
// formation and year ("BUT MMI · MMI A2", its TD on its row).
const SECTION_DEPTH = { room: 1, person: Infinity, group: 2 }

// The site's entries in sections, by the folders under the site's own:
// the sections and their entries in order, those whose title starts as
// `first` before the others (the student's own formation). What's below
// the title is on the entry's row (`detail`).
export function sectionEntries(entries, kind, { first = null } = {}) {
  const depth = SECTION_DEPTH[kind] ?? Infinity
  const sections = new Map()
  for (const entry of entries) {
    const below = entry.path.slice(1).map(cleanFolderName).filter(Boolean)
    const title = below.slice(0, depth).join(' · ')
    const detail = below.slice(depth).join(' · ')
    if (!sections.has(title)) sections.set(title, [])
    sections.get(title).push({ ...entry, detail })
  }
  const firstWords = foldedWords(first)
  const isFirst = (title) => firstWords.length > 0 && foldDirectoryText(title).startsWith(firstWords.join(' '))
  return [...sections.entries()]
    .sort(([left], [right]) => (isFirst(right) - isFirst(left))
      || left.localeCompare(right, 'fr', { numeric: true, sensitivity: 'base' }))
    .map(([title, sectionItems]) => ({ title, entries: sectionItems.sort(compareNames) }))
}

// Where an entry is, on its row in a search: its folders, the site's
// prefixes dropped, the last two (a room's building and type, a person's
// department), a group's site and formation first.
export function entryPlace(entry) {
  const folders = entry.path.map(cleanFolderName).filter(Boolean)
  // A group: its site and formation, then its TD ("IUT Lannion · BUT MMI ·
  // 2A MMI"), groups being named alike from one formation to the next.
  if (entry.kind === 'group') return [...new Set([...folders.slice(0, 2), ...folders.slice(-1)])].join(' · ')
  return folders.slice(-2).join(' · ')
}

// The entries of `kind` matching every word of `query` in their name or
// folders: names starting with it first, then names holding it, then the
// rest; the student's site before others at each rank. At most `limit`.
export function searchDirectory(entries, kind, query, { siteLabel = null, limit = 80 } = {}) {
  const words = foldedWords(query)
  if (words.length === 0) return []
  const siteWords = foldedWords(siteLabel)
  const ranked = []
  for (const entry of entries) {
    if (entry.kind !== kind) continue
    const haystack = `${entry.foldedName} ${entry.foldedPath}`
    if (!words.every((word) => haystack.includes(word))) continue
    const nameWords = entry.foldedName.split(' ')
    const rank = words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)))
      ? 0
      : words.every((word) => entry.foldedName.includes(word)) ? 1 : 2
    const away = folderIsSite(entry.path[0], siteWords) ? 0 : 1
    ranked.push({ entry, rank, away })
  }
  return ranked
    .sort((left, right) => left.rank - right.rank || left.away - right.away || compareNames(left.entry, right.entry))
    .slice(0, limit)
    .map(({ entry }) => entry)
}

// A room's kind, for its icon (RoomIcon): from its type's folder (the last
// one, "Salle informatique", "Amphithéâtre"…) and its name, never its
// building's ("Bâtiment 05 - INFO" holds rooms of every kind).
const ROOM_KINDS = [
  ['amphi', /\bamphi/],
  ['computer', /informatique|\binfo\b|ordinateur|multimedia/],
  ['meeting', /reunion|seminaire|conseil|visio|conference/],
  ['library', /documentation|bibliotheque|\bb ?u\b|mediatheque/],
  ['study', /travail etudiant|coworking|\betude/],
  ['lab', /travaux pratiques|\btp\b|atelier|labo|makerspace|fablab|chimie|physique|biologie/],
  ['studio', /studio|\btv\b|audio|plateau/],
  ['hall', /\bhall\b|sport|gymnase|dojo|foyer|cafeteria|terrain/],
  ['class', /cours|\btd\b|enseignement|classe|\bsalle\b/],
]

// A folder naming a place, not a kind of room: never read for the kind.
const PLACE_FOLDER = /^(?:batiment|bat|site|sites|campus)\b|^\d+ /

export function roomKind(entry) {
  const typeFolder = foldDirectoryText(entry?.path?.at(-1))
  const text = `${PLACE_FOLDER.test(typeFolder) ? '' : typeFolder} ${foldDirectoryText(entry?.name)}`
  return ROOM_KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
}

// FNV-1a, as the mail badges' colours (mailSender.js).
function hashText(value) {
  let hash = 0x811c9dc5
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// A room's own proportions and furniture count, the same each time (from
// its id): width 12–15, depth 9–11, height 8–9 (the icon's units, scaled
// to the tile), and a variant (0–2) its furniture reads (rows, desks).
export function roomLayout(id) {
  const hash = hashText(id)
  return {
    width: 12 + (hash % 4),
    depth: 9 + ((hash >>> 2) % 3),
    height: 8 + ((hash >>> 4) % 2),
    variant: (hash >>> 6) % 3,
  }
}
