// What the dashboard cards have loaded, for the greeting briefing (and the
// mail/deadlines ordering) to reuse instead of fetching the same thing again.
// In memory only, never sent anywhere.
//
// classes: { cacheKey, loadedAt } once the "Prochain cours" card (or the
//   briefing itself, card hidden) finished a load, good or failed; the
//   events themselves live in the next-class cache (src/upcomingClasses.js).
// deadlines: the getMoodleDeadlines() result last shown by "Échéances",
//   null while that card isn't mounted.
// mailCount / deadlinesCount: the badge numbers of "Mails récents" (unread)
//   and "Échéances" (due within 48 h), null until loaded (src/listCardOrder.js).

// bus: the next bus of the "Bus" card ({ kind, leaveAt, departAt, line }),
//   null while that card isn't mounted or has none.

let sources = { classes: null, deadlines: null, mailCount: null, deadlinesCount: null, bus: null }
const listeners = new Set()

export function publishBriefingSource(name, value) {
  if (sources[name] === value) return
  sources = { ...sources, [name]: value }
  listeners.forEach((listener) => listener())
}

export function subscribeBriefingSources(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBriefingSources() {
  return sources
}
