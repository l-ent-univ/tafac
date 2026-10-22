// Bus network (« Bus » page, its card, the planning's bus rows and the push
// reminders), from the network's open data: a static GTFS zip and, when the
// network publishes one, a GTFS-RT feed of trip updates. Public data, no
// sign-in. The zip and the protobuf are read with node's zlib and a few
// lines of wire-format decoding: the files are small and their shape fixed.

import { inflateRawSync } from 'node:zlib'

const FEED_TIMEOUT_MS = 20_000

// --- Zip: the central directory, then each entry's raw deflate data ---

export function readZipEntries(buffer) {
  const entries = new Map()
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('GTFS zip: no central directory')
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('GTFS zip: bad central directory')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    entries.set(name.replace(/^.*\//, ''), method === 8 ? inflateRawSync(data) : Buffer.from(data))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

// --- CSV (RFC 4180: quoted fields, doubled quotes, BOM) ---

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const raw = String(text ?? '')
  // A byte-order mark (0xFEFF) before the header.
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  row.push(field)
  if (row.some((value) => value !== '')) rows.push(row)
  const [header = [], ...body] = rows
  const keys = header.map((key) => key.trim())
  return body.map((values) => Object.fromEntries(keys.map((key, index) => [key, (values[index] ?? '').trim()])))
}

// "25:10:00" → seconds after the service day's start (GTFS allows > 24 h).
export function parseGtfsTime(value) {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim())
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

// Douglas-Peucker on [lat, lon] pairs, `tolerance` in degrees.
function simplifyLine(points, tolerance) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    const [ay, ax] = points[first]
    const [by, bx] = points[last]
    const length = Math.hypot(bx - ax, by - ay) || 1e-12
    let farthest = -1
    let farthestDistance = tolerance
    for (let index = first + 1; index < last; index += 1) {
      const [py, px] = points[index]
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
      if (distance > farthestDistance) { farthest = index; farthestDistance = distance }
    }
    if (farthest > 0) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, index) => keep[index])
}

const round5 = (value) => Math.round(value * 1e5) / 1e5

// Stops of the same name within this distance are one place (both sides of
// the road, the bays of a station): what the student picks and sees.
const PLACE_RADIUS_M = 400

function groupPlaces(stops) {
  const byName = new Map()
  for (const stop of stops.values()) {
    const key = stop.name.toLocaleLowerCase('fr').replace(/\s+/g, ' ')
    const clusters = byName.get(key) ?? []
    const cluster = clusters.find((entry) => distanceMeters(entry.stops[0], stop) <= PLACE_RADIUS_M)
    if (cluster) cluster.stops.push(stop)
    else clusters.push({ stops: [stop] })
    byName.set(key, clusters)
  }
  const places = new Map()
  for (const clusters of byName.values()) {
    for (const { stops: members } of clusters) {
      const stopIds = members.map((stop) => stop.id).sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      const place = {
        id: stopIds[0],
        name: members[0].name,
        lat: round5(members.reduce((sum, stop) => sum + stop.lat, 0) / members.length),
        lon: round5(members.reduce((sum, stop) => sum + stop.lon, 0) / members.length),
        stopIds,
      }
      places.set(place.id, place)
      for (const stop of members) stop.placeId = place.id
    }
  }
  return places
}

// GTFS files (Map name → Buffer) → the network, indexed for the planner.
export function buildNetwork(files) {
  const read = (name) => (files.has(name) ? parseCsv(files.get(name).toString('utf8')) : [])

  const agency = read('agency.txt')[0] ?? {}
  const stops = new Map()
  for (const row of read('stops.txt')) {
    // Stations (location_type 1) and entrances group stops; only stops are served.
    if (row.location_type && row.location_type !== '0') continue
    const lat = Number(row.stop_lat)
    const lon = Number(row.stop_lon)
    if (!row.stop_id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    stops.set(row.stop_id, { id: row.stop_id, name: row.stop_name || row.stop_id, lat, lon, placeId: null })
  }
  const places = groupPlaces(stops)

  const routes = new Map()
  for (const row of read('routes.txt')) {
    routes.set(row.route_id, {
      id: row.route_id,
      shortName: row.route_short_name || row.route_id,
      longName: row.route_long_name || '',
      color: /^[0-9a-f]{6}$/i.test(row.route_color) ? `#${row.route_color.toUpperCase()}` : '#6B7280',
      textColor: /^[0-9a-f]{6}$/i.test(row.route_text_color) ? `#${row.route_text_color.toUpperCase()}` : null,
      sortOrder: Number(row.route_sort_order) || 0,
    })
  }

  const trips = new Map()
  for (const row of read('trips.txt')) {
    if (!routes.has(row.route_id)) continue
    trips.set(row.trip_id, {
      id: row.trip_id,
      routeId: row.route_id,
      serviceId: row.service_id,
      headsign: row.trip_headsign || '',
      directionId: row.direction_id === '1' ? 1 : 0,
      shapeId: row.shape_id || null,
      stopTimes: [],
    })
  }
  for (const row of read('stop_times.txt')) {
    const trip = trips.get(row.trip_id)
    if (!trip || !stops.has(row.stop_id)) continue
    const arrival = parseGtfsTime(row.arrival_time)
    const departure = parseGtfsTime(row.departure_time)
    if (arrival == null && departure == null) continue
    trip.stopTimes.push({
      stopId: row.stop_id,
      sequence: Number(row.stop_sequence),
      arrival: arrival ?? departure,
      departure: departure ?? arrival,
      // 1: no pickup / no drop-off at this stop.
      pickup: row.pickup_type !== '1',
      dropOff: row.drop_off_type !== '1',
    })
  }
  for (const [id, trip] of trips) {
    trip.stopTimes.sort((left, right) => left.sequence - right.sequence)
    if (trip.stopTimes.length < 2) trips.delete(id)
  }

  const calendars = new Map()
  for (const row of read('calendar.txt')) {
    calendars.set(row.service_id, {
      days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => row[day] === '1'),
      start: row.start_date,
      end: row.end_date,
    })
  }
  const exceptions = new Map()
  for (const row of read('calendar_dates.txt')) {
    exceptions.set(`${row.service_id}|${row.date}`, row.exception_type === '1')
  }

  // Walking links between stops the network declares (transfers.txt).
  const transfers = new Map()
  for (const row of read('transfers.txt')) {
    if (!stops.has(row.from_stop_id) || !stops.has(row.to_stop_id) || row.transfer_type === '3') continue
    const list = transfers.get(row.from_stop_id) ?? []
    list.push({ stopId: row.to_stop_id, seconds: Number(row.min_transfer_time) || 0 })
    transfers.set(row.from_stop_id, list)
  }

  const shapePoints = new Map()
  for (const row of read('shapes.txt')) {
    const list = shapePoints.get(row.shape_id) ?? []
    list.push([Number(row.shape_pt_sequence), Number(row.shape_pt_lat), Number(row.shape_pt_lon)])
    shapePoints.set(row.shape_id, list)
  }

  // One drawing per route and direction: its longest trip (most stops), its
  // stops in order (the schematic plan) and its shape, simplified (the map).
  // shortcut: branches of a route show as their longest variant only; draw
  // every distinct stop pattern if a network relies on branches.
  const lines = []
  const tripsByRouteDirection = new Map()
  for (const trip of trips.values()) {
    const key = `${trip.routeId}|${trip.directionId}`
    const best = tripsByRouteDirection.get(key)
    if (!best || trip.stopTimes.length > best.stopTimes.length) tripsByRouteDirection.set(key, trip)
  }
  for (const trip of tripsByRouteDirection.values()) {
    const placeIds = []
    for (const stopTime of trip.stopTimes) {
      const placeId = stops.get(stopTime.stopId).placeId
      if (placeIds[placeIds.length - 1] !== placeId) placeIds.push(placeId)
    }
    const raw = (shapePoints.get(trip.shapeId) ?? [])
      .sort((left, right) => left[0] - right[0])
      .map(([, lat, lon]) => [lat, lon])
    const shape = raw.length > 1
      ? simplifyLine(raw, 0.00008).map(([lat, lon]) => [round5(lat), round5(lon)])
      : placeIds.map((placeId) => [places.get(placeId).lat, places.get(placeId).lon])
    lines.push({ routeId: trip.routeId, directionId: trip.directionId, headsign: trip.headsign, placeIds, shape })
  }

  const stopVisits = new Map()
  for (const trip of trips.values()) {
    trip.stopTimes.forEach((stopTime, index) => {
      const list = stopVisits.get(stopTime.stopId) ?? []
      list.push({ trip, index })
      stopVisits.set(stopTime.stopId, list)
    })
  }

  const routeIdsByPlace = new Map()
  for (const trip of trips.values()) {
    for (const stopTime of trip.stopTimes) {
      const placeId = stops.get(stopTime.stopId).placeId
      const set = routeIdsByPlace.get(placeId) ?? new Set()
      set.add(trip.routeId)
      routeIdsByPlace.set(placeId, set)
    }
  }
  // Places no trip serves (stops left in the file) aren't offered.
  for (const placeId of places.keys()) {
    if (!routeIdsByPlace.has(placeId)) places.delete(placeId)
  }

  const serviceDates = [...calendars.values()].flatMap((calendar) => [calendar.start, calendar.end]).filter(Boolean)
  for (const key of exceptions.keys()) serviceDates.push(key.split('|')[1])
  serviceDates.sort()

  return {
    agencyName: agency.agency_name || null,
    timezone: agency.agency_timezone || 'Europe/Paris',
    stops,
    places,
    routes,
    trips,
    transfers,
    lines,
    stopVisits,
    routeIdsByPlace,
    validFrom: serviceDates[0] ?? null,
    validUntil: serviceDates[serviceDates.length - 1] ?? null,
    // 'YYYYMMDD' → whether the service runs that day.
    isServiceActive(serviceId, dateKey) {
      const exception = exceptions.get(`${serviceId}|${dateKey}`)
      if (exception !== undefined) return exception
      const calendar = calendars.get(serviceId)
      if (!calendar || dateKey < calendar.start || dateKey > calendar.end) return false
      const day = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8)))).getUTCDay()
      return calendar.days[day]
    },
  }
}

// --- GTFS-RT: FeedMessage → trip updates (protobuf wire format) ---

function* readFields(buffer, start = 0, end = buffer.length) {
  let offset = start
  const readVarint = () => {
    let result = 0n
    let shift = 0n
    for (;;) {
      if (offset >= end) throw new Error('GTFS-RT: truncated varint')
      const byte = buffer[offset++]
      result |= BigInt(byte & 0x7f) << shift
      if (!(byte & 0x80)) return result
      shift += 7n
    }
  }
  while (offset < end) {
    const key = Number(readVarint())
    const field = key >> 3
    const wire = key & 7
    if (wire === 0) yield { field, value: readVarint() }
    else if (wire === 2) {
      const length = Number(readVarint())
      yield { field, start: offset, end: offset + length }
      offset += length
    } else if (wire === 1) offset += 8
    else if (wire === 5) offset += 4
    else throw new Error(`GTFS-RT: unsupported wire type ${wire}`)
  }
}

const text = (buffer, entry) => buffer.toString('utf8', entry.start, entry.end)

function readStopTimeEvent(buffer, entry) {
  const event = { delay: null, time: null }
  for (const field of readFields(buffer, entry.start, entry.end)) {
    if (field.field === 1) event.delay = Number(BigInt.asIntN(32, field.value))
    if (field.field === 2) event.time = Number(BigInt.asIntN(64, field.value))
  }
  return event
}

// → { timestamp (s), trips: Map(tripId → { canceled, updates: [{ sequence,
//   stopId, arrival, departure, skipped }] }) }, arrival/departure being
//   { delay (s), time (epoch s) } or null.
export function decodeTripUpdates(buffer) {
  const trips = new Map()
  let timestamp = null
  for (const top of readFields(buffer)) {
    if (top.field === 1) {
      for (const field of readFields(buffer, top.start, top.end)) {
        if (field.field === 3) timestamp = Number(field.value)
      }
      continue
    }
    if (top.field !== 2) continue
    for (const entityField of readFields(buffer, top.start, top.end)) {
      if (entityField.field !== 3) continue
      let tripId = null
      let canceled = false
      const updates = []
      for (const field of readFields(buffer, entityField.start, entityField.end)) {
        if (field.field === 1) {
          for (const descriptor of readFields(buffer, field.start, field.end)) {
            if (descriptor.field === 1) tripId = text(buffer, descriptor)
            // schedule_relationship 3: CANCELED.
            if (descriptor.field === 4 && Number(descriptor.value) === 3) canceled = true
          }
        } else if (field.field === 2) {
          const update = { sequence: null, stopId: null, arrival: null, departure: null, skipped: false }
          for (const part of readFields(buffer, field.start, field.end)) {
            if (part.field === 1) update.sequence = Number(part.value)
            if (part.field === 4) update.stopId = text(buffer, part)
            if (part.field === 2) update.arrival = readStopTimeEvent(buffer, part)
            if (part.field === 3) update.departure = readStopTimeEvent(buffer, part)
            if (part.field === 5 && Number(part.value) === 1) update.skipped = true
          }
          updates.push(update)
        }
      }
      if (tripId) trips.set(tripId, { canceled, updates })
    }
  }
  return { timestamp, trips }
}

async function fetchBuffer(url, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Transit feed answered ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

// A cached loader: concurrent calls share one load, a failed refresh keeps
// serving the last good value.
function createCachedLoader(load, ttlMs, now) {
  let cached = null
  let loadedAt = 0
  let pending = null
  return async function get() {
    if (cached && now() - loadedAt < ttlMs) return cached
    pending ??= load().then((value) => { cached = value; loadedAt = now(); return value }).finally(() => { pending = null })
    try {
      return await pending
    } catch (error) {
      if (cached) return cached
      throw error
    }
  }
}

// Real time older than this is ignored (the feed stops updating at night
// and keeps serving the day's last snapshot).
export const REALTIME_MAX_AGE_MS = 5 * 60 * 1000

// { getNetwork(), getRealtime() }: the GTFS refreshed twice a day, the
// trip updates every 30 s; getRealtime() is null without a feed, on a
// failure or when the feed is stale.
// shortcut: the GTFS lives in memory only, so a restart while the network's
// server is down leaves the page empty; keep a copy in DATA_DIR if it happens.
export function createTransitFeed({ gtfsUrl, realtimeUrl = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const getNetwork = createCachedLoader(async () => buildNetwork(readZipEntries(await fetchBuffer(gtfsUrl, fetchImpl))), 12 * 60 * 60 * 1000, now)
  const loadRealtime = realtimeUrl
    ? createCachedLoader(async () => decodeTripUpdates(await fetchBuffer(realtimeUrl, fetchImpl)), 30_000, now)
    : null

  return {
    getNetwork,
    async getRealtime() {
      if (!loadRealtime) return null
      try {
        const realtime = await loadRealtime()
        return realtime.timestamp && now() - realtime.timestamp * 1000 <= REALTIME_MAX_AGE_MS ? realtime : null
      } catch {
        return null
      }
    },
  }
}
