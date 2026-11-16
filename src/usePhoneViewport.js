import { useSyncExternalStore } from 'react'

// The phone layout's width: below the app's `md` breakpoint (1024px,
// src/index.css: where the sidebar takes over, so a tablet has the phone
// layout too), as the `max-md:` classes. For what is a different component
// there rather than the same one restyled (« Accueil »'s header).
const QUERY = '(max-width: 1023.98px)'

function subscribe(onChange) {
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// False where there is no window (the landing page rendered at build time).
export function usePhoneViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
