// CROUS restaurants and menus (« Menu du RU » and its dashboard card), from
// the CROUS's own feeds through the server (/__ent_auth/crous). The last
// answer per restaurant is kept offline for the canteen queue without signal.
import universityConfig from '@university'
import { ENT_AUTH_PREFIX } from './entApi'
import { getOfflineCache, setOfflineCache } from './offlineStorage'

export { describeClosures, hasMenu, pickMenuDay, readOpeningHours, todayKey } from './crousMenu'

const CROUS_CONFIG = universityConfig.crous ?? {}
const CROUS_STORAGE_KEY = 'tafac:crous:restaurant'

export const CROUS_MEAL_PRICE = CROUS_CONFIG.mealPrice ?? null

// The restaurant picked last, else the establishment's, else the
// university's default.
export function getStoredCrousRestaurant(establishment = null) {
  try {
    const saved = localStorage.getItem(CROUS_STORAGE_KEY)
    if (saved) return saved
  } catch {
    // Storage blocked: fall back to the defaults.
  }
  return CROUS_CONFIG.defaultRestaurantByEstablishment?.[establishment] ?? CROUS_CONFIG.fallbackRestaurant ?? null
}

export function setStoredCrousRestaurant(id) {
  try {
    localStorage.setItem(CROUS_STORAGE_KEY, id)
  } catch {
    // Storage blocked: the pick lasts this visit.
  }
}

// { restaurants, restaurantId, days: [{ date, meals }], fetchedAt, offline? }
export async function fetchCrous(restaurantId = null) {
  const cacheKey = `crous:${restaurantId ?? 'list'}`
  try {
    const params = restaurantId ? `?resto=${encodeURIComponent(restaurantId)}` : ''
    const response = await fetch(`${ENT_AUTH_PREFIX}/crous${params}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`CROUS answered ${response.status}`)
    const data = await response.json()
    void setOfflineCache(cacheKey, data)
    return data
  } catch (error) {
    const offline = await getOfflineCache(cacheKey)
    if (offline?.data) return { ...offline.data, offline: true }
    throw error
  }
}

// "Plats chauds" → its icon in the menu.
export function sectionIcon(title) {
  const text = String(title ?? '').toLowerCase()
  if (/entr|hors/.test(text)) return 'carbon:sprout'
  if (/dessert|fromage/.test(text)) return 'carbon:cafe'
  if (/pizza|grill|snack|sandwich|burger/.test(text)) return 'carbon:fire'
  if (/accomp|légume|legume|féculent|feculent/.test(text)) return 'carbon:wheat'
  return 'carbon:restaurant'
}
