// « Bus »: the town's bus network through the server (/__ent_auth/transit,
// server/transitFeed.js and transitPlanner.js), and the student's choices
// kept on this device: home stop, favourite stops, how early to arrive,
// reminders on or off. The network is kept offline (timetables don't change
// within the day); departures and journeys need the network.
import { useEffect, useState, useSyncExternalStore } from 'react'
import universityConfig from '@university'
import { ENT_AUTH_PREFIX } from './entApi'
import { getOfflineCache, setOfflineCache } from './offlineStorage'
export { formatClock, formatCountdown } from './transitClock'
export { useUpcomingClasses } from './useUpcomingClasses'

const TRANSIT_CONFIG = universityConfig.transit ?? {}
const BASE = `${ENT_AUTH_PREFIX}/transit`
export const TRANSIT_NAME = TRANSIT_CONFIG.name ?? 'Bus'
export const DEFAULT_MARGIN_MIN = 5

// The campus of a student's establishment, or null: no « Bus » for them.
export function getTransitCampus(establishment) {
  return TRANSIT_CONFIG.campuses?.[establishment] ?? null
}

export function isTransitAvailable(establishment) {
  return Boolean(universityConfig.features?.transit && TRANSIT_CONFIG.gtfsUrl && getTransitCampus(establishment))
}

// --- Settings (localStorage, shared by the page, its card and the sync) ---

const SETTINGS_KEY = 'tafac:transit:settings'
const SETTINGS_EVENT = 'tafac:transit-settings'
const DEFAULT_SETTINGS = { homePlaceId: null, favoritePlaceIds: [], marginMin: DEFAULT_MARGIN_MIN, reminders: false }
let settingsCache = null

function readSettings() {
  if (settingsCache) return settingsCache
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    settingsCache = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) }
  } catch {
    settingsCache = DEFAULT_SETTINGS
  }
  return settingsCache
}

export function getTransitSettings() {
  return readSettings()
}

export function updateTransitSettings(patch) {
  settingsCache = { ...readSettings(), ...patch }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache))
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

function subscribeSettings(onChange) {
  const handleStorage = (event) => {
    if (event.key === SETTINGS_KEY) { settingsCache = null; onChange() }
  }
  window.addEventListener(SETTINGS_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(SETTINGS_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useTransitSettings() {
  return useSyncExternalStore(subscribeSettings, readSettings, () => DEFAULT_SETTINGS)
}

// --- Server ---

async function readJson(response) {
  if (!response.ok) throw new Error(`Transit answered ${response.status}`)
  return response.json()
}

// The network for drawing and naming: { name, routes, places, lines,
// campuses, stopPlaces, attribution, validUntil, realtime, offline? }
let networkPromise = null
export function fetchTransitNetwork() {
  networkPromise ??= fetch(`${BASE}/network`, { credentials: 'same-origin' })
    .then(readJson)
    .then((data) => { void setOfflineCache('transit:network', data); return data })
    .catch(async (error) => {
      networkPromise = null
      const cached = await getOfflineCache('transit:network')
      if (cached?.data) return { ...cached.data, offline: true }
      throw error
    })
  return networkPromise
}

// { departures: [leg], realtime }
export async function fetchDepartures(placeId, limit = 6) {
  return readJson(await fetch(`${BASE}/departures?place=${encodeURIComponent(placeId)}&limit=${limit}`, { credentials: 'same-origin' }))
}

// queries: [{ from, to, arriveBy? | departAt? | lastOfDay?, limit? }]
// → { results: [journeys | null], realtime }
export async function fetchJourneys(queries) {
  return readJson(await fetch(`${BASE}/plan`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  }))
}

// --- Helpers for the views ---

export function useTransitNetwork() {
  const [state, setState] = useState({ status: 'loading', network: null })
  useEffect(() => {
    let cancelled = false
    fetchTransitNetwork()
      .then((network) => { if (!cancelled) setState({ status: 'ok', network }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', network: null }) })
    return () => { cancelled = true }
  }, [])
  return state
}

export function placeName(network, placeId) {
  return network?.places.find((place) => place.id === placeId)?.name ?? null
}

export function stopName(network, stopId) {
  return placeName(network, network?.stopPlaces?.[stopId]) ?? null
}

export function findRoute(network, routeId) {
  return network?.routes.find((route) => route.id === routeId) ?? null
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

// Places closest to a point: [{ place, distance }].
export function nearestPlaces(network, point, count = 3) {
  return (network?.places ?? [])
    .map((place) => ({ place, distance: distanceMeters(point, place) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, count)
}
