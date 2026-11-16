// Pull to refresh: what the page shown reloads when the student pulls it
// down (the iOS app's own gesture: src/iosRefresh.js). Each source of data
// on screen says how it reloads (usePullRefresh, src/usePullRefresh.js);
// a pull runs them all.

const refreshers = new Set()
const listeners = new Set()

function changed() {
  for (const listener of listeners) listener(refreshers.size > 0)
}

// `refresh()`: reloads, a promise where it knows when it is done. → takes
// it back.
export function addRefresher(refresh) {
  refreshers.add(refresh)
  changed()
  return () => {
    refreshers.delete(refresh)
    changed()
  }
}

// `listener(hasAny)`, now and at each change. → stops.
export function watchRefreshers(listener) {
  listeners.add(listener)
  listener(refreshers.size > 0)
  return () => listeners.delete(listener)
}

// Runs every refresher. Done once they all are, no sooner than `minMs`
// (a spinner that only flashes says nothing) and no later than `maxMs`
// (a request that hangs doesn't hold it). One that fails is its own
// business: it says so where it shows its data.
export function runRefreshers({ minMs = 700, maxMs = 8000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const all = Promise.all([...refreshers].map((refresh) => Promise.resolve().then(refresh).catch(() => {})))
  return Promise.all([Promise.race([all, wait(maxMs)]), wait(minMs)]).then(() => {})
}
