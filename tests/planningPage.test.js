import assert from 'node:assert/strict'
import test from 'node:test'
import { placeEventColumns } from '../src/eventColumns.js'
import { ACCENTS, accentColor, accentStyle, assignAccent, courseKey } from '../src/eventAccents.js'
import { chooseBlockVariant, layoutEventBlock } from '../src/eventBlockLayout.js'
import { GRID_HEIGHT, dayColumn, layoutDayBlocks, yForHour } from '../src/planningGrid.js'
import { addDays, daysBetween, durationText, monthLabel, relativeDayText, sameWeekday, shortWeekdayText, startOfWeek, toDayKey, weekRangeText } from '../src/planningDates.js'
import { mergeEvents, nextOccurrences, toPlanningEvent, weekColumns } from '../src/planningEvents.js'

const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const span = (name, from, to) => ({ name, start: from, end: to })

test('overlapping classes share their row (the iOS EventColumns)', () => {
  const a = span('A', 8, 12)
  const b = span('B', 9, 10)
  const c = span('C', 11, 13)
  const d = span('D', 13, 14)
  const placed = placeEventColumns([c, b, a, d])
  assert.deepEqual([a, b, c].map((event) => placed.get(event)), [{ column: 0, count: 2 }, { column: 1, count: 2 }, { column: 1, count: 2 }])
  // Half-open: D starts as C ends, a cluster of its own.
  assert.deepEqual(placed.get(d), { column: 0, count: 1 })
  // Same start: the longer one first.
  const long = span('long', 8, 10)
  const short = span('short', 8, 9)
  const tie = placeEventColumns([short, long])
  assert.equal(tie.get(long).column, 0)
  assert.equal(tie.get(short).column, 1)
})

test('courses get the accents in the order they are first seen', () => {
  let assigned = {}
  const indexes = ['R315 traitement', 'R302 Anglais', ' r315   TRAITEMENT ', ...ACCENTS.map((_, index) => `Cours ${index}`)].map((title) => {
    const result = assignAccent(assigned, title)
    assigned = result.assigned
    return result.index
  })
  assert.deepEqual(indexes.slice(0, 4), [0, 1, 0, 2])
  // Round and round once all nine are taken.
  assert.equal(indexes.at(-1), 1)
  assert.equal(courseKey('  R302   Anglais '), 'r302 anglais')
  assert.equal(accentColor(0, true), '#1CA4E6')
  assert.equal(accentColor(1, true), '#E84646')
})

test('a course’s colour comes as CSS variables for both themes', () => {
  assert.deepEqual(accentStyle(0), { '--accent': '#0095D6', '--accent-dark': '#1CA4E6' })
  assert.deepEqual(accentStyle(10), { '--accent': '#E84646', '--accent-dark': '#E84646' })
})

test('a block fits its text as the iOS EventBlock does', () => {
  const twoLines = () => 2
  // Two hours in the day view: title on two lines, room over teacher.
  const tall = layoutEventBlock({ width: 362, height: 116, variant: 'regular', titleLines: twoLines, roomWidth: 70, teacherWidth: 80 })
  assert.deepEqual([tall.titleLines, tall.meta, tall.showRoom, tall.showTeacher], [2, 'stacked', true, true])
  assert.equal(tall.paddingTop, 13)
  assert.deepEqual(tall.bar, { x: 13, y: 13, width: 6, height: 90 })
  // An hour: one line and the shared row.
  const hour = layoutEventBlock({ width: 362, height: 58, variant: 'compact', titleLines: () => 1, roomWidth: 70, teacherWidth: 80 })
  assert.deepEqual([hour.titleLines, hour.meta], [1, 'row'])
  assert.ok(hour.roomGroupWidth >= 16 + 2 + 44)
  // Too short for anything but the title, corners a third of the height.
  const short = layoutEventBlock({ width: 362, height: 26, variant: 'compact', titleLines: twoLines, roomWidth: 70, teacherWidth: 80 })
  assert.deepEqual([short.titleLines, short.meta, short.showRoom], [1, null, false])
  assert.equal(short.radius, 8)
  // Narrow: the row can't fit, they stack (or the room alone).
  const narrow = layoutEventBlock({ width: 150, height: 68, variant: 'compact', titleLines: () => 1, roomWidth: 70, teacherWidth: 80 })
  assert.equal(narrow.meta, 'stacked')
  // A week's column at 1024px: a third line for the title when it's tall
  // enough, still two in the two-day view's width.
  const threeLines = () => 3
  const weekColumn = layoutEventBlock({ width: 88, height: 116, variant: 'compact', titleLines: threeLines, roomWidth: 70, teacherWidth: 80 })
  assert.deepEqual([weekColumn.titleLines, weekColumn.meta], [3, 'stacked'])
  const twoDayColumn = layoutEventBlock({ width: 162, height: 116, variant: 'compact', titleLines: threeLines, roomWidth: 70, teacherWidth: 80 })
  assert.equal(twoDayColumn.titleLines, 2)
  assert.equal(chooseBlockVariant({ dayCount: 1, durationMs: 2 * 3600000 }), 'regular')
  assert.equal(chooseBlockVariant({ durationMs: 2 * 3600000 }), 'regular')
  assert.equal(chooseBlockVariant({ dayCount: 1, durationMs: 90 * 60000 }), 'compact')
  // Several days side by side (two, the week): always compact.
  assert.equal(chooseBlockVariant({ dayCount: 2, durationMs: 3 * 3600000 }), 'compact')
  assert.equal(chooseBlockVariant({ dayCount: 5, durationMs: 3 * 3600000 }), 'compact')
  assert.equal(chooseBlockVariant({ dayCount: 7, durationMs: 3 * 3600000 }), 'compact')
})

test('the ruler: 06:00 to 22:00, 58px an hour', () => {
  assert.equal(GRID_HEIGHT, 938)
  assert.equal(yForHour(6), 5)
  assert.equal(yForHour(10.5), 266)
  assert.equal(yForHour(22), 933)
  assert.deepEqual(dayColumn(412, 1, 2), { x: 231, width: 181 })

  const day = '2026-10-18'
  const events = [
    { id: 'a', title: 'A', start: at(18, 8), end: at(18, 12) },
    { id: 'b', title: 'B', start: at(18, 9), end: at(18, 10) },
    { id: 'late', title: 'Late', start: at(18, 21, 30), end: at(18, 23) },
    { id: 'night', title: 'Night', start: at(18, 23), end: at(18, 23, 30) },
  ]
  const blocks = layoutDayBlocks(events, { dayKey: day, dayIndex: 0, dayCount: 1, width: 412 })
  assert.deepEqual(blocks.map(({ event }) => event.id), ['a', 'b', 'late'])
  const [a, b, late] = blocks
  assert.deepEqual([a.x, a.y, a.height, a.variant], [50, 121, 232, 'regular'])
  // At least the 4px gap (half pixels rounded away).
  assert.ok(b.x - (a.x + a.width) >= 4 && b.x - (a.x + a.width) <= 5)
  // Cut at 22:00.
  assert.equal(late.y + late.height, 933)
})

test('days, weeks and the French texts', () => {
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12')
  assert.equal(sameWeekday('2026-10-18', '2026-10-19'), '2026-10-25')
  assert.equal(addDays('2026-10-24', 2), '2026-10-26')
  // Across the end of summer time.
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2)
  assert.equal(monthLabel('2026-10-18'), 'Octobre')
  assert.equal(durationText(at(18, 8), at(18, 10)), '2h00')
  assert.equal(durationText(at(18, 8), at(18, 9, 30)), '1h30')
  assert.equal(durationText(at(18, 8), at(18, 8, 45)), '45 min')
  assert.equal(relativeDayText('2026-10-18', '2026-10-18'), 'Aujourd’hui')
  assert.equal(relativeDayText('2026-10-19', '2026-10-18'), 'Demain')
  assert.equal(relativeDayText('2026-10-21', '2026-10-18'), 'Mercredi')
  assert.equal(relativeDayText('2026-10-28', '2026-10-18'), 'Mercredi 28 octobre')
  assert.equal(toDayKey(at(18, 23, 59)), '2026-10-18')
})

test('classes from /ade/upcoming, portal or demo, without duplicates', () => {
  const portal = toPlanningEvent({ uid: '501', title: ' R302  Anglais TD ', startMs: at(19, 11), endMs: at(19, 13), location: 'Salle 114', teacher: '', groups: ['2B'], groupsLabel: '2B MMI' })
  const demo = toPlanningEvent({ id: 'demo-1', title: 'R302 Anglais TD', start: new Date(at(19, 11)).toISOString(), end: new Date(at(19, 13)).toISOString(), groups: ['TP 3'] })
  assert.equal(portal.day, '2026-10-19')
  assert.equal(portal.teacher, null)
  assert.equal(portal.group, '2B MMI')
  assert.equal(demo.group, 'TP 3')
  assert.equal(mergeEvents([portal], [demo]).length, 1)
  assert.equal(toPlanningEvent({ title: 'x' }), null)

  const later = toPlanningEvent({ uid: '502', title: 'r302 anglais td', startMs: at(26, 11), endMs: at(26, 13) })
  const far = toPlanningEvent({ uid: '503', title: 'R302 Anglais TD', startMs: at(19, 11) + 31 * 86400000, endMs: at(19, 13) + 31 * 86400000 })
  assert.deepEqual(nextOccurrences([portal, later, far], portal).map(({ id }) => id), [later.id])
})

test('the week view: its columns, its days and its range', () => {
  const day = '2026-10-14'
  const events = [
    { id: 'a', title: 'A', start: at(13, 8), end: at(13, 10), day: '2026-10-13' },
    { id: 'b', title: 'B', start: at(21, 8), end: at(21, 10), day: '2026-10-21' },
  ]
  // The blocks of a week column are compact, in a seventh of the width.
  const [block] = layoutDayBlocks(events.slice(0, 1), { dayKey: '2026-10-13', dayIndex: 1, dayCount: 7, width: 750 })
  assert.equal(block.variant, 'compact')
  assert.deepEqual(dayColumn(750, 1, 7), { x: 150, width: 100 })
  assert.equal([block.x, block.width].join(), '151,98')

  // Monday to Friday without anything on the weekend (today there or not).
  assert.deepEqual(weekColumns(events, '2026-10-19'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'])
  assert.equal(weekColumns(events, '2026-10-12').length, 5)
  // The weekend when shown in Mon compte, with a class on it, or shown alone.
  const saturday = { id: 's', title: 'S', start: at(24, 9), end: at(24, 12), day: '2026-10-24' }
  assert.equal(weekColumns(events, '2026-10-19', { showWeekend: true }).length, 7)
  assert.equal(weekColumns([...events, saturday], '2026-10-19').length, 7)
  assert.equal(weekColumns(events, '2026-10-19', { shownDay: '2026-10-25' }).length, 7)
  // A day shown elsewhere doesn't change this week.
  assert.equal(weekColumns(events, '2026-10-19', { shownDay: '2026-10-18' }).length, 5)
  assert.equal(weekColumns(events, '2026-10-19', { shownDay: day })[0], '2026-10-19')

  // A week's page starts on its Monday, whatever day is selected.
  assert.equal(startOfWeek('2026-10-19'), '2026-10-19')
  assert.equal(startOfWeek('2026-10-25'), '2026-10-19')
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26')

  assert.equal(shortWeekdayText('2026-10-12'), 'Lun.')
  assert.equal(shortWeekdayText('2026-10-18'), 'Dim.')
  assert.equal(weekRangeText('2026-10-12'), '12 – 18 octobre 2026')
  assert.equal(weekRangeText('2026-09-28'), '28 septembre – 4 octobre 2026')
  assert.equal(weekRangeText('2026-12-28'), '28 décembre 2026 – 3 janvier 2027')
})

test('week blocks put the room over the teacher when they have the height', () => {
  const block = { width: 220, height: 80, variant: 'compact', titleLines: () => 1, roomWidth: 90, teacherWidth: 80 }
  // Wide enough for the shared row: compact blocks take it first…
  assert.equal(layoutEventBlock(block).meta, 'row')
  // …a week's stack first, and still fall back on the row when too short.
  assert.equal(layoutEventBlock({ ...block, stackFirst: true }).meta, 'stacked')
  assert.equal(layoutEventBlock({ ...block, stackFirst: true, height: 44 }).meta, 'row')

  const events = [{ id: 'a', title: 'A', start: at(19, 9), end: at(19, 11) }]
  const week = layoutDayBlocks(events, { dayKey: '2026-10-19', dayIndex: 0, dayCount: 7, width: 1200 })
  const twoDays = layoutDayBlocks(events, { dayKey: '2026-10-19', dayIndex: 0, dayCount: 2, width: 400 })
  assert.equal(week[0].stackFirst, true)
  assert.equal(twoDays[0].stackFirst, false)
})

test('a wide screen draws a day’s classes as its week does', () => {
  const events = [{ id: 'a', title: 'A', start: at(19, 9), end: at(19, 12) }]
  const [day] = layoutDayBlocks(events, { dayKey: '2026-10-19', dayIndex: 0, dayCount: 1, width: 1200 })
  const [wideDay] = layoutDayBlocks(events, { dayKey: '2026-10-19', dayIndex: 0, dayCount: 1, width: 1200, weekBlocks: true })
  assert.deepEqual([day.variant, day.stackFirst], ['regular', false])
  assert.deepEqual([wideDay.variant, wideDay.stackFirst], ['compact', true])
})

test('a class keeps its note and its web link, the link label in plain case', () => {
  const tempo = toPlanningEvent({ uid: 'tempo-1', title: 'Atelier', startMs: at(19, 9), endMs: at(19, 11), notes: ' Salle changée ', link: 'https://pix.example.fr/planning', linkLabel: 'VOTRE PLANNING' })
  assert.equal(tempo.notes, 'Salle changée')
  assert.equal(tempo.link, 'https://pix.example.fr/planning')
  assert.equal(tempo.linkLabel, 'Votre planning')

  const ade = toPlanningEvent({ uid: '501', title: 'Anglais', startMs: at(19, 9), endMs: at(19, 11), link: null })
  assert.equal(ade.notes, null)
  assert.equal(ade.link, null)
  assert.equal(ade.linkLabel, null)

  const unsafe = toPlanningEvent({ uid: '2', title: 'x', startMs: at(19, 9), endMs: at(19, 10), link: 'javascript:alert(1)', linkLabel: 'Ouvrir' })
  assert.equal(unsafe.link, null)
  assert.equal(unsafe.linkLabel, null)
  assert.equal(toPlanningEvent({ uid: '3', title: 'x', startMs: at(19, 9), endMs: at(19, 10), link: 'https://a.example', linkLabel: 'BU' }).linkLabel, 'BU')
})
