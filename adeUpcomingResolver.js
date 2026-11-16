const DEFAULT_CAMPUS_UPCOMING_SOURCE = 'campus-api'
const DEFAULT_PLANNING_UPCOMING_SOURCE = 'planning'

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const timestamp = Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? timestamp : NaN
}

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function parseDateOnly(dateString) {
  const match = String(dateString ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const parsedDate = new Date(Number(year), Number(month) - 1, Number(day))
  parsedDate.setHours(0, 0, 0, 0)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function buildRequestedWindow(date, lookaheadDays) {
  const windowStart = parseDateOnly(date) ?? new Date()
  windowStart.setHours(0, 0, 0, 0)

  const windowEnd = new Date(windowStart)
  windowEnd.setDate(windowEnd.getDate() + Math.max(1, lookaheadDays))

  return {
    startMs: windowStart.getTime(),
    endMs: windowEnd.getTime(),
  }
}

function buildWeekDates(date, lookaheadDays) {
  const baseDate = parseDateOnly(date) ?? new Date()
  baseDate.setHours(0, 0, 0, 0)

  const weeksToQuery = Math.max(1, Math.ceil((Math.max(1, lookaheadDays) + 6) / 7))

  return Array.from({ length: weeksToQuery }, (_, index) => {
    const weekDate = new Date(baseDate)
    weekDate.setDate(baseDate.getDate() + index * 7)
    return formatDateOnly(weekDate)
  })
}

function compareEvents(left, right) {
  const leftStart = Number.isFinite(left?.startMs) ? left.startMs : toTimestamp(left?.start)
  const rightStart = Number.isFinite(right?.startMs) ? right.startMs : toTimestamp(right?.start)

  if (leftStart !== rightStart) {
    return leftStart - rightStart
  }

  const leftEnd = Number.isFinite(left?.endMs) ? left.endMs : toTimestamp(left?.end)
  const rightEnd = Number.isFinite(right?.endMs) ? right.endMs : toTimestamp(right?.end)

  if (leftEnd !== rightEnd) {
    return leftEnd - rightEnd
  }

  return String(left?.title ?? '').localeCompare(String(right?.title ?? ''))
}

function buildEventKey(event) {
  return [
    event?.title ?? '',
    event?.teacher ?? '',
    event?.location ?? '',
    event?.start ?? '',
    event?.end ?? '',
    Array.isArray(event?.groups) ? event.groups.join('|') : event?.groupsLabel ?? '',
  ].join('||')
}

function findNextUpcomingEvent(events = [], nowMs = Date.now()) {
  for (const event of events) {
    const endTimestamp = Number.isFinite(event?.endMs)
      ? event.endMs
      : event?.end
        ? toTimestamp(event.end)
        : toTimestamp(event?.start)

    if (Number.isFinite(endTimestamp) && endTimestamp > nowMs) {
      return event
    }
  }

  return null
}

function normalizePlanningFallbackEvent(event) {
  if (!event || typeof event !== 'object') {
    return null
  }

  const startMs = toTimestamp(event.start)
  if (!Number.isFinite(startMs)) {
    return null
  }

  const endMs = Number.isFinite(event?.endMs)
    ? event.endMs
    : event.end
      ? toTimestamp(event.end)
      : startMs

  return {
    uid: String(event.uid ?? ''),
    title: String(event.title ?? '').trim(),
    teacher: String(event.teacher ?? '').trim(),
    location: String(event.location ?? '').trim(),
    groups: Array.isArray(event.groups) ? event.groups.filter(Boolean) : [],
    groupsLabel: Array.isArray(event.groups) ? event.groups.filter(Boolean).join(', ') : '',
    start: String(event.start ?? ''),
    end: String(event.end ?? ''),
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : startMs,
    dayIndex: event.dayIndex ?? null,
    dayLabel: String(event.dayLabel ?? '').trim(),
    date: String(event.date ?? '').trim(),
    timeLabel: String(event.timeLabel ?? '').trim(),
    editable: Boolean(event.editable),
    color: String(event.color ?? '').trim(),
    hue: Number.isFinite(Number(event.hue)) ? Number(event.hue) : null,
    link: event.link ?? null,
  }
}

function buildTreeNodeIndex(node, index = new Map()) {
  if (!node || typeof node !== 'object') {
    return index
  }

  index.set(String(node.id ?? ''), node)

  for (const child of Array.isArray(node.children) ? node.children : []) {
    buildTreeNodeIndex(child, index)
  }

  return index
}

async function recoverSelectionLabelsFromPlanningTree(fetchPlanningTreeFromRpc, jar, {
  resourceIds = [],
  cacheScope = null,
} = {}) {
  const recoveredLabels = []
  const normalizedResourceIds = resourceIds
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  for (const resourceId of normalizedResourceIds) {
    const tree = await fetchPlanningTreeFromRpc(jar, resourceId, { cacheScope })
    const nodeIndex = buildTreeNodeIndex(tree?.root)
    const currentPathLabels = (Array.isArray(tree?.currentPathIds) ? tree.currentPathIds : [])
      .map((nodeId) => String(nodeIndex.get(String(nodeId))?.name ?? '').trim())
      .filter(Boolean)

    recoveredLabels.push(...currentPathLabels.slice(-3))

    const focusNode = nodeIndex.get(String(tree?.focusResourceId ?? ''))
    const focusChildren = Array.isArray(focusNode?.children) ? focusNode.children : []
    recoveredLabels.push(
      ...focusChildren
        .map((child) => String(child?.name ?? '').trim())
        .filter(Boolean),
    )

    if (recoveredLabels.length > 0) {
      break
    }
  }

  return recoveredLabels.filter((label, index) => recoveredLabels.indexOf(label) === index)
}

async function fetchPlanningFallbackUpcoming(fetchPlanningTimetableFromRpc, jar, {
  date,
  lookaheadDays = 21,
  resourceIds = [],
  selectionLabels = [],
  cacheScope = null,
  source = DEFAULT_PLANNING_UPCOMING_SOURCE,
} = {}) {
  const normalizedResourceIds = resourceIds
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const { startMs, endMs } = buildRequestedWindow(date, lookaheadDays)
  const weekDates = buildWeekDates(date, lookaheadDays)
  const seenEventKeys = new Set()
  const events = []

  for (const resourceId of normalizedResourceIds) {
    for (const weekDate of weekDates) {
      const timetable = await fetchPlanningTimetableFromRpc(jar, weekDate, resourceId, { cacheScope })
      const timetableEvents = Array.isArray(timetable?.events) ? timetable.events : []

      for (const rawEvent of timetableEvents) {
        const event = normalizePlanningFallbackEvent(rawEvent)

        if (!event) {
          continue
        }

        if (event.endMs < startMs || event.startMs >= endMs) {
          continue
        }

        const eventKey = buildEventKey(event)
        if (seenEventKeys.has(eventKey)) {
          continue
        }

        seenEventKeys.add(eventKey)
        events.push(event)
      }
    }
  }

  events.sort(compareEvents)

  return {
    complete: true,
    events,
    resourceIds: normalizedResourceIds,
    selectionLabels: selectionLabels.filter(Boolean),
    authMode: 'planning-rpc',
    apiStatus: 200,
    cache: 'fallback-rpc',
    sessionCache: null,
    source,
  }
}

export function createAdeUpcomingResolver({
  fetchAdeUpcomingFromApi,
  fetchPlanningTreeFromRpc,
  fetchPlanningTimetableFromRpc,
  campusSource = DEFAULT_CAMPUS_UPCOMING_SOURCE,
  planningSource = DEFAULT_PLANNING_UPCOMING_SOURCE,
}) {
  async function resolveAdeUpcoming(jar, credentials, {
    date,
    lookaheadDays = 21,
    resourceIds = [],
    selectionLabels = [],
    cacheScope = null,
  } = {}) {
    // No ADE mobile API (origins.ade: null): the Planning is the only source,
    // and no group chosen yet means no events rather than an error.
    if (!fetchAdeUpcomingFromApi) {
      const planningResult = await fetchPlanningFallbackUpcoming(fetchPlanningTimetableFromRpc, jar, {
        date,
        lookaheadDays,
        resourceIds,
        selectionLabels,
        cacheScope,
        source: planningSource,
      })
      return { ...planningResult, nextEvent: findNextUpcomingEvent(planningResult.events), fallback: null }
    }

    let primaryResult = null
    let primaryError = null

    try {
      primaryResult = await fetchAdeUpcomingFromApi(jar, credentials, {
        date,
        lookaheadDays,
        resourceIds,
        selectionLabels,
        cacheScope,
      })
    } catch (error) {
      primaryError = error
    }

    const primaryNextEvent = primaryResult ? findNextUpcomingEvent(primaryResult.events) : null
    let recoveredCampusResult = null
    let recoveredCampusError = null

    if (
      primaryResult
      && selectionLabels.length > 0
      && (!primaryNextEvent || primaryResult.events.length === 0)
    ) {
      try {
        const recoveredSelectionLabels = await recoverSelectionLabelsFromPlanningTree(fetchPlanningTreeFromRpc, jar, {
          resourceIds,
          cacheScope,
        })

        if (recoveredSelectionLabels.length > 0) {
          recoveredCampusResult = await fetchAdeUpcomingFromApi(jar, credentials, {
            date,
            lookaheadDays,
            resourceIds,
            selectionLabels: recoveredSelectionLabels,
            cacheScope,
          })
        }
      } catch (error) {
        recoveredCampusError = error
      }
    }

    const recoveredCampusNextEvent = recoveredCampusResult
      ? findNextUpcomingEvent(recoveredCampusResult.events)
      : null

    if (
      recoveredCampusResult
      && (
        recoveredCampusNextEvent
        || recoveredCampusResult.events.length > (primaryResult?.events?.length ?? 0)
      )
    ) {
      return {
        ...recoveredCampusResult,
        source: campusSource,
        nextEvent: recoveredCampusNextEvent,
        fallback: {
          used: true,
          reason: 'selection-label-recovered',
          primarySource: campusSource,
          primaryError: null,
        },
      }
    }

    const fallbackReason = primaryError
      ? 'campus-error'
      : primaryResult?.complete === false
        ? 'campus-incomplete'
        : primaryNextEvent
          ? null
          : 'campus-no-next-event'

    let fallbackResult = null
    let fallbackError = null

    if (fallbackReason && resourceIds.length > 0) {
      try {
        fallbackResult = await fetchPlanningFallbackUpcoming(fetchPlanningTimetableFromRpc, jar, {
          date,
          lookaheadDays,
          resourceIds,
          selectionLabels,
          cacheScope,
          source: planningSource,
        })
      } catch (error) {
        fallbackError = error
      }
    }

    const fallbackNextEvent = fallbackResult ? findNextUpcomingEvent(fallbackResult.events) : null
    const fallbackShouldWin = Boolean(
      fallbackResult
      && (
        fallbackNextEvent
        || primaryError
        || primaryResult?.complete === false
        || (fallbackResult.events.length > (primaryResult?.events?.length ?? 0))
      )
    )

    if (fallbackShouldWin) {
      return {
        ...fallbackResult,
        nextEvent: fallbackNextEvent,
        fallback: {
          used: true,
          reason: fallbackReason,
          primarySource: campusSource,
          primaryError: primaryError instanceof Error ? primaryError.message : null,
        },
      }
    }

    if (primaryResult) {
      return {
        ...primaryResult,
        source: campusSource,
        nextEvent: primaryNextEvent,
        fallback: fallbackReason
          ? {
            used: false,
            reason: fallbackReason,
            error: (
              fallbackError instanceof Error
                ? fallbackError.message
                : recoveredCampusError instanceof Error
                  ? recoveredCampusError.message
                  : null
            ),
          }
          : null,
      }
    }

    if (fallbackResult) {
      return {
        ...fallbackResult,
        nextEvent: fallbackNextEvent,
        fallback: {
          used: true,
          reason: fallbackReason ?? 'campus-error',
          primarySource: campusSource,
          primaryError: primaryError instanceof Error ? primaryError.message : null,
        },
      }
    }

    throw primaryError ?? fallbackError ?? new Error('Unable to load ADE upcoming data.')
  }

  return {
    resolveAdeUpcoming,
  }
}
