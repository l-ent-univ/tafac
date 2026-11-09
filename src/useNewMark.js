import { useCallback, useSyncExternalStore } from 'react'

// A blue « new » dot on something added in an update (the planning's
// « Salles et personnels » button), until the
// student has opened it once: kept on this device, by `key` (a
// localStorage key, never renamed). Every component reading the same key
// sees it go at once. → [isNew, markSeen].
const listeners = new Set()

function readSeen(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Storage unavailable: seen for the visit.
const seenThisVisit = new Set()

export function useNewMark(key) {
  const seen = useSyncExternalStore(subscribe, () => seenThisVisit.has(key) || readSeen(key), () => true)
  const markSeen = useCallback(() => {
    if (seenThisVisit.has(key) || readSeen(key)) return
    seenThisVisit.add(key)
    try {
      localStorage.setItem(key, '1')
    } catch {
      // Kept for the visit only.
    }
    listeners.forEach((listener) => listener())
  }, [key])
  return [!seen, markSeen]
}

export const NEW_MARK_DIRECTORY = 'l-ent:new-mark:directory'
