import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { buildNetwork, decodeTripUpdates, parseCsv, parseGtfsTime, readZipEntries } from '../server/transitFeed.js'
import { findDepartures, planJourneys, serviceDayStartMs } from '../server/transitPlanner.js'
import { createTransitPushStore, isAllowedPushEndpoint, readReminders, readSubscription } from '../server/transitPush.js'

// Line A: Gare → Centre → IUT. Line B: Plage → Centre (change to A).
const FILES = {
  'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\n1,"Réseau, test",https://x,Europe/Paris\n',
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,location_type',
    'gare,Gare,48.7280,-3.4600,0',
    'centre1,Centre,48.7320,-3.4570,0',
    'centre2,Centre,48.7321,-3.4572,0',
    'iut,IUT,48.7580,-3.4545,0',
    'plage,Plage,48.8000,-3.5000,0',
  ].join('\n'),
  'routes.txt': 'route_id,route_short_name,route_long_name,route_type,route_color\nA,A,Ligne A,3,F26521\nB,B,Ligne B,3,80c341\n',
  'trips.txt': [
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    'A,week,A1,IUT,0,',
    'A,week,A2,IUT,0,',
    'B,week,B1,Centre,0,',
    'A,sunday,A9,IUT,0,',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type',
    'A1,07:30:00,07:30:00,gare,1,0,1',
    'A1,07:35:00,07:35:00,centre1,2,,',
    'A1,07:45:00,07:45:00,iut,3,1,0',
    'A2,08:30:00,08:30:00,gare,1,0,1',
    'A2,08:35:00,08:35:00,centre1,2,,',
    'A2,08:45:00,08:45:00,iut,3,1,0',
    'B1,07:10:00,07:10:00,plage,1,0,1',
    'B1,07:25:00,07:25:00,centre2,2,1,0',
    'A9,10:00:00,10:00:00,gare,1,,',
    'A9,10:15:00,10:15:00,iut,2,,',
  ].join('\n'),
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweek,1,1,1,1,1,0,0,20260901,20270703\nsunday,0,0,0,0,0,0,1,20260901,20270703\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nweek,20261111,2\n',
}

function makeNetwork() {
  return buildNetwork(new Map(Object.entries(FILES).map(([name, content]) => [name, Buffer.from(content)])))
}

const DAY = '20261023' // a Friday
const at = (time) => serviceDayStartMs(DAY, 'Europe/Paris') + parseGtfsTime(`${time}:00`) * 1000
const fmt = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })

test('parseCsv reads quoted fields, doubled quotes and a BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, ""y""",2\n'), [{ a: 'x, "y"', b: '2' }])
  assert.equal(parseGtfsTime('25:10:00'), 25 * 3600 + 600)
})

test('readZipEntries inflates deflated entries', () => {
  const name = Buffer.from('dir/stops.txt')
  const data = deflateRawSync(Buffer.from('hello'))
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt16LE(name.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(30 + name.length + data.length, 16)
  const zip = Buffer.concat([local, name, data, central, name, end])
  assert.equal(readZipEntries(zip).get('stops.txt').toString(), 'hello')
})

test('buildNetwork groups same-name stops into one place and reads the calendar', () => {
  const network = makeNetwork()
  assert.equal(network.agencyName, 'Réseau, test')
  assert.deepEqual(network.places.get('centre1').stopIds, ['centre1', 'centre2'])
  assert.equal(network.isServiceActive('week', DAY), true)
  assert.equal(network.isServiceActive('week', '20261024'), false)
  assert.equal(network.isServiceActive('week', '20261111'), false)
  assert.equal(network.routes.get('A').color, '#F26521')
})

test('planJourneys: latest direct bus arriving in time', () => {
  const network = makeNetwork()
  const [first] = planJourneys(network, null, {
    origins: [{ stopId: 'gare', walkSeconds: 120 }],
    destinations: [{ stopId: 'iut', walkSeconds: 60 }],
    arriveByMs: at('08:00'),
  })
  assert.equal(fmt(first.leaveAt), '07:28')
  assert.equal(fmt(first.arriveAt), '07:46')
  assert.equal(first.transfers, 0)
  assert.equal(first.legs[0].line, 'A')
})

test('planJourneys: one change, at another stop of the same place', () => {
  const network = makeNetwork()
  const [journey] = planJourneys(network, null, {
    origins: [{ stopId: 'plage', walkSeconds: 0 }],
    destinations: [{ stopId: 'iut', walkSeconds: 0 }],
    arriveByMs: at('08:00'),
  })
  assert.equal(journey.transfers, 1)
  assert.deepEqual(journey.legs.map((leg) => leg.line), ['B', 'A'])
  assert.equal(fmt(journey.leaveAt), '07:10')
})

test('planJourneys: departing after a time, and the last bus of the day', () => {
  const network = makeNetwork()
  const options = { origins: [{ stopId: 'gare', walkSeconds: 0 }], destinations: [{ stopId: 'iut', walkSeconds: 0 }] }
  assert.equal(fmt(planJourneys(network, null, { ...options, departAtMs: at('07:31') })[0].leaveAt), '08:30')
  assert.equal(fmt(planJourneys(network, null, { ...options, lastOfDayKey: DAY })[0].leaveAt), '08:30')
  assert.deepEqual(planJourneys(network, null, { ...options, arriveByMs: at('07:00') }), [])
})

// Protobuf encoding, enough for a FeedMessage.
const varint = (value) => {
  const bytes = []
  let rest = BigInt.asUintN(64, BigInt(value))
  do {
    bytes.push(Number(rest & 0x7fn) | (rest > 0x7fn ? 0x80 : 0))
    rest >>= 7n
  } while (rest > 0n)
  return Buffer.from(bytes)
}
const num = (field, value) => Buffer.concat([varint(field << 3), varint(value)])
const msg = (field, ...parts) => {
  const body = Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part) : part)))
  return Buffer.concat([varint((field << 3) | 2), varint(body.length), body])
}

function realtimeFeed(timestampS, delayS) {
  return Buffer.concat([
    msg(1, msg(1, '2.0'), num(3, timestampS)),
    msg(2, msg(1, 'e1'), msg(3,
      msg(1, msg(1, 'A1')),
      msg(2, num(1, 2), msg(4, 'centre1'), msg(3, num(1, delayS))),
    )),
  ])
}

test('decodeTripUpdates and real-time delays in departures', () => {
  const network = makeNetwork()
  const now = at('07:20')
  const realtime = decodeTripUpdates(realtimeFeed(Math.floor(now / 1000), 300))
  assert.equal(realtime.trips.get('A1').updates[0].departure.delay, 300)
  assert.equal(decodeTripUpdates(realtimeFeed(1, -60)).trips.get('A1').updates[0].departure.delay, -60)

  const [next] = findDepartures(network, realtime, { stopIds: ['centre1', 'centre2'], fromMs: now })
  assert.equal(next.tripId, 'A1')
  assert.equal(fmt(next.departAt), '07:40')
  assert.equal(next.delayMin, 5)
  assert.equal(next.realtime, true)
})

test('push: only browser push services, well-formed reminders', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true)
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/abc'), true)
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/latest'), false)
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/x'), false)
  assert.equal(isAllowedPushEndpoint('https://evil.com/fcm.googleapis.com'), false)
  assert.equal(readSubscription({ endpoint: 'https://localhost/x', keys: { p256dh: 'a', auth: 'b' } }), null)

  const now = Date.now()
  const reminders = readReminders([
    { id: 'r1', kind: 'morning', at: now + 60_000, title: 'Bus', body: 'Ligne A', url: '/bus' },
    { id: 'r2', kind: 'morning', at: now + 30 * 24 * 3600e3, title: 'Trop loin', body: 'x' },
    { id: 'r3', kind: 'spam', at: now, title: 'x', body: 'x' },
    { id: 'r4', kind: 'return', at: now, title: 'x', body: 'x', url: 'https://evil.com' },
  ], now)
  assert.deepEqual(reminders.map((reminder) => reminder.id), ['r1', 'r4'])
  assert.equal(reminders[1].url, '/bus')
})

test('push store: sends due reminders once, then a delay alert', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'tafac-push-'))
  try {
    const network = makeNetwork()
    let clock = at('07:00')
    let realtime = null
    const sent = []
    const store = createTransitPushStore({
      universityId: 'test',
      dataDir,
      subject: 'https://example.org',
      feed: { getNetwork: async () => network, getRealtime: async () => realtime },
      send: async (subscription, payload) => { sent.push(payload) },
      now: () => clock,
      logger: { warn() {} },
    })
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }
    const reminders = readReminders([
      { id: 'r1', kind: 'morning', at: at('07:20'), title: 'Bus A à 7h35', body: 'Pars maintenant.', tripId: 'A1', stopId: 'centre1', departAt: at('07:35'), line: 'A' },
    ], clock)
    await store.setReminders(subscription, reminders)

    assert.equal(await store.tick(), 0)
    clock = at('07:20')
    assert.equal(await store.tick(), 1)
    assert.equal(sent[0].title, 'Bus A à 7h35')
    assert.equal(await store.tick(), 0)

    clock = at('07:25')
    realtime = decodeTripUpdates(realtimeFeed(Math.floor(clock / 1000), 6 * 60))
    assert.equal(await store.tick(), 1)
    assert.match(sent[1].title, /retard/)
    assert.match(sent[1].body, /6 min de retard, passage vers 07h41/)
    assert.equal(await store.tick(), 0)

    // A resync keeps what was already sent.
    await store.setReminders(subscription, readReminders([{ ...reminders[0] }], clock))
    assert.equal(await store.tick(), 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
