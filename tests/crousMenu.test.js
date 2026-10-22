import assert from 'node:assert/strict'
import test from 'node:test'
import { describeClosures, pickMenuDay, readOpeningHours } from '../src/crousMenu.js'

const now = new Date(2026, 9, 17, 12)
const closed = (date) => ({
  date,
  meals: [{ name: 'midi', notice: 'Structure fermée du Lundi 26 Octobre 2026 au Vendredi 30 Octobre 2026', sections: [] }],
})
const served = (date) => ({ date, meals: [{ name: 'midi', notice: null, sections: [{ title: 'Plats chauds', items: ['Pâtes'] }] }] })

test('pickMenuDay shows nothing when the RU published only closures', () => {
  assert.deepEqual(pickMenuDay([closed('2026-10-26'), closed('2026-10-27')], now), { day: null, isToday: false })
})

test('pickMenuDay takes today, else the next day with a menu', () => {
  assert.equal(pickMenuDay([served('2026-10-16'), closed('2026-10-19'), served('2026-10-20')], now).day.date, '2026-10-20')
  assert.equal(pickMenuDay([served('2026-10-17')], now).isToday, true)
})

test('describeClosures words the CROUS notices once, without the year', () => {
  assert.deepEqual(
    describeClosures([closed('2026-10-26'), closed('2026-10-27'), served('2026-10-28'), closed('2026-10-12')], now),
    ['Fermé du lundi 26 octobre au vendredi 30 octobre'],
  )
})

test('readOpeningHours keeps the lunch time apart and words the rest', () => {
  assert.deepEqual(readOpeningHours('MIDI : 11h30-13h45, du lundi au vendredi SOIR : 18h-20h, du lundi au jeudi'), {
    time: '11h30-13h45',
    detail: 'Midi du lundi au vendredi · Soir 18h-20h, du lundi au jeudi',
  })
  assert.deepEqual(readOpeningHours('11h30-13h45, du lundi au vendredi'), { time: '11h30-13h45', detail: 'du lundi au vendredi' })
  assert.equal(readOpeningHours(''), null)
})
