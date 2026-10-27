import universityConfig from '@university'
import { track } from './analytics'
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
// Without the in-app mail page (mail.page: false in client.js), « Messagerie »
// is the "Mails récents" card's link: the server opens the webmail already
// signed in (or falls back to its launch URL).
const MAIL_ITEM = universityConfig.mail?.page === false
  ? { id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'carbon:email', href: `${ENT_AUTH_PREFIX}/mail/open`, target: '_blank' }
  : { id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'carbon:email', page: 'mail' }

// "Mes notes" follows the tri-state grades feature: the in-app grades page
// when live, a greyed-out item with the unavailability notice when
// 'disabled', nothing otherwise.
// `announcedBy`: the « Nouveautés » entry that launched the page; the item
// says « Nouveau » while this device hasn't seen it (changelogStore).
function buildGradesNavItem() {
  const base = { id: 'grades', label: 'Mes notes', icon: 'carbon:chart-pie' }

  if (GRADES_FEATURE_ENABLED) {
    return { ...base, page: 'grades', announcedBy: 'mes-notes' }
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

// `gradesSupported: false`: a student whose relevé Tafac can't read (not a
// BUT): no "Mes notes".
export function buildNavItems(establishment, { gradesSupported = true } = {}) {
  // Grades nav only for establishments whose config enables grade widgets.
  const gradesNavItem = gradesSupported && universityConfig.establishments?.byId?.[establishment]?.gradeWidgets
    ? buildGradesNavItem()
    : null

  return [
    {
      id: 'applications',
      label: 'Toutes les applications',
      icon: 'carbon:app-switcher',
      targetId: 'sidebar-section-applications',
    },
    ...(gradesNavItem ? [gradesNavItem] : []),
    // The in-app planning page (PlanningPage), launched by its own
    // « Nouveautés » entry (`announcedBy`, as « Mes notes »).
    ...(universityConfig.features?.planning
      ? [{ id: 'planning', label: 'Planning', icon: 'carbon:calendar', page: 'planning', announcedBy: 'planning' }]
      : []),
    // The in-app mail page (MailPage), or the webmail link (MAIL_ITEM).
    // shortLabel: the tab bar's narrower tabs.
    ...(universityConfig.features?.mail ? [MAIL_ITEM] : []),
    ...(MOODLE_HREF
      ? [{ id: 'moodle', label: 'Moodle', icon: 'devicon-plain:moodle', href: MOODLE_HREF, target: '_blank' }]
      : []),
  ]
}

// Opens a link item (grades service, planning) and records which app it was
// and where it was opened from.
export function openNavItemLink(item, source) {
  track('app_opened', { app: item.id, source })
  if (item.target === '_blank') {
    window.open(item.href, '_blank', 'noopener,noreferrer')
    return
  }

  window.location.assign(item.href)
}

// The shortcuts the mobile tab bar carries (every nav item but "Toutes les
// applications", which is the dashboard itself). Empty means no tab bar.
export function getMobileTabItems(establishment, options) {
  return buildNavItems(establishment, options).filter((item) => item.id !== 'applications')
}
