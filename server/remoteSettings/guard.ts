// What a patch may not do, whoever signed it.
//
// A patch can switch a feature off or follow an address that moved. It can
// never send anything somewhere new: every address it names must be one of
// the university's own, as the app ships them (the hosts of the addresses in
// its settings, and the domains it lists: launch.allowedDomains, the
// sign-in chains'). A new domain takes a new version of the app, which is
// read before it is published.
//
// Nor may it name a file of the device (a mail's logo is read from one), or
// change which university the settings are.
import { isObject } from './document.ts'
import type { Json, JsonObject } from './document.ts'

const ADDRESS = /https?:\/\/[^\s"'<>\\]+/gi
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i
// Lists of domains in a university's settings (signInDomains, allowedDomains).
const DOMAIN_LIST = /domains$/i

function strings(value: unknown, visit: (text: string, key: string) => void, key = ''): void {
  if (typeof value === 'string') visit(value, key)
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, visit, key))
  else if (isObject(value)) Object.entries(value).forEach(([name, entry]) => strings(entry, visit, name))
}

function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

// The university's own domains, from its settings as the app ships them.
export function trustedDomains(config: unknown): string[] {
  const domains = new Set<string>()
  strings(config, (text, key) => {
    for (const address of text.match(ADDRESS) ?? []) {
      const host = address.toLowerCase().startsWith('https://') ? hostOf(address) : null
      if (host) domains.add(host)
    }
    if (DOMAIN_LIST.test(key) && BARE_HOST.test(text)) domains.add(text.toLowerCase())
  })
  return [...domains]
}

export function isTrustedHost(host: string, trusted: string[]): boolean {
  const name = host.toLowerCase()
  return trusted.some((domain) => name === domain || name.endsWith(`.${domain}`))
}

// Why a patch's settings are refused, or null.
export function refusal(override: JsonObject | undefined, trusted: string[]): string | null {
  if (!override) return null
  if ('id' in override) return 'changes which university this is'
  let reason: string | null = null
  const refuse = (text: string) => {
    reason ??= text
  }
  const visit = (value: Json, key: string): void => {
    if (key === 'file') return refuse('names a file of the device')
    if (typeof value === 'string') {
      for (const address of value.match(ADDRESS) ?? []) {
        if (!address.toLowerCase().startsWith('https://')) return refuse('an address that is not https')
        const host = hostOf(address)
        if (!host || !isTrustedHost(host, trusted)) return refuse(`an address outside the university's domains (${host ?? 'unreadable'})`)
      }
      if (BARE_HOST.test(value) && !isTrustedHost(value, trusted)) return refuse(`a host outside the university's domains (${value.toLowerCase()})`)
    } else if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, key))
    } else if (isObject(value)) {
      Object.entries(value).forEach(([name, entry]) => visit(entry as Json, name))
    }
  }
  Object.entries(override).forEach(([name, entry]) => visit(entry, name))
  return reason
}
