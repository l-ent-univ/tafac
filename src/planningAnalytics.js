// Anonymous analytics of the Planning page (see docs/ANALYTICS.md): what the
// page reports, boiled down to the enums the server's allowlist
// (server/analyticsSchema.js) lets through. Pure, see
// tests/planningAnalytics.test.js.
//
// Never a class, a room, a teacher, a group, a day or a week: only how the
// student got there, the view, how the first week loaded, and what was
// done (stepping through days or weeks counted by bursts, not by step).

// How the student arrived on the page (page_viewed's `source`).
// - nav / tabbar: the sidebar item, the phone's tab bar;
// - tile: the planning service's app in the app lists (planningPortalApp.js);
// - dashboard_card: the dashboard's "Prochain cours";
// - launch_card: the Planning's announcement under the widgets
//   (PlanningLaunchCard);
// - history: back, forward or a reload landing on the page.
export const PLANNING_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'launch_card', 'history', 'other']

export function toPlanningPageSource(source) {
  return PLANNING_PAGE_SOURCES.includes(source) ? source : 'other'
}

// The page's views (PlanningPage's ids) as the analytics name them.
const VIEWS = { day: 'day', twoDays: 'two_days', week: 'week', list: 'list' }

export function toPlanningView(view) {
  return Object.hasOwn(VIEWS, view) ? VIEWS[view] : null
}

const ERROR_KINDS = ['http_4xx', 'http_5xx', 'network', 'timeout', 'other']

// planning_loaded for the week the page opens on, from usePlanningWeeks:
// null while it loads, else { status, errorKind? }.
// `status`: statusOn's ('loaded' | 'loading' | 'unavailable' |
// 'unconfigured'); `errorKind`: the failed request's category
// (getRequestErrorKind); `hasClasses`: the week has at least one class.
export function describePlanningLoad({ status, errorKind = null, hasClasses = false } = {}) {
  if (status === 'unconfigured') return { status: 'unconfigured' }
  // No timetable at all (TEMPO): reported as an empty week.
  if (status === 'no-timetable') return { status: 'empty' }
  if (status === 'unavailable') {
    return { status: 'unavailable', errorKind: ERROR_KINDS.includes(errorKind) ? errorKind : 'other' }
  }
  if (status !== 'loaded') return null
  return { status: hasClasses ? 'ok' : 'empty' }
}

// How many pages a burst of steps went through, in buckets: one, a few,
// many. Null for none.
export function getStepsBucket(count) {
  if (!(count >= 1)) return null
  if (count === 1) return '1'
  if (count <= 3) return '2-3'
  return '4+'
}

// Steps through days or weeks (arrows, keys, swipes, the strip), reported
// once per burst rather than once per step: a held arrow key or a run of
// swipes is one day_changed / week_changed, with how far it went
// (`steps`). A burst ends `delayMs` after its last step, on another kind
// of step (another action or input), or on flush() (leaving the page, the
// tab hidden). `send(action, { via, steps })`.
export function createNavigationReporter(send, {
  delayMs = 1500,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  let pending = null
  let timer = null

  const flush = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    if (!pending) return
    const { action, via, count } = pending
    pending = null
    send(action, { via, steps: getStepsBucket(count) })
  }

  const report = (action, via) => {
    if (pending && (pending.action !== action || pending.via !== via)) flush()
    if (pending) pending.count += 1
    else pending = { action, via, count: 1 }
    if (timer !== null) clearTimer(timer)
    timer = setTimer(flush, delayMs)
  }

  return { report, flush }
}
