import test from 'node:test'
import assert from 'node:assert/strict'
import { canBeNative, dropdownMenuItems, nativeMenuItems } from '../src/iosMenuItems.js'

test('the page\'s menu items as the system\'s menu reads them', () => {
  const items = [
    { id: 'open', label: 'Voir la note', icon: 'ph:eye', onSelect() {} },
    { id: 7, label: 'Archives', depth: 2, detail: 12, checked: true },
    'separator',
    { id: 'delete', label: 'Supprimer', destructive: true, disabled: true },
  ]
  const pictures = [{ image: 'AAAA' }, null, null, { image: 'BBBB', template: false }]
  assert.deepEqual(nativeMenuItems(items, pictures), [
    { id: 'open', label: 'Voir la note', image: 'AAAA' },
    { id: '7', label: '        Archives (12)', checked: true },
    { separator: true },
    { id: 'delete', label: 'Supprimer', image: 'BBBB', template: false, destructive: true, disabled: true },
  ])
})

test('a list in its own fonts stays the page\'s menu', () => {
  assert.equal(canBeNative([{ id: 'open', label: 'Voir' }, 'separator']), true)
  assert.equal(canBeNative([{ id: 'inter', label: 'Inter', labelStyle: { fontFamily: 'Inter' } }]), false)
})

test('a dropdown as a menu: the choice in force ticked, the actions past a line', () => {
  const options = [{ value: 5, label: 'Semestre 5 · 2026/2027' }, { value: 4, label: 'Semestre 4' }]
  assert.deepEqual(dropdownMenuItems(options, 0), [
    { id: 'option:0', label: 'Semestre 5', subtitle: '2026/2027', checked: true },
    { id: 'option:1', label: 'Semestre 4', checked: false },
  ])
  assert.deepEqual(dropdownMenuItems(options, 1, [{ id: 'rooms', label: 'Salles et personnels', icon: 'ph:door' }]).slice(2), [
    'separator',
    { id: 'action:0', label: 'Salles et personnels', icon: 'ph:door' },
  ])
})
