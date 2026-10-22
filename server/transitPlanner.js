// Departures and journeys on a network built by server/transitFeed.js, with
// the real-time trip updates when there are some. The networks are small
// (a few hundred trips a day), so journeys are found by plain enumeration:
// every direct trip, and every pair of trips with one change.

import { distanceMeters } from './transitFeed.js'

const WALK_SPEED_MPS = 1.2
// Streets aren't straight lines.
const WALK_DETOUR = 1.3
export const MAX_ACCESS_WALK_M = 900
const MAX_TRANSFER_WALK_M = 300
const MIN_TRANSFER_S = 120
const DAY_MS = 24 * 60 * 60 * 1000

export function walkSeconds(a, b) {
  return Math.round((distanceMeters(a, b) * WALK_DETOUR) / WALK_SPEED_MPS)
}

// --- Time: GTFS times count from noon minus 12 h of the service day, in the
// network's time zone ---

function zoneOffsetMs(epochMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(epochMs).map((part) => [part.type, part.value]))
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(epochMs / 1000) * 1000
}

// 'YYYYMMDD' of an instant in the network's zone.
export function serviceDateKey(epochMs, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(epochMs).replaceAll('-', '')
}

export function serviceDayStartMs(dateKey, timeZone) {
  const noonUtc = Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8)), 12)
  return noonUtc - zoneOffsetMs(noonUtc, timeZone) - 12 * 60 * 60 * 1000
}

function shiftDateKey(dateKey, days) {
  const date = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8)) + days))
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

// --- One trip run on one day, real time applied ---

// Expected times of each stop of `trip` run on `dateKey` (epoch ms):
// { arrivals, departures, scheduled, delays, realtime, canceled, skipped }.
// A stop without its own update takes the delay of the last update before
// it (GTFS-RT propagation); stops before the first update keep the schedule.
// shortcut: real time is matched by trip id only, so a trip running twice
// in the window (after midnight) gets today's update both times; harmless
// on networks that end before midnight.
export function runTrip(trip, dateKey, network, realtime) {
  const base = serviceDayStartMs(dateKey, network.timezone)
  const scheduled = trip.stopTimes.map((stopTime) => base + stopTime.departure * 1000)
  const arrivals = trip.stopTimes.map((stopTime) => base + stopTime.arrival * 1000)
  const departures = scheduled.slice()
  const delays = trip.stopTimes.map(() => 0)
  const skipped = trip.stopTimes.map(() => false)
  const update = realtime?.trips.get(trip.id)
  const isToday = update && serviceDateKey(realtime.timestamp * 1000, network.timezone) === dateKey
  if (!isToday) {
    return { trip, dateKey, arrivals, departures, scheduled, delays, skipped, realtime: false, canceled: false }
  }

  const bySequence = new Map()
  for (const entry of update.updates) {
    const index = entry.sequence != null
      ? trip.stopTimes.findIndex((stopTime) => stopTime.sequence === entry.sequence)
      : trip.stopTimes.findIndex((stopTime) => stopTime.stopId === entry.stopId)
    if (index >= 0) bySequence.set(index, entry)
  }
  let delay = null
  trip.stopTimes.forEach((stopTime, index) => {
    const entry = bySequence.get(index)
    if (entry) {
      skipped[index] = entry.skipped
      const event = entry.departure ?? entry.arrival
      if (event?.time != null) delay = event.time * 1000 - scheduled[index]
      else if (event?.delay != null) delay = event.delay * 1000
    }
    if (delay != null) {
      delays[index] = delay
      departures[index] = scheduled[index] + delay
      arrivals[index] = base + stopTime.arrival * 1000 + delay
    }
  })
  return { trip, dateKey, arrivals, departures, scheduled, delays, skipped, realtime: true, canceled: update.canceled }
}

// Runs of every trip active on the service days that can overlap
// [fromMs, toMs] (yesterday's runs past midnight included).
function activeRuns(network, realtime, fromMs, toMs) {
  const runs = []
  const firstKey = shiftDateKey(serviceDateKey(fromMs, network.timezone), -1)
  const lastKey = serviceDateKey(toMs, network.timezone)
  for (let dateKey = firstKey; dateKey <= lastKey; dateKey = shiftDateKey(dateKey, 1)) {
    const base = serviceDayStartMs(dateKey, network.timezone)
    for (const trip of network.trips.values()) {
      if (!network.isServiceActive(trip.serviceId, dateKey)) continue
      const start = base + trip.stopTimes[0].departure * 1000
      const end = base + trip.stopTimes[trip.stopTimes.length - 1].arrival * 1000
      // An hour of slack for delays.
      if (end + 60 * 60 * 1000 < fromMs || start - 60 * 60 * 1000 > toMs) continue
      const run = runTrip(trip, dateKey, network, realtime)
      if (!run.canceled) runs.push(run)
    }
  }
  return runs
}

function describeLeg(run, from, to, network) {
  const route = network.routes.get(run.trip.routeId)
  return {
    tripId: run.trip.id,
    routeId: route.id,
    line: route.shortName,
    color: route.color,
    textColor: route.textColor,
    headsign: run.trip.headsign,
    fromStopId: run.trip.stopTimes[from].stopId,
    toStopId: run.trip.stopTimes[to].stopId,
    departAt: run.departures[from],
    arriveAt: run.arrivals[to],
    scheduledDepartAt: run.scheduled[from],
    delayMin: Math.round(run.delays[from] / 60_000),
    realtime: run.realtime,
    stops: to - from,
  }
}

// Next departures from `stopIds` from `fromMs` on, soonest first.
export function findDepartures(network, realtime, { stopIds, fromMs, limit = 8, horizonMs = 3 * 60 * 60 * 1000 }) {
  const wanted = new Set(stopIds)
  const departures = []
  for (const run of activeRuns(network, realtime, fromMs, fromMs + horizonMs)) {
    const last = run.trip.stopTimes.length - 1
    run.trip.stopTimes.forEach((stopTime, index) => {
      if (index === last || !wanted.has(stopTime.stopId) || !stopTime.pickup || run.skipped[index]) return
      const departAt = run.departures[index]
      if (departAt < fromMs - 30_000 || departAt > fromMs + horizonMs) return
      departures.push(describeLeg(run, index, last, network))
    })
  }
  departures.sort((left, right) => left.departAt - right.departAt)
  return departures.slice(0, limit)
}

// Stops within walking distance of a point: [{ stopId, walkSeconds }].
export function stopsNear(network, point, radiusM = MAX_ACCESS_WALK_M) {
  const near = []
  for (const stop of network.stops.values()) {
    if (distanceMeters(point, stop) <= radiusM) near.push({ stopId: stop.id, walkSeconds: walkSeconds(point, stop) })
  }
  return near
}

// From a stop, the stops one can change to on foot (itself included).
function transferTargets(network, stopId) {
  network.transferCache ??= new Map()
  const cached = network.transferCache.get(stopId)
  if (cached) return cached
  const stop = network.stops.get(stopId)
  const targets = new Map([[stopId, 0]])
  for (const other of network.stops.values()) {
    if (other.id !== stopId && distanceMeters(stop, other) <= MAX_TRANSFER_WALK_M) targets.set(other.id, walkSeconds(stop, other))
  }
  for (const link of network.transfers.get(stopId) ?? []) {
    targets.set(link.stopId, Math.max(link.seconds, targets.get(link.stopId) ?? 0))
  }
  const list = [...targets].map(([id, seconds]) => ({ stopId: id, seconds }))
  network.transferCache.set(stopId, list)
  return list
}

// Journeys from `origins` to `destinations` ([{ stopId, walkSeconds }]),
// direct or with one change:
//   arriveByMs: arriving by then, leaving as late as possible;
//   departAtMs: leaving from then on, arriving as early as possible;
//   lastOfDayKey ('YYYYMMDD'): the latest journeys still leaving that day.
// → [{ leaveAt, arriveAt, walkToStopMin, walkFromStopMin, transfers, legs }]
export function planJourneys(network, realtime, { origins, destinations, arriveByMs = null, departAtMs = null, lastOfDayKey = null, limit = 3 }) {
  const originWalk = new Map(origins.map((origin) => [origin.stopId, origin.walkSeconds * 1000]))
  const destinationWalk = new Map(destinations.map((destination) => [destination.stopId, destination.walkSeconds * 1000]))
  if (!originWalk.size || !destinationWalk.size) return []

  let fromMs
  let toMs
  if (arriveByMs != null) { fromMs = arriveByMs - 4 * 60 * 60 * 1000; toMs = arriveByMs }
  else if (departAtMs != null) { fromMs = departAtMs; toMs = departAtMs + 6 * 60 * 60 * 1000 }
  else {
    fromMs = serviceDayStartMs(lastOfDayKey, network.timezone)
    toMs = serviceDayStartMs(lastOfDayKey, network.timezone) + DAY_MS + 4 * 60 * 60 * 1000
  }
  const runs = activeRuns(network, realtime, fromMs, toMs)
  const journeys = []

  // First legs: the best boarding point of each run (latest leave), and
  // where it can drop off.
  const arrivalsByStop = new Map()
  for (const run of runs) {
    let board = -1
    let leaveAt = -Infinity
    run.trip.stopTimes.forEach((stopTime, index) => {
      if (board >= 0 && stopTime.dropOff && !run.skipped[index]) {
        const walkEnd = destinationWalk.get(stopTime.stopId)
        if (walkEnd != null) {
          journeys.push({ leaveAt, arriveAt: run.arrivals[index] + walkEnd, walkStart: originWalk.get(run.trip.stopTimes[board].stopId), walkEnd, legs: [describeLeg(run, board, index, network)] })
        }
        const list = arrivalsByStop.get(stopTime.stopId) ?? []
        list.push({ run, board, alight: index, leaveAt, arrivedAt: run.arrivals[index] })
        arrivalsByStop.set(stopTime.stopId, list)
      }
      const walk = originWalk.get(stopTime.stopId)
      if (walk != null && stopTime.pickup && !run.skipped[index] && index < run.trip.stopTimes.length - 1) {
        const leave = run.departures[index] - walk
        if (leave > leaveAt) { board = index; leaveAt = leave }
      }
    })
  }

  // Second legs: a run boarded where a first leg can change to it.
  for (const run of runs) {
    run.trip.stopTimes.forEach((stopTime, index) => {
      if (!stopTime.pickup || run.skipped[index] || index === run.trip.stopTimes.length - 1) return
      let best = null
      for (const target of transferTargets(network, stopTime.stopId)) {
        for (const first of arrivalsByStop.get(target.stopId) ?? []) {
          if (first.run === run) continue
          if (first.arrivedAt + Math.max(target.seconds * 1000, MIN_TRANSFER_S * 1000) > run.departures[index]) continue
          if (!best || first.leaveAt > best.leaveAt) best = first
        }
      }
      // Not when the first leg already reaches the destination.
      if (!best || destinationWalk.has(best.run.trip.stopTimes[best.alight].stopId)) return
      for (let next = index + 1; next < run.trip.stopTimes.length; next += 1) {
        const walkEnd = destinationWalk.get(run.trip.stopTimes[next].stopId)
        if (walkEnd == null || !run.trip.stopTimes[next].dropOff || run.skipped[next]) continue
        journeys.push({
          leaveAt: best.leaveAt,
          arriveAt: run.arrivals[next] + walkEnd,
          walkStart: originWalk.get(best.run.trip.stopTimes[best.board].stopId),
          walkEnd,
          legs: [describeLeg(best.run, best.board, best.alight, network), describeLeg(run, index, next, network)],
        })
      }
    })
  }

  // A change costs 5 minutes when ranking: a direct bus a bit earlier beats
  // a tight change.
  const penalty = (journey) => (journey.legs.length - 1) * 5 * 60 * 1000
  let picked
  if (arriveByMs != null) {
    picked = journeys.filter((journey) => journey.arriveAt <= arriveByMs)
      .sort((left, right) => (right.leaveAt - penalty(right)) - (left.leaveAt - penalty(left)) || left.arriveAt - right.arriveAt)
  } else if (departAtMs != null) {
    picked = journeys.filter((journey) => journey.leaveAt >= departAtMs)
      .sort((left, right) => (left.arriveAt + penalty(left)) - (right.arriveAt + penalty(right)) || right.leaveAt - left.leaveAt)
  } else {
    const dayStart = serviceDayStartMs(lastOfDayKey, network.timezone)
    picked = journeys.filter((journey) => serviceDateKey(journey.leaveAt, network.timezone) === lastOfDayKey && journey.leaveAt >= dayStart)
      .sort((left, right) => right.leaveAt - left.leaveAt || left.arriveAt - right.arriveAt)
  }

  // One journey per first bus, and none that another beats on both ends.
  const result = []
  const seen = new Set()
  for (const journey of picked) {
    const key = `${journey.legs[0].tripId}|${journey.legs[0].departAt}`
    if (seen.has(key)) continue
    if (result.some((kept) => kept.leaveAt >= journey.leaveAt && kept.arriveAt <= journey.arriveAt && kept.legs.length <= journey.legs.length)) continue
    seen.add(key)
    result.push(journey)
    if (result.length >= limit) break
  }
  return result.map((journey) => ({
    leaveAt: journey.leaveAt,
    arriveAt: journey.arriveAt,
    walkToStopMin: Math.round(journey.walkStart / 60_000),
    walkFromStopMin: Math.round(journey.walkEnd / 60_000),
    transfers: journey.legs.length - 1,
    legs: journey.legs,
  }))
}
