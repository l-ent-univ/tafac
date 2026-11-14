// The cookies of one session at the university's services, as a browser
// would hold them: what the services set (setFromResponse), what goes back
// to each (getCookieHeader). server/sessionCookie.js packs it into the
// session cookie.
import { cookieKey, cookieMatchesHost, isExpired, pathMatches } from './cookie.ts'
import type { JarCookie } from './cookie.ts'
import { parseSetCookie } from './setCookie.ts'

export { cookieMatchesHost } from './cookie.ts'
export type { JarCookie } from './cookie.ts'

export class CookieJar {
  // By domain|path|name.
  store = new Map<string, JarCookie>()

  setFromResponse(response: Response, url: string): void {
    for (const rawCookie of response.headers.getSetCookie()) {
      this.setCookie(rawCookie, url)
    }
  }

  setCookie(rawCookie: string, url: string): void {
    const cookie = parseSetCookie(rawCookie, url)
    if (!cookie) return

    // Already past: how a service deletes one.
    if (isExpired(cookie)) {
      this.store.delete(cookieKey(cookie))
    } else {
      this.store.set(cookieKey(cookie), cookie)
    }
  }

  // The Cookie header for a request to `url`.
  getCookieHeader(url: string): string {
    const { hostname, pathname, protocol } = new URL(url)
    const matching: string[] = []

    for (const cookie of this.store.values()) {
      if (isExpired(cookie)) continue
      if (cookie.secure && protocol !== 'https:') continue
      if (!cookieMatchesHost(cookie, hostname)) continue
      if (!pathMatches(pathname, cookie.path)) continue
      matching.push(`${cookie.name}=${cookie.value}`)
    }

    return matching.join('; ')
  }

  private liveCookiesForHost(hostname: string): JarCookie[] {
    return [...this.store.values()].filter((cookie) => !isExpired(cookie) && cookieMatchesHost(cookie, hostname))
  }

  getCookieNamesForHost(hostname: string): string[] {
    return this.liveCookiesForHost(hostname)
      .map((cookie) => cookie.name)
      .sort((left, right) => left.localeCompare(right))
  }

  hasCookie(hostname: string, cookieName: string): boolean {
    return this.getCookieNamesForHost(hostname).includes(String(cookieName))
  }

  getCookieValue(hostname: string, cookieName: string): string | null {
    return this.liveCookiesForHost(hostname).find((cookie) => cookie.name === String(cookieName))?.value ?? null
  }

  deleteCookiesForHost(hostname: string): void {
    for (const [key, cookie] of this.store) {
      if (cookieMatchesHost(cookie, hostname)) this.store.delete(key)
    }
  }

  serialize(): [string, JarCookie][] {
    return [...this.store.entries()]
  }

  static fromSerialized(entries: Iterable<[string, JarCookie]> | null | undefined): CookieJar {
    const jar = new CookieJar()
    for (const [key, cookie] of entries ?? []) {
      jar.store.set(key, cookie)
    }
    return jar
  }
}
