import universityConfig from '@university'
import { track } from './analytics'
import { navigateTo } from './appRoute'
import { ENT_AUTH_PREFIX } from './entApi'
import {
  GRADES_FEATURE_DISABLED,
  GRADES_FEATURE_ENABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_TITLE,
} from './gradeFeatureState'

// Main navigation, shared by the desktop sidebar and the mobile tab bar.

const MOODLE_ORIGIN = universityConfig.origins?.moodle ?? null
const MOODLE_HREF = universityConfig.features?.moodle && MOODLE_ORIGIN
  ? `${ENT_AUTH_PREFIX}/launch?url=${encodeURIComponent(`${MOODLE_ORIGIN.replace(/\/$/, '')}/my/`)}`
  : null
// Same link as the "Mails récents" card: the server opens the webmail
// already signed in (or falls back to its launch URL).
export const MAIL_HREF = universityConfig.features?.mail ? `${ENT_AUTH_PREFIX}/mail/open` : null

// "Mes notes" follows the tri-state grades feature: the in-app grades page
// when live, a greyed-out item with the unavailability notice when
// 'disabled', nothing otherwise.
// `announcedBy`: the « Nouveautés » entry that launched the page; the item
// says « Nouveau » while this device hasn't seen it (changelogStore).
function buildGradesNavItem() {
  const base = { id: 'grades', label: 'Mes notes', icon: 'carbon:chart-pie' }

  if (GRADES_FEATURE_ENABLED) {
    return { ...base, route: 'grades', announcedBy: 'mes-notes' }
  }

  if (GRADES_FEATURE_DISABLED) {
    return {
      ...base,
      disabled: true,
      disabledTitle: GRADES_UNAVAILABLE_TITLE,
      disabledDetail: GRADES_UNAVAILABLE_DETAIL,
    }
  }

  return null
}

// Grades only for establishments whose config enables grade widgets.
function hasGradeWidgets(establishment) {
  if (establishment === 'enssat') {
    return false
  }
  return Boolean(universityConfig.establishments?.byId?.[establishment]?.gradeWidgets)
}

// Whether /notes and /absences can show their ScoDoc page (otherwise they
// fall back to the dashboard).
export function isGradesPageAvailable(establishment) {
  return GRADES_FEATURE_ENABLED && hasGradeWidgets(establishment)
}

// Whether /planning can show the in-app timetable (otherwise it falls back
// to the dashboard).
export function isPlanningPageAvailable() {
  return Boolean(universityConfig.features?.planning)
}

// Whether /mail can show the in-app webmail (otherwise it falls back
// to the dashboard).
export function isMailPageAvailable() {
  return Boolean(universityConfig.features?.mail)
}

// Whether /moodle can show the in-app Moodle page (otherwise it falls back
// to the dashboard or external link).
export function isMoodlePageAvailable() {
  return Boolean(universityConfig.features?.moodle)
}

// Whether /ru can show the CROUS menus (« Menu du RU »).
export function isCrousPageAvailable() {
  return Boolean(universityConfig.features?.crous && universityConfig.crous?.region)
}

// Whether /bus can show the bus network (« Bus »): a network configured
// and a campus for this establishment.
export function isTransitPageAvailable(establishment) {
  return Boolean(universityConfig.features?.transit && universityConfig.transit?.gtfsUrl && universityConfig.transit?.campuses?.[establishment])
}

// `gradesSupported: false`: a student whose relevé Tafac can't read (not a
// BUT): no "Mes notes".
export function buildNavItems(establishment, { gradesSupported = true } = {}) {
  const gradesNavItem = gradesSupported && hasGradeWidgets(establishment) ? buildGradesNavItem() : null

  return [
    {
      id: 'applications',
      label: 'Accueil',
      icon: 'carbon:home',
      // The dashboard home, where the applications grid lives.
      route: 'dashboard',
    },
    ...(gradesNavItem ? [gradesNavItem] : []),
    // Same ScoDoc data as the grades, so only alongside a live grades page.
    ...(gradesNavItem?.route ? [{ id: 'absences', label: 'Absences', icon: 'carbon:event-schedule', route: 'absences' }] : []),
    // The in-app planning page (PlanningPage), launched by its own
    // « Nouveautés » entry (`announcedBy`, as « Mes notes »).
    ...(isPlanningPageAvailable()
      ? [{ id: 'planning', label: 'Planning', icon: 'carbon:calendar', route: 'planning', announcedBy: 'planning' }]
      : []),
    ...(isMailPageAvailable()
      ? [{ id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'carbon:email', route: 'mail' }]
      : MAIL_HREF
        ? [{ id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'carbon:email', href: MAIL_HREF, target: '_blank' }]
        : []),
    ...(isMoodlePageAvailable()
      ? [{ id: 'moodle', label: 'Moodle', icon: 'devicon-plain:moodle', route: 'moodle' }]
      : MOODLE_HREF
        ? [{ id: 'moodle', label: 'Moodle', icon: 'devicon-plain:moodle', href: MOODLE_HREF, target: '_blank' }]
        : []),
    // Not in the tab bar (six tabs already): the dashboard's card opens it.
    ...(isCrousPageAvailable()
      ? [{ id: 'ru', label: 'Menu du RU', icon: 'carbon:restaurant', route: 'ru', inTabBar: false }]
      : []),
    // Not in the tab bar either: its card and the planning open it.
    ...(isTransitPageAvailable(establishment)
      ? [{ id: 'bus', label: 'Bus', icon: 'carbon:bus', route: 'bus', inTabBar: false }]
      : []),
  ]
}

// Opens an item (in-app page, planning, mail…) and records which app it was
// and where it was opened from.
export function openNavItemLink(item, source) {
  if (item.route === 'dashboard') {
    navigateTo('dashboard')
    return
  }

  track('app_opened', { app: item.id, source })
  if (item.route) {
    navigateTo(item.route, { source: source === 'sidebar' ? 'nav' : source })
    return
  }

  if (item.target === '_blank') {
    window.open(item.href, '_blank', 'noopener,noreferrer')
    return
  }

  window.location.assign(item.href)
}

// The shortcuts the mobile tab bar carries (every nav item but "Toutes les
// applications", which is the dashboard itself). Empty means no tab bar.
export function getMobileTabItems(establishment, options) {
  return buildNavItems(establishment, options).filter((item) => item.id !== 'applications' && item.inTabBar !== false)
}
