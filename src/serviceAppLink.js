// Whether an app of the app lists leads to one of the university's services
// (the grade service, the planning), recognised by its link only. Pure, see
// tests/gradesPortalApp.test.js and tests/planningPortalApp.test.js, whose
// modules (gradesPortalApp.js, planningPortalApp.js) build on it.
//
// A link counts when it is on the service's origin, whatever the path, or
// when it is one of the wrappers that lead there: the launch relay
// (`/__ent_auth/launch?url=…`) and a CAS login (`/login?service=…`).

export function parseUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

// The origin of a service URL from the config, or null.
export function getServiceOrigin(serviceUrl) {
  return parseUrl(serviceUrl)?.origin ?? null
}

// `serviceOrigin`: the service's origin (getServiceOrigin).
// `base`: what relative links resolve against (the page's own URL).
// `launchPath`: the launch relay's path; `casOrigin`: the CAS server's.
export function isServiceHref(href, { serviceOrigin, base, launchPath = '', casOrigin = '' } = {}) {
  if (!serviceOrigin) return false
  const url = parseUrl(href, base)
  if (!url) return false
  if (url.origin === serviceOrigin) return true

  // One wrapper deep: a relay to a relay isn't something the portal makes.
  const baseOrigin = parseUrl(base)?.origin
  const isLaunchRelay = Boolean(launchPath) && url.origin === baseOrigin && url.pathname === launchPath
  const isCasLogin = Boolean(casOrigin) && url.origin === parseUrl(casOrigin)?.origin && /\/login\/?$/.test(url.pathname)
  const wrapped = isLaunchRelay ? url.searchParams.get('url') : isCasLogin ? url.searchParams.get('service') : null
  return parseUrl(wrapped)?.origin === serviceOrigin
}

// `resolvedHref`: another address the app is known to lead to, checked too.
export function isServiceApp(application, { resolvedHref = '', ...options } = {}) {
  if (!application) return false
  return [application.href, resolvedHref].some((href) => isServiceHref(href, options))
}
