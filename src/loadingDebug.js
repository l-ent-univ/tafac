import { useSyncExternalStore } from 'react'

// Dev only: the debug panel holds the pages' first load (PageLoading on
// Mes notes and Assiduité) on this device, to watch its lines come in.
// Stored, so it survives a reload; applied at once, no reload needed.
export const LOADING_DEBUG_KEY = 'l-ent:debug-simulate-loading'
const CHANGE_EVENT = 'l-ent:debug-simulate-loading-change'

function read() {
  if (!import.meta.env?.DEV) return false
  try {
    return localStorage.getItem(LOADING_DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

export function setLoadingSimulated(on) {
  try {
    if (on) localStorage.setItem(LOADING_DEBUG_KEY, '1')
    else localStorage.removeItem(LOADING_DEBUG_KEY)
  } catch {
    // Storage unavailable: nothing to hold.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useLoadingSimulated() {
  return useSyncExternalStore(subscribe, read, () => false)
}
