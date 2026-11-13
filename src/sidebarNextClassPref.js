import { useSyncExternalStore } from 'react'

// The sidebar's « Prochain cours » (SidebarNextClass): shown unless the
// student turned it off, from its right-click menu or Réglages › Apparence ›
// Barre latérale. Kept on this device; both places read it live.
// Internal: the whole feature off for now (the card, its Réglages row),
// to be rethought; true brings both back.
export const SIDEBAR_NEXT_CLASS_ENABLED = false

export const SIDEBAR_NEXT_CLASS_KEY = 'l-ent:sidebar-next-class'
const CHANGE_EVENT = 'l-ent:sidebar-next-class-change'

function read() {
  try {
    return localStorage.getItem(SIDEBAR_NEXT_CLASS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSidebarNextClassShown(shown) {
  try {
    if (shown) localStorage.removeItem(SIDEBAR_NEXT_CLASS_KEY)
    else localStorage.setItem(SIDEBAR_NEXT_CLASS_KEY, 'off')
  } catch {
    // Storage unavailable: shown, as by default.
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

export function useSidebarNextClassShown() {
  return useSyncExternalStore(subscribe, read, () => true)
}
