// The mailbox's folders and the mail preferences the mail page needs, read
// from Zimbra's SOAP answers. Kept apart from entAuthApp.js so they can be
// tested on their own (tests/mailFolders.test.js); both universities' mail
// is Zimbra (RENATER Partage), so one shape serves them.

// Zimbra's system folders, the same ids in every mailbox. The mail page
// shows them in this order (as pills), then the folders the student made
// (an « Archive »…), each followed by its own sub-folders.
export const MAIL_INBOX_FOLDER = '2'
export const MAIL_TRASH_FOLDER = '3'
export const MAIL_JUNK_FOLDER = '4'
export const MAIL_SYSTEM_FOLDERS = [
  { id: '2', kind: 'inbox' },
  { id: '5', kind: 'sent' },
  { id: '6', kind: 'drafts' },
  { id: '4', kind: 'junk' },
  { id: '3', kind: 'trash' },
]
// Chats (14) holds the old instant messages, not mail.
const MAIL_HIDDEN_FOLDERS = new Set(['14'])
// Ids below this are Zimbra's own (contacts, calendar, tags…); the ones the
// student makes start here.
const MAIL_FIRST_USER_FOLDER_ID = 256
// A tree deeper or wider than this is cut: nobody files mail that far
// down, and the answer stays small.
const MAIL_FOLDER_MAX_DEPTH = 12
const MAIL_FOLDER_MAX_COUNT = 400
const MAIL_FOLDER_MAX_NAME_LENGTH = 128

export function isValidMailFolderId(value) {
  return typeof value === 'string' && /^\d{1,9}$/.test(value)
}

// The folders the whole mailbox can be emptied of for good (« Vider la
// corbeille », « Vider les indésirables »): nothing else, whatever asks.
export function isEmptiableMailFolder(id) {
  return id === MAIL_TRASH_FOLDER || id === MAIL_JUNK_FOLDER
}

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : [])

// A folder holding mail: no view (Zimbra's default) or the message view.
// Contacts, calendars, tasks and the briefcase have their own views; shared
// folders (mountpoints) come as `link` and search folders as `search`, so
// only `folder` children are ever looked at.
function isMailView(folder) {
  return !folder?.view || folder.view === 'message' || folder.view === 'conversation'
}

const toCount = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0)

// GetFolderResponse's tree under the root (id 1) → a flat list, parents
// before their children: [{ id, kind, name, unread, count, parentId, path,
// depth }]. `kind` is a system folder's ('inbox'…) or 'folder'; `parentId`
// null at the top; `path` the names from the top, joined with « / »
// (« Inbox/Moodle »); `depth` 0 at the top. The system folders come first,
// in MAIL_SYSTEM_FOLDERS's order, each with its sub-folders, then the
// student's own top-level folders with theirs. Anything that isn't a mail
// folder is left out with all it holds.
export function normalizeZimbraFolderTree(root) {
  const topLevel = asArray(root?.folder).filter((folder) => isValidMailFolderId(String(folder?.id ?? '')))
  const systemKinds = new Map(MAIL_SYSTEM_FOLDERS.map(({ id, kind }) => [id, kind]))
  const result = []
  const seen = new Set()

  const visit = (folder, parent, depth) => {
    const id = String(folder?.id ?? '')
    if (result.length >= MAIL_FOLDER_MAX_COUNT || depth > MAIL_FOLDER_MAX_DEPTH) return
    if (!isValidMailFolderId(id) || seen.has(id) || MAIL_HIDDEN_FOLDERS.has(id) || !isMailView(folder)) return
    // Under the root, only the known system folders and the student's own;
    // further down, only the student's (Zimbra keeps its own at the top).
    const kind = depth === 0 ? systemKinds.get(id) ?? null : null
    if (!kind && Number(id) < MAIL_FIRST_USER_FOLDER_ID) return
    seen.add(id)
    const name = (typeof folder.name === 'string' ? folder.name : '').slice(0, MAIL_FOLDER_MAX_NAME_LENGTH)
    const entry = {
      id,
      kind: kind ?? 'folder',
      name,
      unread: toCount(folder.u),
      count: toCount(folder.n),
      parentId: parent?.id ?? null,
      path: parent ? `${parent.path}/${name}` : name,
      depth,
    }
    result.push(entry)
    // Sub-folders by name, as the webmail lists them.
    const children = asArray(folder.folder)
      .slice()
      .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'fr', { sensitivity: 'base' }))
    for (const child of children) visit(child, entry, depth + 1)
  }

  for (const { id } of MAIL_SYSTEM_FOLDERS) {
    const folder = topLevel.find((entry) => String(entry.id) === id)
    if (folder) visit(folder, null, 0)
  }
  const systemIds = new Set(MAIL_SYSTEM_FOLDERS.map(({ id }) => id))
  const custom = topLevel
    .filter((folder) => !systemIds.has(String(folder.id)))
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'fr', { sensitivity: 'base' }))
  for (const folder of custom) visit(folder, null, 0)
  return result
}

// zimbraPrefMarkMsgRead, from GetPrefsResponse (urn:zimbraAccount), as the
// number of seconds an open mail waits before it's marked read: -1 never, 0
// at once. Zimbra's JSON gives the preferences either as `_attrs` ({ name:
// value }) or as a `pref` list ([{ name, _content }]); anything unreadable is
// 0, the webmail's own default. A delay is capped at an hour.
const MAIL_MARK_READ_MAX_DELAY = 3600

export function parseZimbraMarkReadPref(response) {
  const name = 'zimbraPrefMarkMsgRead'
  let raw = response?._attrs?.[name]
  if (raw === undefined) {
    const pref = asArray(response?.pref).find((entry) => entry?.name === name)
    raw = pref?._content ?? pref?.value
  }
  if (Array.isArray(raw)) raw = raw[0]
  const value = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(value)) return 0
  if (value < 0) return -1
  return Math.min(value, MAIL_MARK_READ_MAX_DELAY)
}
