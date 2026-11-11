import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTimetableMailHtml, shareFileName, shareHourRange, timetableMailSubject, weekSpanText } from '../src/planningShare.js'

const at = (day, hours, minutes = 0) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, hours, minutes).getTime()
}
const event = (day, from, to) => ({ id: `${day}-${from}`, day, title: 'R5.12', start: at(day, ...from), end: at(day, ...to) })
const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']

test('weekSpanText says the week as a sentence does', () => {
  assert.equal(weekSpanText('2026-11-02'), 'du 2 au 8 novembre 2026')
  assert.equal(weekSpanText('2026-09-28'), 'du 28 septembre au 4 octobre 2026')
  assert.equal(weekSpanText('2026-12-28'), 'du 28 décembre 2026 au 3 janvier 2027')
  assert.equal(weekSpanText('2027-03-01'), 'du 1er au 7 mars 2027')
})

test('shareHourRange spans 8:00 to 18:00, wider for a class outside them', () => {
  assert.deepEqual(shareHourRange([], WEEK), { first: 8, last: 18 })
  assert.deepEqual(shareHourRange([event('2026-11-03', [9], [12])], WEEK), { first: 8, last: 18 })
  assert.deepEqual(shareHourRange([event('2026-11-03', [7, 30], [9]), event('2026-11-05', [17], [19, 15])], WEEK), { first: 7, last: 20 })
  // Another week's classes don't count.
  assert.deepEqual(shareHourRange([event('2026-11-10', [6], [21])], WEEK), { first: 8, last: 18 })
})

test('the file, the subject and the mail name the week', () => {
  assert.equal(shareFileName('2026-11-02'), 'planning-2026-11-02.png')
  assert.equal(timetableMailSubject('2026-11-02'), 'Planning de la semaine du 2 au 8 novembre 2026')
  const { html, focusBlock } = buildTimetableMailHtml('2026-11-02', { cid: 'abc', alt: 'Planning <semaine>', width: 944, height: 800 })
  assert.equal(focusBlock, 3)
  assert.match(html, /^<p>Bonjour,<\/p><p><\/p><p>Voici mon planning de la semaine du 2 au 8 novembre 2026\.<\/p>/)
  assert.match(html, /<img data-inline-cid="abc" alt="Planning &lt;semaine&gt;" width="944" height="800">$/)
  assert.doesNotMatch(buildTimetableMailHtml('2026-11-02').html, /<img/)
})
