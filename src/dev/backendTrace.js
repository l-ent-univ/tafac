import { createElement } from 'react'

// Dev only: which side answered each of the page's requests. The Rust
// gateway (back/crates/tafac-gateway) says so on the answers it makes itself
// (`x-tafac-answered-by: tonapi`); every other answer is the Node server's.
// src/entApi.js notes each answer here, and src/dev/BackendMarks.jsx draws
// what was noted: an outline around what a route feeds, and a panel listing
// every route asked.

const ANSWERED_BY_HEADER = 'x-tafac-answered-by'
const answers = new Map()
const listeners = new Set()
let snapshot = []

// One name per route: ids out of the path, the portal's paths as one.
function routeOf(pathname) {
  if (pathname.startsWith('/__ent_proxy')) return '/__ent_proxy/*'
  return pathname.replace(/\/\d+(?=\/|$)/g, '/:id')
}

export function noteBackendAnswer(url, response, milliseconds) {
  let pathname
  try {
    pathname = new URL(url, window.location.origin).pathname
  } catch {
    return
  }
  if (!pathname.startsWith('/__ent_auth') && !pathname.startsWith('/__ent_proxy')) return

  const route = routeOf(pathname)
  const previous = answers.get(route)
  answers.set(route, {
    route,
    by: response.headers.get(ANSWERED_BY_HEADER) === 'tonapi' ? 'rust' : 'node',
    status: response.status,
    milliseconds: Math.round(milliseconds),
    count: (previous?.count ?? 0) + 1,
    at: Date.now(),
  })
  snapshot = [...answers.values()].sort((left, right) => left.route.localeCompare(right.route))
  for (const listener of listeners) listener()
}

export function subscribeBackendAnswers(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBackendAnswers() {
  return snapshot
}

// A component whose content comes from these routes: in development it is
// wrapped in an element without a box of its own (display: contents), which
// BackendMarks finds and outlines. In a build it is the component itself.
export function markBackend(Component, routes) {
  if (!import.meta.env.DEV) return Component

  function Marked(props) {
    return createElement('span', { 'data-backend-routes': routes.join(','), style: { display: 'contents' } }, createElement(Component, props))
  }
  Marked.displayName = `Marked(${Component.displayName ?? Component.name ?? 'Component'})`
  return Marked
}
