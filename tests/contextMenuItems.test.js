import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SEARCH_TEXT_MAX,
  addressMenuItems,
  attachmentMenuItems,
  attachmentViewHref,
  classCopyText,
  decodeMailto,
  describeLink,
  gradeCopyText,
  linkMenuItems,
  normalizeMenu,
  selectionMenuItems,
  tidySeparators,
} from '../src/contextMenuItems.js'

const ids = (items) => items.map((item) => (item === 'separator' ? '—' : item.id))
const noop = () => {}

test('separators never lead, trail or double, and empty slots drop out', () => {
  assert.deepEqual(tidySeparators(['separator', null, { id: 'a' }, 'separator', false, 'separator', { id: 'b' }, 'separator']), [{ id: 'a' }, 'separator', { id: 'b' }])
})

test('a menu is items with a title and a label, or nothing', () => {
  assert.equal(normalizeMenu(null), null)
  assert.equal(normalizeMenu([]), null)
  assert.equal(normalizeMenu(['separator', null]), null)
  assert.deepEqual(normalizeMenu([{ id: 'a' }]), { items: [{ id: 'a' }], title: null, label: null })
  assert.deepEqual(normalizeMenu({ items: [{ id: 'a' }], title: 'T', label: 'L' }), { items: [{ id: 'a' }], title: 'T', label: 'L' })
})

test('links are told apart by what they do', () => {
  assert.deepEqual(describeLink({ href: 'https://moodle.example.fr/x', target: '_blank' }), { kind: 'web', href: 'https://moodle.example.fr/x', newTab: true })
  assert.deepEqual(describeLink({ href: '/__ent_auth/launch?url=x' }), { kind: 'web', href: '/__ent_auth/launch?url=x', newTab: false })
  assert.deepEqual(describeLink({ href: '/__ent_auth/mail/part?id=1&part=2&download=1', download: 'cours.pdf' }), { kind: 'download', href: '/__ent_auth/mail/part?id=1&part=2&download=1' })
  assert.deepEqual(describeLink({ href: 'mailto:Jean.Dupont%40univ.fr?subject=Bonjour' }), { kind: 'mail', href: 'mailto:Jean.Dupont%40univ.fr?subject=Bonjour', address: 'Jean.Dupont@univ.fr' })
  assert.equal(describeLink({ href: 'javascript:void(0)' }), null)
  assert.equal(describeLink({ href: 'tel:+33123456789' }), null)
  assert.equal(describeLink({ href: '#top' }), null)
  assert.equal(describeLink({ href: '' }), null)
  assert.equal(describeLink({ href: 'mailto:' }), null)
})

test('a mailto keeps its first address only', () => {
  assert.equal(decodeMailto('mailto:a@b.fr,c@d.fr?cc=e@f.fr'), 'a@b.fr')
  assert.equal(decodeMailto('MAILTO:%E9l%E8ve@b.fr'), '%E9l%E8ve@b.fr')
})

test('a link opening here offers a new tab; one opening a tab already does not', () => {
  const actions = { open: noop, openInNewTab: noop, copy: noop }
  assert.deepEqual(ids(linkMenuItems({ kind: 'web', href: '/x', newTab: false }, actions)), ['open', 'open-tab', '—', 'copy-link'])
  assert.deepEqual(ids(linkMenuItems({ kind: 'web', href: '/x', newTab: true }, actions)), ['open', '—', 'copy-link'])
  assert.deepEqual(ids(linkMenuItems({ kind: 'download', href: '/f' }, actions)), ['download'])
  assert.deepEqual(linkMenuItems(null, actions), [])
})

test('« Copier le lien » copies the absolute address', () => {
  let copied = null
  const items = linkMenuItems({ kind: 'web', href: '/x', absoluteHref: 'https://tafac.fr/x', newTab: true }, { open: noop, openInNewTab: noop, copy: (text) => { copied = text } })
  items.find((item) => item.id === 'copy-link').onSelect()
  assert.equal(copied, 'https://tafac.fr/x')
})

test('an address offers a new message only where one can be written', () => {
  const composed = []
  const copied = []
  const withCompose = addressMenuItems({ name: 'Jean Dupont', email: ' jean@univ.fr ' }, { copy: (text) => copied.push(text), compose: (address) => composed.push(address) })
  assert.deepEqual(ids(withCompose), ['compose', 'copy-address'])
  withCompose[0].onSelect()
  withCompose[1].onSelect()
  assert.deepEqual(composed, [{ name: 'Jean Dupont', email: 'jean@univ.fr' }])
  assert.deepEqual(copied, ['jean@univ.fr'])
  assert.deepEqual(ids(addressMenuItems({ email: 'jean@univ.fr' }, { copy: noop })), ['copy-address'])
  assert.deepEqual(addressMenuItems({ name: 'Sans adresse' }, { copy: noop }), [])
  // A mailto: link goes through the same items.
  assert.deepEqual(ids(linkMenuItems({ kind: 'mail', address: 'a@b.fr' }, { copy: noop, compose: noop })), ['compose', 'copy-address'])
})

test('a selection is copied as is and searched folded and capped', () => {
  let copied = null
  let searched = null
  const items = selectionMenuItems('  Projet\n  tutoré  ', { copy: (text) => { copied = text }, search: (text) => { searched = text } })
  assert.deepEqual(ids(items), ['copy', 'search-mail'])
  items[0].onSelect()
  items[1].onSelect()
  assert.equal(copied, '  Projet\n  tutoré  ')
  assert.equal(searched, 'Projet tutoré')
  const long = selectionMenuItems('mot '.repeat(60), { copy: noop, search: (text) => { searched = text } })
  long[1].onSelect()
  assert.ok(searched.length <= SEARCH_TEXT_MAX)
  assert.ok(!searched.endsWith(' '))
  assert.deepEqual(ids(selectionMenuItems('texte', { copy: noop })), ['copy'])
  assert.deepEqual(selectionMenuItems('   ', { copy: noop }), [])
})

test('a class copies as its title, day and hours, then where and with whom', () => {
  const start = new Date(2026, 10, 2, 8, 0).getTime()
  const end = new Date(2026, 10, 2, 10, 0).getTime()
  assert.equal(
    classCopyText({ title: 'R315 Traitement du signal', start, end, location: 'B204', teacher: 'Dupont Marie', group: 'TP A1' }),
    'R315 Traitement du signal\nLundi 2 novembre · 08:00 – 10:00\nB204 · Dupont Marie · TP A1',
  )
  assert.equal(classCopyText({ title: 'Anglais', start: new Date(start).toISOString(), end: null }), 'Anglais\nLundi 2 novembre · 08:00')
  assert.equal(classCopyText({ title: 'Sans date', start: 'pas une date' }), 'Sans date')
})

test('a grade copies as the page shows it', () => {
  assert.equal(gradeCopyText({ title: 'Contrôle TP1', value: 14.5 }), 'Contrôle TP1 : 14.5/20')
  assert.equal(gradeCopyText({ title: 'Contrôle TP1', value: 14.456, subject: 'R1.01 Initiation au développement' }), 'Contrôle TP1 : 14.46/20\nR1.01 Initiation au développement')
  assert.equal(gradeCopyText({ title: 'Oral', value: 'ABS' }), 'Oral : ABS')
  assert.equal(gradeCopyText({ title: 'Projet', value: Number.NaN }), 'Projet')
  // The subject only when the title isn't it already.
  assert.equal(gradeCopyText({ title: 'Anglais', value: 12, subject: 'Anglais' }), 'Anglais : 12/20')
})

test('an image attachment opens in a tab, any file downloads', () => {
  const href = '/__ent_auth/mail/part?id=12&part=2&download=1'
  assert.equal(attachmentViewHref({ href, type: 'image/png' }), '/__ent_auth/mail/part?id=12&part=2')
  assert.equal(attachmentViewHref({ href, type: 'application/pdf' }), null)
  assert.equal(attachmentViewHref({ href, type: 'image/svg+xml' }), null)
  const opened = []
  let downloaded = 0
  const image = attachmentMenuItems({ href, type: 'image/jpeg' }, { open: (url) => opened.push(url), download: () => { downloaded += 1 } })
  assert.deepEqual(ids(image), ['open', 'download'])
  image[0].onSelect()
  image[1].onSelect()
  assert.deepEqual(opened, ['/__ent_auth/mail/part?id=12&part=2'])
  assert.equal(downloaded, 1)
  assert.deepEqual(ids(attachmentMenuItems({ href, type: 'application/pdf' }, { open: noop, download: noop })), ['download'])
})
