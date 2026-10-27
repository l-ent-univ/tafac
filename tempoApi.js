// TEMPO (Université Rennes 2): the student's own timetable, behind the CAS.
// GET <origin>/api/events?start=YYYY-MM-DD&end=YYYY-MM-DD (both days
// included, nothing else accepted: other formats answer 500, a missing
// parameter 404) answers a JSON array, unsorted, of { id (stable), start,
// end ("YYYY-MM-DD HH:mm" on Paris clocks, or a bare date for a whole day),
// str_start, str_end, title, description (the group), location (one room
// per line), people[], color (hex, no #), url, url_label, info }. The text
// fields are HTML: TEMPO's page renders them as such. Without a session the
// API answers 401 JSON; GET /auth signs in with a CAS ticket.
// Research: docs/univ-rennes-2/.
//
// Same interface as createPlanningPortalApiClient (planningPortalApi.js), so
// the /__ent_auth/ade/* and /planning routes serve it unchanged. The
// timetable is personal: no group to pick, so the tree is a single
// "Mon emploi du temps" node, which the client adopts as the student's group
// (its defaultSelection), and the resource ids sent back are ignored.

const TEMPO_EVENTS_TTL_MS = 5 * 60 * 1000
// TEMPO often takes about 2 s; past this, the request is dropped.
const TEMPO_TIMEOUT_MS = 8000
const TEMPO_SIGN_IN_MAX_HOPS = 6
const TEMPO_RESOURCE_ID = 'tempo'
const TEMPO_RESOURCE_LABEL = 'Mon emploi du temps'

// Academic years already read, by session: { cachedAt, events }.
const tempoYearCache = new Map()
const tempoYearRequests = new Map()

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// A TEMPO text field (HTML) as plain text: <br> as a line break, other tags
// dropped, entities decoded.
function htmlToText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, decimal, hex, name) => {
      if (decimal) return String.fromCodePoint(Number(decimal))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      return HTML_ENTITIES[name.toLowerCase()] ?? entity
    })
}

function asText(value) {
  return htmlToText(value).replace(/\s+/g, ' ').trim()
}

function createZoneOffsetReader(timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Offset of `timeZone` from UTC at the instant `timestamp`, in ms.
  return (timestamp) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]))
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    return asUtc - Math.floor(timestamp / 1000) * 1000
  }
}

// "YYYY-MM-DD HH:mm" (or a bare date: midnight) read on `timeZone` clocks,
// whatever the server's own zone. Null when it isn't such a string.
export function parseTempoDateTime(value, timeZone = 'Europe/Paris') {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!match) {
    return null
  }

  const [year, month, day, hour = 0, minute = 0] = match.slice(1).map((part) => Number(part ?? 0))
  const wallClock = Date.UTC(year, month - 1, day, hour, minute)
  const offsetAt = createZoneOffsetReader(timeZone)
  let timestamp = wallClock - offsetAt(wallClock)
  // Near a clock change the first guess sits on the other side of it.
  const corrected = wallClock - offsetAt(timestamp)
  if (corrected !== timestamp) {
    timestamp = corrected
  }

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim())
}

function addDays(dateOnly, days) {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

// One TEMPO event in the shape of planningPortalApi's events, plus `allDay`,
// `notes` (TEMPO's info line) and `linkLabel`.
export function normalizeTempoEvent(event, timeZone = 'Europe/Paris') {
  if (!event || typeof event !== 'object') {
    return null
  }

  const allDay = isDateOnly(event.start)
  const startDate = parseTempoDateTime(event.start, timeZone)
  if (!startDate) {
    return null
  }

  // A whole day ends at the next midnight (its end day included).
  const endDate = allDay
    ? parseTempoDateTime(addDays(isDateOnly(event.end) ? String(event.end).trim() : String(event.start).trim(), 1), timeZone)
    : parseTempoDateTime(event.end, timeZone) ?? startDate
  const people = (Array.isArray(event.people) ? event.people : []).map(asText).filter(Boolean)
  const group = asText(event.description)
  const location = htmlToText(event.location)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')
  const color = asText(event.color)
  const link = asText(event.url)
  const startLabel = asText(event.str_start) || String(event.start).slice(11, 16)
  const endLabel = asText(event.str_end) || String(event.end ?? '').slice(11, 16)

  return {
    uid: `tempo-${asText(event.id)}`,
    title: asText(event.title) || 'Cours',
    teacher: people.join(' - '),
    location,
    groups: group ? [group] : [],
    groupsLabel: group,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    startMs: startDate.getTime(),
    endMs: endDate.getTime(),
    date: String(event.start).slice(0, 10),
    timeLabel: allDay ? 'Toute la journée' : `${startLabel} - ${endLabel}`,
    allDay,
    editable: false,
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '',
    hue: null,
    link: /^https?:\/\//i.test(link) ? link : null,
    linkLabel: asText(event.url_label).replace(/\s*:$/, '') || null,
    notes: asText(event.info) || null,
    resourceId: TEMPO_RESOURCE_ID,
    activityId: null,
  }
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

// [first day, day after the last] of `lookaheadDays` days from `date`
// (YYYY-MM-DD, today when missing), as YYYY-MM-DD strings.
export function buildTempoRange(date, lookaheadDays = 7, today = new Date()) {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const start = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + Math.max(1, Number(lookaheadDays) || 1))
  return { start: formatDateOnly(start), end: formatDateOnly(end) }
}

// The academic years (named by their first calendar year, from 1 July) a
// range touches. TEMPO's page asks for a whole one, as we do.
export function getTempoAcademicYears(range) {
  const yearOf = (dateOnly) => {
    const [year, month] = dateOnly.split('-').map(Number)
    return month >= 7 ? year : year - 1
  }
  const first = yearOf(range.start)
  const last = yearOf(addDays(range.end, -1))
  const years = []
  for (let year = first; year <= last; year += 1) {
    years.push(year)
  }
  return years
}

// What TEMPO is asked for an academic year: July to the next August, as
// its own calendar (both ends included).
export function buildTempoYearWindow(year) {
  return { start: `${year}-07-01`, end: `${year + 1}-08-31` }
}

function buildTempoTree() {
  const leaf = { id: TEMPO_RESOURCE_ID, name: TEMPO_RESOURCE_LABEL, path: `TEMPO.${TEMPO_RESOURCE_LABEL}`, children: [] }
  return {
    root: { id: 'tempo-root', name: 'TEMPO', path: 'TEMPO', children: [leaf] },
    leaf,
  }
}

function isRedirect(status) {
  return status >= 300 && status < 400
}

export function createTempoApiClient({
  casOrigin,
  tempoOrigin,
  timeZone = 'Europe/Paris',
  timeoutMs = TEMPO_TIMEOUT_MS,
  fetchWithJar,
} = {}) {
  if (!casOrigin || !tempoOrigin) {
    throw new TypeError('createTempoApiClient requires CAS and TEMPO origins.')
  }

  const tempoHost = new URL(tempoOrigin).hostname
  // TEMPO's CAS service: it comes back there with the ticket.
  const casLoginUrl = `${casOrigin}/login?service=${encodeURIComponent(`${tempoOrigin}/auth`)}`
  // One sign-in at a time per jar: parallel weeks share it instead of
  // overwriting each other's PHP session.
  const signIns = new WeakMap()

  function fetchTempo(url, jar, options = {}) {
    return fetchWithJar(url, jar, { ...options, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  }

  // CAS (with the TGC) → /auth?ticket → /auth → TEMPO. Done as soon as the
  // chain is back on TEMPO past /auth: the page itself isn't needed. A
  // session that remembered /auth loops there into a 403, signed in all the
  // same.
  function signIn(jar) {
    const pending = signIns.get(jar)
    if (pending) {
      return pending
    }

    const attempt = (async () => {
      let url = casLoginUrl
      for (let hop = 0; hop < TEMPO_SIGN_IN_MAX_HOPS; hop += 1) {
        const response = await fetchTempo(url, jar, { headers: { Accept: 'text/html,application/xhtml+xml,*/*' } })
        await response.arrayBuffer().catch(() => null)
        const location = response.headers.get('location')
        const onTempo = new URL(url).hostname === tempoHost

        if (!isRedirect(response.status) || !location) {
          if (onTempo) return
          throw new Error('TEMPO sign-in failed: the CAS session has expired.')
        }

        const next = new URL(location, url)
        if (next.hostname === tempoHost && next.pathname !== '/auth') return
        url = next.toString()
      }

      if (new URL(url).hostname !== tempoHost) {
        throw new Error('TEMPO sign-in failed: too many redirects.')
      }
    })()
    signIns.set(jar, attempt)
    const settle = () => signIns.delete(jar)
    attempt.then(settle, settle)
    return attempt
  }

  // { events } or { needsSignIn: true } (401, a redirect, or an HTML page);
  // any other answer is an error, without a pointless sign-in.
  async function requestEvents(jar, window) {
    const url = `${tempoOrigin}/api/events?start=${window.start}&end=${window.end}`
    const response = await fetchTempo(url, jar, {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${tempoOrigin}/`,
      },
    })
    const text = await response.text()

    if (response.status === 401 || isRedirect(response.status)) {
      return { needsSignIn: true }
    }
    if (!response.ok) {
      throw new Error(`TEMPO answered ${response.status}.`)
    }

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return { needsSignIn: true }
    }
    if (!Array.isArray(payload)) {
      throw new Error('TEMPO returned an unexpected answer.')
    }
    return { events: payload }
  }

  async function loadYear(jar, year) {
    const window = buildTempoYearWindow(year)
    let result = await requestEvents(jar, window)
    if (result.needsSignIn) {
      await signIn(jar)
      result = await requestEvents(jar, window)
    }
    if (result.needsSignIn) {
      throw new Error('TEMPO sign-in failed: no session after the CAS.')
    }

    const byUid = new Map()
    for (const rawEvent of result.events) {
      const event = normalizeTempoEvent(rawEvent, timeZone)
      if (event && !byUid.has(event.uid)) {
        byUid.set(event.uid, event)
      }
    }
    return [...byUid.values()]
  }

  // An academic year's events, from the session's cache or TEMPO. Parallel
  // asks for the same year share one request.
  async function getYear(jar, year, cacheScope) {
    if (!cacheScope) {
      return { events: await loadYear(jar, year), cache: 'miss' }
    }

    const key = `${cacheScope}::${year}`
    const cached = tempoYearCache.get(key)
    if (cached && Date.now() - cached.cachedAt < TEMPO_EVENTS_TTL_MS) {
      return { events: cached.events, cache: 'hit' }
    }

    let request = tempoYearRequests.get(key)
    if (!request) {
      request = loadYear(jar, year).then((events) => {
        for (const [otherKey, entry] of tempoYearCache) {
          if (Date.now() - entry.cachedAt >= TEMPO_EVENTS_TTL_MS) {
            tempoYearCache.delete(otherKey)
          }
        }
        tempoYearCache.set(key, { cachedAt: Date.now(), events })
        return events
      })
      tempoYearRequests.set(key, request)
      const settle = () => tempoYearRequests.delete(key)
      request.then(settle, settle)
    }
    return { events: await request, cache: 'miss' }
  }

  async function fetchPortalEvents(jar, {
    date = null,
    lookaheadDays = 7,
    cacheScope = null,
  } = {}) {
    const range = buildTempoRange(date, lookaheadDays)
    const years = await Promise.all(
      getTempoAcademicYears(range).map((year) => getYear(jar, year, cacheScope)),
    )

    // A year's window overlaps the next one's in July and August.
    const startMs = parseTempoDateTime(range.start, timeZone)?.getTime() ?? -Infinity
    const endMs = parseTempoDateTime(range.end, timeZone)?.getTime() ?? Infinity
    const byUid = new Map()
    for (const { events } of years) {
      for (const event of events) {
        if (event.endMs > startMs && event.startMs < endMs && !byUid.has(event.uid)) {
          byUid.set(event.uid, event)
        }
      }
    }
    const events = [...byUid.values()].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)

    return {
      complete: true,
      events,
      // Not one class in the whole academic year: TEMPO has no timetable for
      // this account (another campus, a course outside it, or one not yet
      // published), not a free week.
      noTimetable: years.every((year) => year.events.length === 0),
      resourceIds: [TEMPO_RESOURCE_ID],
      projectId: null,
      cache: years.every((year) => year.cache === 'hit') ? 'hit' : 'miss',
    }
  }

  async function fetchPortalTree() {
    const { root, leaf } = buildTempoTree()
    return {
      root,
      fullRoot: root,
      currentResourceId: leaf.id,
      focusResourceId: leaf.id,
      currentPathIds: [root.id, leaf.id],
      selectionPathIds: [leaf.id],
      selectionSchema: 'tempo-personal',
      defaultSelection: {
        resourceId: leaf.id,
        label: leaf.name,
        parentResourceId: null,
        parentLabel: null,
        contextLabel: leaf.name,
        programResourceId: null,
        programLabel: null,
        yearResourceId: null,
        yearLabel: null,
        tdResourceId: null,
        tdLabel: null,
        tpResourceId: null,
        tpLabel: null,
      },
      resources: [{ id: leaf.id, name: leaf.name }],
      projectId: null,
      cache: 'hit',
      authCache: null,
    }
  }

  async function searchPortalTree() {
    return { results: [], projectId: null, cache: 'hit' }
  }

  async function fetchPortalCalendar() {
    return { calendar: { alerts: [] }, projectId: null, cache: 'hit' }
  }

  // The API answering at all (200 signed in, 401 not) says TEMPO is up.
  async function fetchPortalStatus(jar) {
    const today = buildTempoRange(null, 1).start
    const response = await fetchTempo(`${tempoOrigin}/api/events?start=${today}&end=${today}`, jar, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
    await response.arrayBuffer().catch(() => null)
    return {
      ok: response.ok || response.status === 401,
      status: response.status,
      data: { service: 'tempo' },
    }
  }

  function clearPortalCaches(cacheScope = null) {
    if (!cacheScope) {
      return
    }

    for (const key of tempoYearCache.keys()) {
      if (key.startsWith(`${cacheScope}::`)) {
        tempoYearCache.delete(key)
      }
    }
  }

  return {
    clearPortalCaches,
    fetchPortalCalendar,
    fetchPortalEvents,
    fetchPortalStatus,
    fetchPortalTree,
    searchPortalTree,
  }
}
