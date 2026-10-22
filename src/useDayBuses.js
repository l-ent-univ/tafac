import { useEffect, useMemo, useState } from 'react'
import { buildDayQueries, buildLastBusQueries, classDays, mergeDayJourneys } from './transitDay'
import { fetchJourneys, isTransitAvailable, useTransitSettings, useUpcomingClasses } from './transitApi'

// The buses of the coming days with classes (src/transitDay.js), for the
// « Bus » page, its card, the greeting briefing and the reminders sync.
// One request set per home stop / margin / timetable, shared by all of
// them for a few minutes (real time moves the answers a little).

const SHARED_TTL_MS = 3 * 60 * 1000
const shared = new Map()

// The time, moved on every minute while the page is visible (and right
// away when it comes back), so long-mounted views drop the buses gone.
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    const interval = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

async function planDays(days, { home, campus, marginMin }) {
  const now = Date.now()
  const queries = buildDayQueries(days, { home, campus, marginMin, now })
  if (!queries.length) return { plans: [], realtime: false }
  const { results, realtime } = await fetchJourneys(queries.map((entry) => entry.query))
  const plans = mergeDayJourneys(days, queries, results)
  const lastBusQueries = buildLastBusQueries(plans, { home, campus })
  if (lastBusQueries.length) {
    const answer = await fetchJourneys(lastBusQueries.map((entry) => entry.query)).catch(() => null)
    lastBusQueries.forEach((entry, index) => {
      const plan = plans.find((candidate) => candidate.dayKey === entry.dayKey)
      // No bus at all that day (Sunday, holidays): nothing to warn about.
      if (plan) plan.lastBus = answer?.results?.[index]?.[0] ?? null
    })
  }
  return { plans, realtime }
}

// → { status: 'off' | 'no-home' | 'loading' | 'ok' | 'error', plans, realtime }
// `enabled: false`: nothing is fetched ('off').
export function useDayBuses({ establishment, selection, sessionUser, enabled = true }) {
  const available = enabled && isTransitAvailable(establishment)
  const settings = useTransitSettings()
  const events = useUpcomingClasses({ selection, sessionUser, enabled: available && Boolean(settings.homePlaceId) })
  const [state, setState] = useState({ key: null, status: 'loading', plans: [], realtime: false })
  const now = useMinuteClock()

  const days = useMemo(() => classDays(events ?? [], now), [events, now])
  const key = available && settings.homePlaceId && events
    ? JSON.stringify([settings.homePlaceId, settings.marginMin, establishment, days.map((day) => [day.first.start, day.last.end])])
    : null

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    let entry = shared.get(key)
    if (!entry || Date.now() - entry.at > SHARED_TTL_MS) {
      entry = {
        at: Date.now(),
        promise: planDays(days, { home: { placeId: settings.homePlaceId }, campus: { campus: establishment }, marginMin: settings.marginMin }),
      }
      entry.promise.catch(() => shared.delete(key))
      shared.set(key, entry)
    }
    entry.promise
      .then((result) => { if (!cancelled) setState({ key, status: 'ok', ...result }) })
      .catch(() => { if (!cancelled) setState({ key, status: 'error', plans: [], realtime: false }) })
    return () => { cancelled = true }
  }, [days, establishment, key, settings.homePlaceId, settings.marginMin])

  if (!available) return { status: 'off', plans: [], realtime: false }
  if (!settings.homePlaceId) return { status: 'no-home', plans: [], realtime: false }
  if (!key || state.key !== key) return { status: 'loading', plans: [], realtime: false }
  return state
}

// A class of the planning's sheet (start/end in ms): the bus there when it
// is the day's first class, the bus home when it is the last, among
// `events` (the planning's loaded classes).
// → { status: 'off' | 'no-home' | 'loading' | 'ok' | 'error', to, from }
export function useEventBuses(event, events, establishment) {
  const available = isTransitAvailable(establishment)
  const settings = useTransitSettings()
  const sameDay = (events ?? []).filter((other) => new Date(other.start).toDateString() === new Date(event.start).toDateString())
  const isFirst = !sameDay.some((other) => other.start < event.start)
  const isLast = !sameDay.some((other) => other.end > event.end)
  const now = useMinuteClock()
  const wantTo = isFirst && event.start - settings.marginMin * 60_000 > now
  const wantFrom = isLast && event.end > now - 60 * 60_000
  const key = available && settings.homePlaceId && (wantTo || wantFrom)
    ? JSON.stringify([settings.homePlaceId, settings.marginMin, establishment, wantTo && event.start, wantFrom && event.end])
    : null
  const [state, setState] = useState({ key: null, status: 'loading', to: null, from: null })

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    const home = { placeId: settings.homePlaceId }
    const campus = { campus: establishment }
    const queries = [
      wantTo ? { from: home, to: campus, arriveBy: event.start - settings.marginMin * 60_000, limit: 1 } : null,
      wantFrom ? { from: campus, to: home, departAt: Math.max(event.end, Date.now()), limit: 1 } : null,
    ]
    fetchJourneys(queries.filter(Boolean))
      .then(({ results }) => {
        if (cancelled) return
        const answers = [...results]
        const to = wantTo ? answers.shift()?.[0] ?? null : null
        const fromJourney = wantFrom ? answers.shift()?.[0] ?? null : null
        const from = fromJourney && new Date(fromJourney.leaveAt).toDateString() === new Date(event.end).toDateString() ? fromJourney : null
        setState({ key, status: 'ok', to, from })
      })
      .catch(() => { if (!cancelled) setState({ key, status: 'error', to: null, from: null }) })
    return () => { cancelled = true }
    // The key covers everything the queries are made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!available) return { status: 'off', to: null, from: null }
  if (!settings.homePlaceId) return { status: 'no-home', to: null, from: null }
  if (!key) return { status: 'off', to: null, from: null }
  if (state.key !== key) return { status: 'loading', to: null, from: null }
  return { ...state, wantTo, wantFrom }
}
