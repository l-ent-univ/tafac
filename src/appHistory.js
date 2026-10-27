// Back and forward inside the app (browser buttons, trackpad swipes, mouse
// side buttons, Android's back gesture): each page switch and each UE opened
// full page is a history entry. What the entry shows lives in its state
// (`tafac`), the URL doesn't change (its fragment belongs to the settings
// transfer link). A reload keeps the entry's state, so it lands where it was.
const PAGES = new Set(['dashboard', 'grades', 'planning', 'mail'])

export function readHistoryNav(state = globalThis.history?.state) {
  const nav = state?.tafac
  return {
    page: PAGES.has(nav?.page) ? nav.page : 'dashboard',
    ue: nav?.page === 'grades' && typeof nav?.ue === 'string' ? nav.ue : null,
  }
}

// Other keys of the entry's state are kept.
export function writeHistoryNav(nav, { replace = false, history = globalThis.history } = {}) {
  if (!history) return
  try {
    const state = { ...(history.state ?? {}), tafac: { page: nav.page, ue: nav.ue ?? null } }
    if (replace) history.replaceState(state, '')
    else history.pushState(state, '')
  } catch {
    // No history (sandboxed frame): back and forward just leave the app.
  }
}
