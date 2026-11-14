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

const compareText = (left, right) => left.localeCompare(right, 'fr', { numeric: true, sensitivity: 'base' })

// How many folders under the site's own make a section's title, by kind:
// a room's building ("Bâtiment 05 - INFO", its type on its row), a
// person's whole department ("Permanents · Informatique").
const SECTION_DEPTH = { room: 1, person: Infinity }

// The site's rooms or staff in sections, by the folders under the site's
// own: the sections and their entries in order. What's below the title is
// on the entry's row (`detail`). The groups have their own layout
// (groupCollections).
export function sectionEntries(entries, kind) {
  const depth = SECTION_DEPTH[kind] ?? Infinity
  const sections = new Map()
  for (const entry of entries) {
    const below = entry.path.slice(1).map(cleanFolderName).filter(Boolean)
    const title = below.slice(0, depth).join(' · ')
    const detail = below.slice(depth).join(' · ')
    if (!sections.has(title)) sections.set(title, [])
    sections.get(title).push({ ...entry, detail })
  }
  return [...sections.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([title, sectionItems]) => ({ title, entries: sectionItems.sort(compareNames) }))
}

// `name` without its words found in `drop` (folded words, a Set): "1A1 MMI"
// → "1A1" when "MMI" is the formation's. Kept whole when nothing's left.
function withoutWords(name, drop) {
  const kept = String(name ?? '').split(/\s+/).filter((word) => {
    const folded = foldedWords(word)
    return folded.length === 0 || !folded.every((part) => drop.has(part))
  })
  return kept.join(' ').trim() || String(name ?? '').trim()
}

// The last words every one of `names` ends with, folded ("1A1 I", "2B2 I"
// → ["i"]), each name keeping a word at least; none for a lone name.
function sharedEnding(names) {
  if (names.length < 2) return []
  const lists = names.map((name) => name.split(/\s+/).map(foldDirectoryText))
  const ending = []
  while (lists.every((words) => words.length > ending.length + 1 && words.at(-1 - ending.length) === lists[0].at(-1 - ending.length))) {
    ending.unshift(lists[0].at(-1 - ending.length))
  }
  return ending
}

// `name` without those last words, when it ends with them and more.
function withoutEnding(name, ending) {
  const words = name.split(/\s+/)
  const cut = words.length - ending.length
  if (ending.length === 0 || cut < 1 || !ending.every((word, index) => foldDirectoryText(words[cut + index]) === word)) return name
  return words.slice(0, cut).join(' ')
}

// A year's folder as shown, from its short name: "A1" ("MMI A1" of "BUT
// MMI") → "1re année", "3" ("Info-Com 3") → "3e année"; any other as it is.
function yearLabel(short) {
  const match = /^(?:a|annee|année)?\s*(\d)$/i.exec(short)
  if (!match) return short
  return match[1] === '1' ? '1re année' : `${match[1]}e année`
}

// The site's groups as collections (« Formations »): one per formation,
// its years in rows, a year's groups by TD (the folders under the site's
// own; the TPs, ADE's leaves, at the end, whatever lies between). Each
// name shown short: without the words its formation already says ("1A1
// MMI" → "1A1") or all its groups end with ("1A1 I" → "1A1"), the full
// one kept on `entry`. A TD's label only where its groups' names don't
// start with it ("TD A" over "TP 1", none for "1A" over "1A1"), its full
// name in `name`. The student's own formation first (`own`): the one
// holding their group (`ownId`), else the one named `first`; the others,
// the years, the TDs and the groups in order. → [{ id, label, own, years:
// [{ id, label, tds: [{ id, name, label, groups: [{ entry, label }] }] }] }].
export function groupCollections(entries, { ownId = null, first = null } = {}) {
  const formations = new Map()
  let holder = null
  for (const entry of entries) {
    if (entry.kind !== 'group') continue
    const [formation = '', year = '', td = ''] = entry.path.slice(1).map(cleanFolderName).filter(Boolean)
    if (!formations.has(formation)) formations.set(formation, new Map())
    const years = formations.get(formation)
    if (!years.has(year)) years.set(year, new Map())
    const tds = years.get(year)
    if (!tds.has(td)) tds.set(td, [])
    tds.get(td).push(entry)
    if (ownId !== null && entry.id === String(ownId)) holder = { title: formation }
  }
  const titles = [...formations.keys()]
  // Without their group here (a TD or a year chosen): the formation named
  // as theirs, or the only one starting so ("BUT INFO" isn't "BUT
  // Info-Com").
  const firstText = foldDirectoryText(first)
  const named = firstText ? titles.filter((title) => foldDirectoryText(title).startsWith(firstText)) : []
  const own = holder?.title ?? named.find((title) => foldDirectoryText(title) === firstText) ?? (named.length === 1 ? named[0] : null)
  const byName = ([left], [right]) => compareText(left, right)

  return titles
    .sort((left, right) => ((right === own) - (left === own)) || compareText(left, right))
    .map((title) => {
      const years = formations.get(title)
      const drop = new Set(foldedWords(title))
      const ending = sharedEnding([...years.values()].flatMap((tds) => [...tds.values()].flat()).map((entry) => withoutWords(entry.name, drop)))
      const short = (name) => withoutEnding(withoutWords(name, drop), ending)
      return {
        id: title,
        label: title || 'Autres groupes',
        own: title === own,
        years: [...years.entries()].sort(byName).map(([year, tds]) => ({
          id: year,
          label: year ? yearLabel(short(year)) : '',
          tds: [...tds.entries()].sort(byName).map(([td, tdEntries]) => {
            const groups = tdEntries.sort(compareNames).map((entry) => ({ entry, label: short(entry.name) }))
            const label = td ? short(td) : ''
            const said = groups.every((group) => foldDirectoryText(group.label).startsWith(foldDirectoryText(label)))
            return { id: td, name: td, label: said ? '' : label, groups }
          }),
        })),
      }
    })
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
