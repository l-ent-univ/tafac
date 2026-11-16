import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractPlanningSerializationPoliciesFromCache,
  extractPlanningTimetableEventsV612,
  parsePlanningIntegerList,
  parsePlanningLoginIdentifiers,
} from '../planningRpc.js'

const SERVICES = ['WebClientServiceProxy', 'ConfigurationServiceProxy', 'MyPlanningClientServiceProxy', 'DirectPlanningServiceProxy', 'DirectPlanningPlanningServiceProxy', 'PacServiceProxy']
const hashFor = (index) => String(index).repeat(32).slice(0, 32).replace(/\d/g, (d) => 'ABCDEF0123'[d])

for (const [build, callee, getter] of [['Rennes', '$w', '$Ad'], ['Sorbonne Nouvelle', 'Xx', 'UDd']]) {
  test(`serialization policies are read from the ${build} build's minified names`, () => {
    const cache = SERVICES.map((name, i) => `function f${i}(){${callee}.call(this,${getter}(),'${name}','${hashFor(i)}',x)}`).join(';')
    const policies = extractPlanningSerializationPoliciesFromCache(cache)
    assert.equal(policies.myPlanning, hashFor(2))
    assert.equal(policies.pac, hashFor(5))
  })
}

test('login identifiers: the Rennes "L…" number, else the ADE 6.12 enrolment codes', () => {
  assert.deepEqual(parsePlanningLoginIdentifiers('//OK[1,["x","L123456","y"],0,7]'), ['L123456'])
  const login = '//OK[1,["Planning_ENT","java.util.HashMap/1797211028","java.lang.String/2004016611","X1ABC01T02-111","{UAI:0000000A}X1ABC01","Default","999"],0,7]'
  assert.deepEqual(parsePlanningLoginIdentifiers(login), ['X1ABC01T02-111', '{UAI:0000000A}X1ABC01'])
})

test('integer lists are read back in their sent order', () => {
  assert.deepEqual(parsePlanningIntegerList('//OK[30,2,20,2,10,2,3,1,["java.util.ArrayList/4159755760","java.lang.Integer/3438268394"],0,7]'), [10, 20, 30])
  assert.deepEqual(parsePlanningIntegerList('//OK[42,2,1,1,["java.util.ArrayList/4159755760","java.lang.Integer/3438268394"],0,7]'), [42])
})

test('ADE 6.12 timetable: one row per day, text list read backwards', () => {
  const strings = ['java.util.ArrayList/4159755760', 'SquareEvent', 'java.lang.Integer/3438268394', '', 'java.lang.Boolean/476441737', 'java.lang.String/2004016611', 'Course A', 'Room 1', '09h30 - 11h00', 'Course B', 'Teacher B', 'Room 2', '10h00 - 12h00']
  // Monday (y 0) with no teacher, Thursday (y 329, rows 110 high) with one.
  const monday = [92, 0, 109, 55, 0, 4, 4, 4, 9, 6, 0, 8, 6, 0, 7, 6, 5, 1, 0, 3, 1, 1, 2]
  const thursday = [110, 329, 110, 74, 0, 4, 4, 4, 13, 6, 0, 12, 6, 0, 11, 6, 0, 10, 6, 7, 1, 0, 3, 1, 1, 2]
  const text = `//OK[${[...thursday, ...monday, 2, 1].join(',')},${JSON.stringify(strings)},0,7]`
  const days = ['Lundi 09/11/2026', 'Mardi 10/11/2026', 'Mercredi 11/11/2026', 'Jeudi 12/11/2026']
  const events = extractPlanningTimetableEventsV612(text, days)
  assert.deepEqual(events.map(({ title, teacher, location, start, end }) => ({ title, teacher, location, start, end })), [
    { title: 'Course A', teacher: '', location: 'Room 1', start: '2026-11-09T09:30:00', end: '2026-11-09T11:00:00' },
    { title: 'Course B', teacher: 'Teacher B', location: 'Room 2', start: '2026-11-12T10:00:00', end: '2026-11-12T12:00:00' },
  ])
})
