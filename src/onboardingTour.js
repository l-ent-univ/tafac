// Visite guidée de la première connexion: which devices get it, the steps,
// and the state kept in localStorage. Pure (no React), see
// tests/onboardingTour.test.js.
//
// Only a brand-new device gets the tour: one that has never recorded a
// « Nouveautés » visit (CHANGELOG_SEEN_KEY) and didn't just come over from
// the old l'ent address. Everyone else is marked done without seeing it.
// `pending` is stored so a reload before the tour starts doesn't lose it.

// Per device, like the theme. Never rename: devices would see the tour again.
export const TOUR_STATE_KEY = 'l-ent:tour'

const PENDING = 'pending'
const DONE = 'done'

// Each step points at `[data-tour="<target>"]` elements. A step whose target
// isn't on screen (feature off, other layout) is skipped; no target = a
// centered card. `logo` swaps the icon for the Tafac logo.
export const TOUR_STEPS = [
  {
    id: 'intro',
    logo: true,
    title: 'Bienvenue sur Tafac !',
    body: "Un petit tour de 30 secondes pour te montrer l'essentiel.",
  },
  {
    id: 'favorites',
    target: 'favorite-star',
    icon: 'carbon:star',
    title: 'Épingle tes applis',
    body: "Touche l'étoile d'une application pour la retrouver dans tes Favoris, toujours sous la main.",
  },
  {
    id: 'search',
    target: 'search',
    icon: 'carbon:search',
    title: 'Retrouve tout vite',
    body: "Cherche une application par son nom ou par ce qu'elle fait.",
  },
  {
    id: 'shortcuts',
    target: 'nav',
    icon: 'carbon:app-switcher',
    title: 'Tes raccourcis',
    body: 'Les services du quotidien (notes, planning, mails…) à un tap, selon ton université.',
  },
  {
    id: 'account',
    target: 'account',
    icon: 'carbon:user-avatar',
    title: 'Ton compte et tes réglages',
    body: 'Change de groupe, de thème ou de fond d’écran, et masque les widgets dont tu n’as pas besoin.',
  },
]

// Where this device stands.
//   rawTour: what localStorage holds under TOUR_STATE_KEY (or null)
//   rawChangelogSeen: what it holds under the changelog key (or null)
//   arrivedFromLent: the student just came over from the old address
// Returns whether the tour is still to be shown and the value to write, or
// null when storage is already right.
export function resolveTourVisit({ rawTour, rawChangelogSeen, arrivedFromLent = false }) {
  if (rawTour === PENDING) return { pending: true, nextValue: null }
  if (rawTour === DONE) return { pending: false, nextValue: null }

  const isNewDevice = rawChangelogSeen === null && !arrivedFromLent
  return isNewDevice
    ? { pending: true, nextValue: PENDING }
    : { pending: false, nextValue: DONE }
}

export function doneTourValue() {
  return DONE
}

// Next step to show from `index` going `direction` (1 or -1), skipping the
// ones `isAvailable` rejects. -1 when none is left that way.
export function findAvailableStep(steps, index, direction, isAvailable) {
  for (let next = index + direction; next >= 0 && next < steps.length; next += direction) {
    if (isAvailable(steps[next])) return next
  }
  return -1
}

export function readTourValue(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(TOUR_STATE_KEY) ?? null
  } catch {
    return null
  }
}

export function writeTourValue(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(TOUR_STATE_KEY, value)
  } catch {
    // Storage unavailable: the tour may come back next time, nothing worse.
  }
}
