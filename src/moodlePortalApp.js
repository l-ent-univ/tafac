// Moodle's app in the app lists (« Moodle - FOAD », « Cursus »…) and
// whether a tile of it opens the app's own « Moodle » instead of the site:
// the desktop app's, where Moodle is a page (src/components/MoodlePage.jsx),
// as the webmail's app opens the mail page (mailPortalApp.js). Pure, see
// tests/moodlePortalApp.test.js; AvailableApplications passes the config in.
//
// The app is recognised by its link (serviceAppLink.js): on Moodle's origin
// (origins.moodle in the config), directly or through the launch relay or a
// CAS login, never by its title.
import { getServiceOrigin, isServiceApp } from './serviceAppLink.js'

// The origin of Moodle (origins.moodle in the config), or null.
export function getMoodleOrigin(moodleUrl) {
  return getServiceOrigin(moodleUrl)
}

// `moodleOrigin`: getMoodleOrigin's; `resolvedHref`, `base`, `launchPath`,
// `casOrigin`: as for the planning's (isServiceApp).
export function isMoodlePortalApp(application, { moodleOrigin, ...options } = {}) {
  if (!application) return false
  return isServiceApp(application, { ...options, serviceOrigin: moodleOrigin })
}

// The one rule for every tile (grid, search results, favourites): open
// « Moodle » when the student has that page (the desktop app), the site
// otherwise.
export function opensMoodlePageInApp(application, { hasMoodlePage = false, ...options } = {}) {
  return Boolean(hasMoodlePage) && isMoodlePortalApp(application, options)
}
