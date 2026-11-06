// Anonymous analytics of « Assiduité » (see docs/ANALYTICS.md): what the
// page reports, boiled down to the enums the server's allowlist
// (server/analyticsSchema.js) lets through. Pure, see
// tests/assiduityAnalytics.test.js.
//
// Never an absence, a date, an hour, a subject, a teacher, how many, nor
// the reason given in « Justifier » (a health matter, a leave…): only how
// the student got there, how the semester it opens on loaded, what was
// used, and how far « Justifier » went.

// How the student arrived on the page (page_viewed's `source`).
// - nav / tabbar: the sidebar item, the phone's tab bar;
// - dashboard_card: « Accueil »'s « Assiduité » card;
// - history: back, forward or a reload landing on the page.
export const ASSIDUITY_PAGE_SOURCES = ['nav', 'tabbar', 'dashboard_card', 'history', 'other']

export function toAssiduityPageSource(source) {
  return ASSIDUITY_PAGE_SOURCES.includes(source) ? source : 'other'
}

const ERROR_KINDS = ['http_4xx', 'http_5xx', 'network', 'timeout', 'other']

// assiduity_loaded for the semester the page opens on: null while it
// loads, else { status, errorKind? }.
// - ok: absences or lateness listed; empty: none this semester;
// - hidden: the department doesn't publish absences (the passerelle's
//   afficher_absences / liste_dep_publi_absences);
// - missing: no relevé for the semester, or no ScoDoc relevé at all;
// - error: the request failed (`errorKind`, getRequestErrorKind's).
export function describeAssiduityLoad({ status, errorKind = null, unavailable = false, hasReleve = false, visible = false, count = 0 } = {}) {
  if (status === 'loading' || !status) return null
  if (status === 'error') {
    if (unavailable) return { status: 'missing' }
    return { status: 'error', errorKind: ERROR_KINDS.includes(errorKind) ? errorKind : 'other' }
  }
  if (!hasReleve) return { status: 'missing' }
  if (!visible) return { status: 'hidden' }
  return { status: count > 0 ? 'ok' : 'empty' }
}

// « Justifier »'s steps, in order: how far a walkthrough went (its
// `closed` step says the furthest reached).
export const JUSTIFY_STEPS = ['reason', 'proof', 'review', 'composed']

export function advanceJustifyReach(current, step) {
  const index = JUSTIFY_STEPS.indexOf(step)
  if (index < 0) return current
  return current && JUSTIFY_STEPS.indexOf(current) >= index ? current : step
}

// What becomes of the justificatif, as the analytics name it.
export function toProofChoice(proof) {
  return ['attached', 'later', 'none'].includes(proof) ? proof : null
}
