import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isEmptiableMailFolder,
  isValidMailFolderId,
  normalizeZimbraFolderTree,
  parseZimbraMarkReadPref,
} from '../server/mailFolders.js'

// A GetFolderResponse's root, as Partage gives it (trimmed).
const root = {
  id: '1',
  name: 'USER_ROOT',
  folder: [
    { id: '3', name: 'Trash', u: 0, n: 4, folder: [{ id: '400', name: 'Vieux dossier', n: 2 }] },
    { id: '2', name: 'Inbox', u: 5, n: 120, folder: [
      { id: '300', name: 'Moodle', u: 2, n: 40, folder: [{ id: '301', name: 'L2', u: 1, n: 3 }] },
      { id: '302', name: 'Admin', n: 7 },
    ] },
    { id: '7', name: 'Contacts', view: 'contact' },
    { id: '10', name: 'Calendar', view: 'appointment' },
    { id: '14', name: 'Chats', view: 'message' },
    { id: '16', name: 'Briefcase', view: 'document' },
    { id: '5', name: 'Sent', n: 30 },
    { id: '6', name: 'Drafts' },
    { id: '4', name: 'Junk', u: '1', n: '1' },
    { id: '257', name: 'Archive', n: 12, folder: [{ id: '258', name: '2025', n: 3 }] },
    { id: '256', name: 'Associations', u: 3 },
    { id: '500', name: 'Agenda perso', view: 'appointment', folder: [{ id: '501', name: 'Sous-agenda' }] },
  ],
}

test('the whole tree, system folders first, each followed by its sub-folders', () => {
  const folders = normalizeZimbraFolderTree(root)
  assert.deepEqual(folders.map(({ id }) => id), ['2', '302', '300', '301', '5', '6', '4', '3', '400', '257', '258', '256'])
})

test('each folder has its kind, counts, parent, path and depth', () => {
  const byId = Object.fromEntries(normalizeZimbraFolderTree(root).map((folder) => [folder.id, folder]))
  assert.deepEqual(byId['2'], { id: '2', kind: 'inbox', name: 'Inbox', unread: 5, count: 120, parentId: null, path: 'Inbox', depth: 0 })
  assert.deepEqual(byId['301'], { id: '301', kind: 'folder', name: 'L2', unread: 1, count: 3, parentId: '300', path: 'Inbox/Moodle/L2', depth: 2 })
  assert.equal(byId['4'].kind, 'junk')
  assert.equal(byId['4'].unread, 1)
  assert.equal(byId['3'].kind, 'trash')
  assert.equal(byId['400'].parentId, '3')
  assert.equal(byId['256'].kind, 'folder')
  assert.equal(byId['256'].count, 0)
})

test('chats, other views and their contents are left out', () => {
  const ids = normalizeZimbraFolderTree(root).map(({ id }) => id)
  for (const hidden of ['1', '7', '10', '14', '16', '500', '501']) assert.ok(!ids.includes(hidden), `${hidden} listed`)
})

test('odd answers give an empty or partial list, never a throw', () => {
  assert.deepEqual(normalizeZimbraFolderTree(null), [])
  assert.deepEqual(normalizeZimbraFolderTree({}), [])
  assert.deepEqual(normalizeZimbraFolderTree({ folder: { id: '2', name: 'Inbox' } }).map(({ id }) => id), ['2'])
  const odd = normalizeZimbraFolderTree({ folder: [
    { id: 'abc', name: 'x' },
    { id: '2', name: 'Inbox', u: -3, n: 'many', folder: [{ id: '12', name: 'system-like' }, { id: '2', name: 'loop' }] },
    { id: '99', name: 'unknown system id' },
  ] })
  assert.deepEqual(odd.map(({ id }) => id), ['2'])
  assert.equal(odd[0].unread, 0)
  assert.equal(odd[0].count, 0)
})

test('a very deep tree is cut', () => {
  let deepest = { id: '999', name: 'bottom' }
  for (let id = 998; id >= 900; id -= 1) deepest = { id: String(id), name: `n${id}`, folder: [deepest] }
  const folders = normalizeZimbraFolderTree({ folder: [deepest] })
  assert.ok(folders.length <= 13)
  assert.equal(Math.max(...folders.map(({ depth }) => depth)), 12)
})

test('folder ids and the folders that can be emptied', () => {
  assert.ok(isValidMailFolderId('2'))
  assert.ok(isValidMailFolderId('300'))
  for (const bad of ['', '-1', '1,2', '2 ', 'inbox', '1234567890', 2, null]) assert.ok(!isValidMailFolderId(bad), String(bad))
  assert.ok(isEmptiableMailFolder('3'))
  assert.ok(isEmptiableMailFolder('4'))
  for (const other of ['2', '5', '6', '300', '', null]) assert.ok(!isEmptiableMailFolder(other), String(other))
})

test('the mark-as-read preference, from either JSON shape', () => {
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: '0' } }), 0)
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: '-1' } }), -1)
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: '5' } }), 5)
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: ['3'] } }), 3)
  assert.equal(parseZimbraMarkReadPref({ pref: [{ name: 'zimbraPrefMarkMsgRead', _content: '10' }] }), 10)
  assert.equal(parseZimbraMarkReadPref({ pref: { name: 'zimbraPrefMarkMsgRead', _content: '-1' } }), -1)
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: '999999' } }), 3600)
  assert.equal(parseZimbraMarkReadPref({}), 0)
  assert.equal(parseZimbraMarkReadPref(null), 0)
  assert.equal(parseZimbraMarkReadPref({ _attrs: { zimbraPrefMarkMsgRead: 'soon' } }), 0)
})
