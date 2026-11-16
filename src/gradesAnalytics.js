// Anonymous analytics of « Mes notes » (see docs/ANALYTICS.md): what the page
// and its simulator report, boiled down to the enums and booleans the
// server's allowlist (server/analyticsSchema.js) lets through. Pure, see
// tests/gradesAnalytics.test.js.
//
// Never a grade, an average, a delta, a UE or subject code, an evaluation or
// semester id: only how the student got there, how the load went, and which
// way a simulation moved the UE.

// How the student arrived on the page (page_viewed's `source`).
// - nav / tabbar: the sidebar item, the phone's tab bar;
// - tile: the grade service's app in the app lists (gradesPortalApp.js);
// - dashboard_card: the dashboard's "Dernière note";
// - sidebar_card: the sidebar's "Dernière note";
// - launch_card: the « Mes notes » announcement under the widgets;
// - history: back, forward or a reload landing on the page.
export const GRADES_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'sidebar_card', 'launch_card', 'home_icon', 'history', 'other']

export function toGradesPageSource(source) {
  return GRADES_PAGE_SOURCES.includes(source) ? source : 'other'
}

const ERROR_KINDS = ['http_4xx', 'http_5xx', 'network', 'timeout', 'other']

// grades_loaded for the semester the page opens on, from what the page
// renders: null while it loads, else { status, errorKind? }.
// `status`: the load ('loading' | 'ok' | 'error', useScodocReleve's);
// `unavailable`: the server found no ScoDoc relevé for the student (another
// formation, on Pégase or the ENT), shown as an error but not a failure;
// `reportStatus`: buildGradesReport's; `emptyKind`: GradesPage's empty
// reason ('unpublished', 'noGrades', 'missing'), null with grades to show.
export function describeGradesLoad({ status, errorKind = null, unavailable = false, reportStatus = null, emptyKind = null } = {}) {
  if (status === 'error') {
    return unavailable
      ? { status: 'unsupported' }
      : { status: 'error', errorKind: ERROR_KINDS.includes(errorKind) ? errorKind : 'other' }
  }
  if (status !== 'ok') return null
  if (reportStatus === 'unsupported') return { status: 'unsupported' }
  if (emptyKind === 'unpublished') return { status: 'unpublished' }
  if (emptyKind) return { status: 'empty' }
  return { status: 'ok' }
}

// How many grades a simulation changed (typed in or added), in buckets wide
// enough to say nothing about the relevé: one, a few, many. Null for none.
export function getEditedBucket(count) {
  if (!(count >= 1)) return null
  if (count === 1) return '1'
  if (count <= 3) return '2-3'
  return '4+'
}

// The simulator's steps, the furthest one reached kept for `closed`: the
// dial (picking the UE), editing its grades, the reveal.
const REACHED_BY_STEP = { opened: 'dial', ue_picked: 'edit', back_to_edit: 'edit', reveal_shown: 'reveal' }
const REACHED_ORDER = ['dial', 'edit', 'reveal']

export function advanceSimulatorReach(reached, step) {
  const next = REACHED_BY_STEP[step]
  if (!next) return reached ?? 'dial'
  return REACHED_ORDER.indexOf(next) > REACHED_ORDER.indexOf(reached) ? next : reached
}

// reveal_shown's properties, from describeUeOutcome (gradeSimulation.js):
// which way the UE went (`new`: it had no average before), whether it ends
// up validated and whether it crossed the pass mark (validated now, it
// wasn't). Directions and booleans only: no average, no delta.
// `editCount`: grades the simulation sets; `addedGradeCount`: how many of
// them are grades added by hand.
export function describeRevealForAnalytics(outcome, { editCount = 0, addedGradeCount = 0 } = {}) {
  let direction = 'same'
  if (outcome?.changed) {
    if (outcome.delta == null) direction = 'new'
    else direction = outcome.delta > 0 ? 'up' : 'down'
  }
  const bucket = getEditedBucket(editCount)
  return {
    ...(bucket ? { edited_bucket: bucket } : null),
    added_grades: addedGradeCount > 0,
    ue_direction: direction,
    ue_validated: Boolean(outcome?.validated),
    crossed_pass_mark: outcome?.tone === 'crossed',
  }
}
