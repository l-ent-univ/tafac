// The grade service's app in the app lists (« Notes IUT Lannion »: the
// ScoDoc passerelle) and whether a tile of it opens « Mes notes » instead.
// Pure, see tests/gradesPortalApp.test.js; AvailableApplications passes the
// config in.
//
// The app is recognised by its link only, never by its title: the portal
// names it as it likes (« Notes », « Notes IUT Lannion », « ScoDoc »…) and
// other apps have « notes » in theirs. A link counts when it is on the grade
// service's origin, whatever the path (doAuth.php, the passerelle's pages),
// or when it is one of the wrappers that lead there: the launch relay
// (`/__ent_auth/launch?url=…`) and a CAS login (`/login?service=…`), see
// serviceAppLink.js.
import { getServiceOrigin, isServiceApp, isServiceHref } from './serviceAppLink.js'

// The origin of `serviceUrl` (grades.serviceUrl in the config), or null.
export function getGradesOrigin(serviceUrl) {
  return getServiceOrigin(serviceUrl)
}

// `base`: what relative links resolve against (the page's own URL).
// `launchPath`: the launch relay's path; `casOrigin`: the CAS server's.
export function isGradesPortalHref(href, { gradesOrigin, ...options } = {}) {
  return isServiceHref(href, { ...options, serviceOrigin: gradesOrigin })
}

// `resolvedHref`: another address the app is known to lead to, checked too.
export function isGradesPortalApp(application, { gradesOrigin, ...options } = {}) {
  return isServiceApp(application, { ...options, serviceOrigin: gradesOrigin })
}

// The one rule for every tile (grid, search results, favourites, sidebar):
// open « Mes notes » when the student has it, ScoDoc otherwise.
// `hasGradesPage`: the page is in the student's navigation, i.e. their
// establishment has it and their relevé isn't another formation's (unknown
// counts, as for the nav item).
export function opensGradesPageInApp(application, { hasGradesPage = false, ...options } = {}) {
  return Boolean(hasGradesPage) && isGradesPortalApp(application, options)
}
