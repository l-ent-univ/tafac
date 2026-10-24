// Which URLs the launch relay (/__ent_auth/launch, /__ent_auth/launch-preview)
// may open with the student's cookie jar. The relay fetches the target on the
// server and redirects the browser to where the CAS sends it, so an open
// target would be both an open redirect from our domain and a way to make the
// server fetch any address (SSRF). Only the university's own services pass:
//
//   - the hosts of the origins and service URLs in its server config (ENT,
//     CAS, ADE, Moodle, planning, grades, webmail, certificate…);
//   - the sign-in domains its Moodle and webmail chains already allow;
//   - `launch.allowedDomains` (universities/<id>/server.js): domains whose
//     services the ENT lists, matched with their subdomains.
//
// Anything else is opened directly by the browser (launch-preview answers
// useServerLaunch: false) and the relay itself sends it back to the app.

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function normalizeDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return /^[a-z0-9.-]+$/.test(domain) && domain.includes('.') ? domain : null
}

export function collectLaunchHosts(config = {}) {
  const urls = [
    ...Object.values(config.origins ?? {}),
    config.planning?.serviceUrl,
    config.grades?.origin,
    config.grades?.serviceUrl,
    config.mail?.origin,
    config.mail?.webmailUrl,
    config.schoolCertificate?.origin,
  ]

  return new Set(urls.filter(Boolean).map(getHostname).filter(Boolean))
}

export function collectLaunchDomains(config = {}) {
  const domains = [
    ...(config.launch?.allowedDomains ?? []),
    ...(config.mail?.signInDomains ?? []),
    ...(config.moodle?.signInDomains ?? []),
  ]

  return new Set(domains.map(normalizeDomain).filter(Boolean))
}

// isAllowed(url): an http(s) URL on one of the hosts or domains above.
export function createLaunchTargetPolicy(config = {}) {
  const hosts = collectLaunchHosts(config)
  const domains = [...collectLaunchDomains(config)]

  function isAllowedHost(hostname) {
    const host = String(hostname ?? '').toLowerCase()
    if (!host) return false
    if (hosts.has(host)) return true
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  }

  function isAllowed(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
    let url = null
    try {
      url = new URL(value)
    } catch {
      return false
    }
    // No credentials in the URL: they would change what the host means.
    if (url.username || url.password) return false
    return isAllowedHost(url.hostname)
  }

  return { isAllowed, isAllowedHost, hosts, domains }
}
