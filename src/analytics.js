// Anonymous audience measurement — client side (see docs/ANALYTICS.md).
//
// PostHog, cookieless and EU-hosted, behind the "Statistiques anonymes"
// switch in Mon compte. The browser never talks to it: events are batched
// here and posted to our own server (/__ent_auth/analytics), which validates
// them against server/analyticsSchema.js and forwards them. Only when the
// server has a PostHog key. No third-party script runs in the page.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ENT_AUTH_PREFIX } from './entApi'
import { getStoredAnonymousAnalytics } from './profileStorage'
import { toFormationSlug } from './formationSlug'
import { createNavigationReporter } from './planningAnalytics'

const ANALYTICS_ENDPOINT = `${ENT_AUTH_PREFIX}/analytics`
const FLUSH_DELAY_MS = 2000
const MAX_BATCH_SIZE = 20

let serverEnabled = false
let userEnabled = getStoredAnonymousAnalytics()
let establishment = null
let formation = null
let queue = []
let flushTimer = 0
const listeners = new Set()

function isActive() {
  return serverEnabled && userEnabled
}

function dropQueue() {
  queue = []
  window.clearTimeout(flushTimer)
  flushTimer = 0
}

// Server switch, from the `analyticsEnabled` flag of /__ent_auth/session.
export function setAnalyticsAvailable(enabled) {
  const next = Boolean(enabled)
  if (next === serverEnabled) return
  serverEnabled = next
  if (!next) dropQueue()
  listeners.forEach((listener) => listener())
}

// User switch ("Statistiques anonymes"). Turning it off drops anything queued.
export function setAnalyticsUserEnabled(enabled) {
  userEnabled = Boolean(enabled)
  if (!userEnabled) dropQueue()
}

export function setAnalyticsEstablishment(establishmentId) {
  establishment = typeof establishmentId === 'string' && establishmentId ? establishmentId : null
}

export function setAnalyticsFormation(formationLabel) {
  formation = toFormationSlug(formationLabel) || null
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isPostHogAvailable() {
  return serverEnabled
}

// True when the anonymous measurement is active (drives the About copy, the
// Mon compte switch and the privacy modal).
export function useAnalyticsAvailable() {
  return useSyncExternalStore(subscribe, () => serverEnabled, () => false)
}

function getDevice() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

function getBrowser() {
  const ua = navigator.userAgent || ''
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  if (/chrome|chromium|crios|edg\//i.test(ua)) return 'chromium'
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  } catch {
    return false
  }
}

// Coarse context only. `university` and `demo` are added by the server.
function getContext() {
  const lang = String(navigator.language || '').slice(0, 2).toLowerCase()

  return {
    device: getDevice(),
    browser: getBrowser(),
    standalone: isStandalone(),
    ...(/^[a-z]{2}$/.test(lang) ? { lang } : null),
    ...(establishment ? { establishment } : null),
    ...(formation ? { formation } : null),
  }
}

export function flushAnalytics() {
  window.clearTimeout(flushTimer)
  flushTimer = 0

  if (queue.length === 0) return
  if (!isActive()) {
    dropQueue()
    return
  }

  const context = getContext()
  const events = queue.splice(0, MAX_BATCH_SIZE).map(({ event, properties }) => ({
    event,
    properties: { ...context, ...properties },
  }))
  const body = JSON.stringify({ events })

  try {
    if (navigator.sendBeacon?.(ANALYTICS_ENDPOINT, body)) {
      if (queue.length > 0) flushAnalytics()
      return
    }
  } catch {
    // Fall back to fetch below.
  }

  fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    body,
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  }).catch(() => {})

  if (queue.length > 0) flushAnalytics()
}

export function track(event, properties = {}) {
  if (!isActive()) return

  queue.push({ event, properties })
  if (queue.length >= MAX_BATCH_SIZE) {
    flushAnalytics()
  } else if (!flushTimer) {
    flushTimer = window.setTimeout(flushAnalytics, FLUSH_DELAY_MS)
  }
}

export function getDurationBucket(durationMs) {
  if (durationMs < 500) return '<500ms'
  if (durationMs < 1000) return '<1s'
  if (durationMs < 3000) return '<3s'
  if (durationMs < 10000) return '<10s'
  return '10s+'
}

// Widgets already reported for the current dashboard view: a widget that
// remounts (e.g. the layout changes when another widget is hidden) is not
// reported twice.
const reportedWidgets = new Set()

// Called once per dashboard mount (WidgetContainer).
export function trackDashboardView({ greetingShown = false } = {}) {
  reportedWidgets.clear()
  track('dashboard_viewed')
  if (greetingShown) {
    // Nothing to load: the greeting card is ready immediately.
    reportedWidgets.add('greeting')
    track('widget_loaded', { widget: 'greeting', status: 'ok', duration_bucket: '<500ms' })
  }
}

// Reports `widget_loaded` once per dashboard view, when `outcome` first
// becomes { status: 'ok' | 'empty' | 'error', errorKind? }. Pass null while
// loading (or when there is nothing to report). Background refreshes are
// never reported.
export function useWidgetLoadReport(widget, outcome) {
  const startedAtRef = useRef(null)
  const status = outcome?.status ?? null
  const errorKind = outcome?.errorKind ?? null

  useEffect(() => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now()
    if (!status || reportedWidgets.has(widget)) return

    reportedWidgets.add(widget)
    track('widget_loaded', {
      widget,
      status,
      duration_bucket: getDurationBucket(performance.now() - startedAtRef.current),
      ...(status === 'error' ? { error_kind: errorKind ?? 'other' } : null),
    })
  }, [widget, status, errorKind])
}

// « Mes notes », once per arrival on the page (GradesPage's mount; refs
// survive StrictMode's second effect run): page_viewed with how the student
// got there (`source`, see src/gradesAnalytics.js), then grades_loaded when
// `outcome` (describeGradesLoad) first settles for the semester it opens on.
// Later semester switches and background refreshes are never reported.
export function useGradesPageReport(source, outcome) {
  const startedAtRef = useRef(null)
  const reportedRef = useRef({ view: false, load: false })
  const status = outcome?.status ?? null
  const errorKind = outcome?.errorKind ?? null

  useEffect(() => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now()
    const reported = reportedRef.current
    if (!reported.view) {
      reported.view = true
      track('page_viewed', { page: 'grades', source })
    }
    if (!status || reported.load) return

    reported.load = true
    track('grades_loaded', {
      status,
      duration_bucket: getDurationBucket(performance.now() - startedAtRef.current),
      ...(status === 'error' ? { error_kind: errorKind ?? 'other' } : null),
    })
  }, [source, status, errorKind])
}

// One thing done on « Mes notes » (grades_action): `action` and, for a
// grade's detail sheet, where it was opened `from`.
export function trackGradesAction(action, { from = null } = {}) {
  track('grades_action', { action, ...(from ? { from } : null) })
}

// The Planning page, once per arrival (PlanningPage's mount; refs survive
// StrictMode's second effect run): page_viewed with how the student got
// there (`source`) and the view it opens in (`view`, see
// src/planningAnalytics.js), then planning_loaded when `outcome`
// (describePlanningLoad) first settles for the week it opens on. Later
// weeks, retries and background refreshes are never reported.
export function usePlanningPageReport(source, view, outcome) {
  const startedAtRef = useRef(null)
  const reportedRef = useRef({ view: false, load: false })
  const status = outcome?.status ?? null
  const errorKind = outcome?.errorKind ?? null

  useEffect(() => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now()
    const reported = reportedRef.current
    if (!reported.view) {
      reported.view = true
      track('page_viewed', { page: 'planning', source, ...(view ? { view } : null) })
    }
    if (!status || reported.load) return

    reported.load = true
    track('planning_loaded', {
      status,
      duration_bucket: getDurationBucket(performance.now() - startedAtRef.current),
      ...(status === 'unavailable' ? { error_kind: errorKind ?? 'other' } : null),
    })
  }, [source, view, status, errorKind])
}

// One thing done on the Planning page (planning_action): `action` and its
// own properties (`view`, `from`, `result`, see server/analyticsSchema.js).
export function trackPlanningAction(action, properties = {}) {
  track('planning_action', { action, ...properties })
}

// Steps through the planning's days or weeks (day_changed, week_changed),
// one event per burst of steps (src/planningAnalytics.js): `via` says how
// ('arrow', 'keyboard', 'swipe', 'strip', 'pill'). Flushed when the page
// goes (flushPlanningNavigation) and when the tab is hidden.
const planningNavigation = createNavigationReporter(trackPlanningAction)

export function trackPlanningNavigation(action, via) {
  planningNavigation.report(action, via)
}

export function flushPlanningNavigation() {
  planningNavigation.flush()
}

// Application ids (portal fname or local service id) as a short slug.
export function toAppSlug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

if (typeof window !== 'undefined') {
  // A planning burst still open goes in the last batch.
  const flushOnLeave = () => {
    planningNavigation.flush()
    flushAnalytics()
  }
  window.addEventListener('pagehide', flushOnLeave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnLeave()
  })
}
