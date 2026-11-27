import universityConfig from '@university'
import { track } from './analytics'
import { ENT_AUTH_PREFIX } from './entApi'
import { isNativeApp } from './desktopApp'
import { DEMO_WEBMAIL_HREF } from './demoAccount'
import {
  GRADES_FEATURE_DISABLED,
  GRADES_FEATURE_ENABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_TITLE,
} from './gradeFeatureState'

// Main navigation, shared by the desktop sidebar and the mobile tab bar.

const MOODLE_ORIGIN = universityConfig.origins?.moodle ?? null
const MOODLE_URL = universityConfig.features?.moodle && MOODLE_ORIGIN ? `${MOODLE_ORIGIN.replace(/\/$/, '')}/my/` : null
const MOODLE_HREF = MOODLE_URL ? `${ENT_AUTH_PREFIX}/launch?url=${encodeURIComponent(MOODLE_URL)}` : null
// Without the in-app mail page (mail.page: false in client.js), « Messagerie »
// is the "Mails récents" card's link: the server opens the webmail already
// signed in (or falls back to its launch URL).
const MAIL_ITEM = universityConfig.mail?.page === false
  ? { id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'ph:envelope-simple', iconActive: 'ph:envelope-simple-fill', href: `${ENT_AUTH_PREFIX}/mail/open`, target: '_blank' }
  : { id: 'mail', label: 'Messagerie', shortLabel: 'Mail', icon: 'ph:envelope-simple', iconActive: 'ph:envelope-simple-fill', page: 'mail', announcedBy: 'messagerie' }

// "Mes notes" follows the tri-state grades feature: the in-app grades page
// when live, a greyed-out item with the unavailability notice when
// 'disabled', nothing otherwise.
// `announcedBy`: the « Nouveautés » entry that launched the page; the item
// says « Nouveau » while this device hasn't seen it (changelogStore).
function buildGradesNavItem() {
  const base = { id: 'grades', label: 'Mes notes', icon: 'ph:chart-pie-slice', iconActive: 'ph:chart-pie-slice-fill' }

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
// BUT): no "Mes notes". `demo`: the demo account, whose sign-in is the
// page's own (src/demoSession.js): no session for the launch relay to sign
// in with, nor for the apps' « Moodle » page to open on, so its links go to
// the services' own addresses, in a tab.
export function buildNavItems(establishment, { gradesSupported = true, demo = false } = {}) {
  // Grades nav only for establishments whose config enables grade widgets.
  const gradesNavItem = gradesSupported && universityConfig.establishments?.byId?.[establishment]?.gradeWidgets
    ? buildGradesNavItem()
    : null

  return [
    // « Accueil » (HomeDraftPage), every university: the home page, its
    // « Toutes les applications » drawer listing every app. The tab bar has
    // its own home tab (getMobileTabItems leaves this one out).
    { id: 'home', label: 'Accueil', icon: 'ph:house', iconActive: 'ph:house-fill', page: 'home' },
    ...(gradesNavItem ? [gradesNavItem] : []),
    // The in-app planning page (PlanningPage), launched by its own
    // « Nouveautés » entry (`announcedBy`, as « Mes notes »).
    ...(universityConfig.features?.planning
      ? [{ id: 'planning', label: 'Planning', icon: 'ph:calendar-blank', iconActive: 'ph:calendar-blank-fill', page: 'planning', announcedBy: 'planning' }]
      : []),
    // The in-app mail page (MailPage), or the webmail link (MAIL_ITEM).
    // shortLabel: the tab bar's narrower tabs.
    ...(universityConfig.features?.mail ? [demo && MAIL_ITEM.href ? { ...MAIL_ITEM, href: DEMO_WEBMAIL_HREF } : MAIL_ITEM] : []),
    // « Assiduité » (AssiduityPage): the absences of the ScoDoc relevé,
    // so on the same terms as the live « Mes notes » page.
    ...(gradesNavItem?.page === 'grades'
      ? [{ id: 'assiduity', label: 'Assiduité', icon: 'ph:user-check', iconActive: 'ph:user-check-fill', page: 'assiduity' }]
      : []),
    // Moodle: in the apps (desktop, iOS), a page of its own (MoodlePage,
    // Moodle in the window); in a browser, a new tab signed in through the
    // launch relay.
    ...(MOODLE_HREF
      ? [isNativeApp() && !demo
        ? { id: 'moodle', label: 'Moodle', icon: 'devicon-plain:moodle', page: 'moodle' }
        : { id: 'moodle', label: 'Moodle', icon: 'devicon-plain:moodle', href: demo ? MOODLE_URL : MOODLE_HREF, target: '_blank' }]
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

// The shortcuts the mobile tab bar carries (every nav item but « Accueil »,
// the bar's own home tab). Empty means no tab bar.
export function getMobileTabItems(establishment, options) {
  return buildNavItems(establishment, options).filter((item) => item.id !== 'home')
}
