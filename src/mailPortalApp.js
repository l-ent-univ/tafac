// The webmail's app in the app lists (« Messagerie », « Webmail »…) and
// whether a tile of it opens the in-app mail page instead, as the planning
// service's opens the Planning page (planningPortalApp.js). Pure, see
// tests/mailPortalApp.test.js; AvailableApplications passes the config in.
//
// The app is recognised by its link (serviceAppLink.js): on one of the
// webmail's origins (mail.webmailUrls in client.js: its public entry and
// where the sign-in lands), directly or through the launch relay or a CAS
// login, never by its title. `appKeys` adds apps known by their key (fname,
// else id) whatever their link: the demo's « Messagerie ».
import { getServiceOrigin, isServiceApp } from './serviceAppLink.js'

// The origins of the webmail's URLs, without repeats.
export function getMailOrigins(urls = []) {
  return [...new Set((Array.isArray(urls) ? urls : []).map(getServiceOrigin).filter(Boolean))]
}

// `mailOrigins`: getMailOrigins's; `resolvedHref`, `base`, `launchPath`,
// `casOrigin`: as for the planning's (isServiceApp).
export function isMailPortalApp(application, { mailOrigins = [], appKeys = [], ...options } = {}) {
  if (!application) return false
  const key = application.fname || application.id
  if (key && appKeys.includes(key)) return true
  return mailOrigins.some((serviceOrigin) => isServiceApp(application, { ...options, serviceOrigin }))
}

// The one rule for every tile (grid, search results, favourites): open the
// mail page when the student has it, the webmail otherwise. `hasMailPage`:
// the page is in the student's navigation (features.mail, mail.page).
export function opensMailPageInApp(application, { hasMailPage = false, ...options } = {}) {
  return Boolean(hasMailPage) && isMailPortalApp(application, options)
}
