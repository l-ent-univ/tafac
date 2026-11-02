import { createCipheriv } from 'node:crypto'
import { Buffer } from 'node:buffer'

// All university-specific values (origin, app headers, password crypto, etab)
// come from universities/<id>/server.js via the createAdeApiClient options.
const ADE_SESSION_TTL_MS = 30 * 60 * 1000
const ADE_UPCOMING_TTL_MS = 5 * 60 * 1000

const adeSessionCache = new Map()
const adeUpcomingCache = new Map()

function readJsonSafely(text) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function pruneCache(map, ttlMs) {
  const now = Date.now()

  for (const [key, entry] of map.entries()) {
    if (!entry?.cachedAt || now - entry.cachedAt > ttlMs) {
      map.delete(key)
    }
  }
}

function getFreshCacheEntry(map, key, ttlMs) {
  if (!key) {
    return null
  }

  pruneCache(map, ttlMs)
  const entry = map.get(key)

  if (!entry) {
    return null
  }

  if (Date.now() - entry.cachedAt > ttlMs) {
    map.delete(key)
    return null
  }

  return entry
}

function getCacheEntry(map, key) {
  if (!key) {
    return null
  }

  return map.get(key) ?? null
}

function setCacheEntry(map, key, value) {
  if (!key) {
    return
  }

  map.set(key, {
    cachedAt: Date.now(),
    value,
  })
}

function normalizeLabel(label) {
  return String(label ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function labelsMatch(left, right) {
  const normalizedLeft = normalizeLabel(left)
  const normalizedRight = normalizeLabel(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight} `)
    || normalizedRight.startsWith(`${normalizedLeft} `)
    || normalizedLeft.endsWith(` ${normalizedRight}`)
    || normalizedRight.endsWith(` ${normalizedLeft}`)
}

export function buildAdeAppHeaders(session = 'null', extraHeaders = {}, appHeaders = {}) {
  return {
    ...appHeaders,
    session: session || 'null',
    ...extraHeaders,
  }
}

export function encryptAdePassword(password, passwordKey, passwordIv) {
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from(passwordKey, 'utf8'),
    Buffer.from(passwordIv, 'utf8'),
  )

  return Buffer.concat([
    cipher.update(String(password ?? ''), 'utf8'),
    cipher.final(),
  ]).toString('base64')
}

export function normalizeAdeUsername(username) {
  const rawUsername = String(username ?? '').trim()

  if (!rawUsername) {
    return ''
  }

  const casParts = rawUsername.split('cas:uid')
  if (casParts.length > 2) {
    const embeddedValue = casParts[1] ?? ''
    return embeddedValue.slice(1, Math.max(embeddedValue.length - 2, 1)) || rawUsername
  }

  const jwtParts = rawUsername.split('.')
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'))
      const casUid = payload?.['cas:uid']

      if (typeof casUid === 'string' && casUid.trim()) {
        return casUid.trim()
      }

      if (Array.isArray(casUid) && typeof casUid[0] === 'string' && casUid[0].trim()) {
        return casUid[0].trim()
      }
    } catch {
      // Not a JWT payload we can decode.
    }
  }

  return rawUsername
}

export function extractAdeSessionValue(loginData) {
  return loginData?.sessionId ?? loginData?.session ?? loginData?.token ?? null
}

export function getAdeSelectionLabels(selection = null) {
  const candidates = [
    selection?.tpLabel,
    selection?.tdLabel,
    selection?.yearLabel,
    selection?.label,
  ]

  return candidates.filter((value, index) => {
    const normalizedValue = normalizeLabel(value)
    if (!normalizedValue) {
      return false
    }

    return candidates.findIndex((candidate) => normalizeLabel(candidate) === normalizedValue) === index
  }).map((value) => String(value).trim())
}

// The group's own resources, then the courses added beside it (a major, a
// minor, options: `extraResources`, src/profileStorage.js), at most 12.
export function getAdeSelectionResourceIds(selection = null) {
  const candidates = [
    selection?.tpResourceId,
    selection?.tdResourceId,
    selection?.yearResourceId,
    selection?.resourceId,
    ...(Array.isArray(selection?.extraResources) ? selection.extraResources.slice(0, 12).map((entry) => entry?.resourceId) : []),
  ]

  return candidates.filter((value, index) => {
    const normalizedValue = String(value ?? '').trim()
    if (!normalizedValue) {
      return false
    }

    return candidates.findIndex((candidate) => String(candidate ?? '').trim() === normalizedValue) === index
  }).map((value) => String(value).trim())
}

export function parseAdeGroups(groupsInfos = '') {
  return String(groupsInfos ?? '')
    .split(/[,;]+/)
    .map((group) => group.trim())
    .filter(Boolean)
}

export function getAdeResourcePrefix(authPayload = null) {
  const candidates = [
    ...(Array.isArray(authPayload?.customEtabVet) ? authPayload.customEtabVet : []),
    authPayload?.adeCustomTree,
    ...Object.keys(authPayload?.customEtabVetMap ?? {}),
  ]

  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    const separatorIndex = value.lastIndexOf(':')

    if (separatorIndex > 0) {
      return `${value.slice(0, separatorIndex + 1)}`
    }
  }

  return null
}

export function normalizeAdeResourceIds(resourceIds = [], authPayload = null) {
  const prefix = getAdeResourcePrefix(authPayload)
  const fallbackResourceIds = Array.isArray(authPayload?.customEtabVet)
    ? authPayload.customEtabVet
    : authPayload?.adeCustomTree
      ? [authPayload.adeCustomTree]
      : []
  const sourceIds = Array.isArray(resourceIds) && resourceIds.length > 0 ? resourceIds : fallbackResourceIds

  return sourceIds.filter((value, index) => {
    const rawValue = String(value ?? '').trim()

    if (!rawValue) {
      return false
    }

    const normalizedValue = rawValue.includes(':') || !prefix ? rawValue : `${prefix}${rawValue}`
    return sourceIds.findIndex((candidate) => {
      const rawCandidate = String(candidate ?? '').trim()
      if (!rawCandidate) {
        return false
      }

      const normalizedCandidate = rawCandidate.includes(':') || !prefix ? rawCandidate : `${prefix}${rawCandidate}`
      return normalizedCandidate === normalizedValue
    }) === index
  }).map((value) => {
    const rawValue = String(value).trim()
    return rawValue.includes(':') || !prefix ? rawValue : `${prefix}${rawValue}`
  })
}

export function normalizeAdeUpcomingEvent(event) {
  if (!event || typeof event !== 'object') {
    return null
  }

  const startMs = Number(event.from)
  const endMs = Number(event.to)
  const start = Number.isFinite(startMs) ? new Date(startMs).toISOString() : null
  const end = Number.isFinite(endMs) ? new Date(endMs).toISOString() : null

  if (!start) {
    return null
  }

  return {
    uid: String(event.uid ?? ''),
    title: String(event.summary ?? '').trim(),
    teacher: String(event.description ?? '').trim(),
    location: String(event.location ?? '').trim(),
    groups: parseAdeGroups(event.groupsInfos),
    groupsLabel: String(event.groupsInfos ?? '').trim(),
    start,
    end,
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : startMs,
    editable: Boolean(event.editable),
    color: String(event.color ?? '').trim(),
    hue: Number.isFinite(Number(event.hue)) ? Number(event.hue) : null,
    link: event.link ?? null,
  }
}

export function filterAdeUpcomingEvents(events = [], selectionLabels = []) {
  const allowedLabels = selectionLabels.filter(Boolean)

  if (!allowedLabels.length) {
    return events
  }

  return events.filter((event) => {
    if (!Array.isArray(event?.groups) || event.groups.length === 0) {
      return true
    }

    return event.groups.some((groupLabel) => allowedLabels.some((allowedLabel) => labelsMatch(groupLabel, allowedLabel)))
  })
}

export function normalizeAdeUpcomingResponse(rawData) {
  const rawEvents = rawData?.events && typeof rawData.events === 'object'
    ? Object.values(rawData.events)
    : []
  const events = rawEvents
    .map(normalizeAdeUpcomingEvent)
    .filter(Boolean)
    .sort((left, right) => (
      (left?.startMs ?? 0) - (right?.startMs ?? 0)
      || (left?.endMs ?? 0) - (right?.endMs ?? 0)
      || String(left?.title ?? '').localeCompare(String(right?.title ?? ''))
    ))

  return {
    complete: rawData?.complete !== false,
    events,
    raw: rawData,
  }
}

export function limitAdeUpcomingEvents(events = [], { date, lookaheadDays = 21 } = {}) {
  if (!date) {
    return events
  }

  const windowStart = new Date(`${date}T00:00:00`)
  const windowEnd = new Date(windowStart)
  windowEnd.setDate(windowEnd.getDate() + Math.max(1, lookaheadDays))

  const startMs = windowStart.getTime()
  const endMs = windowEnd.getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return events
  }

  return events.filter((event) => {
    const eventStartMs = Number.isFinite(event?.startMs)
      ? event.startMs
      : event?.start
        ? Date.parse(event.start)
        : NaN
    const eventEndMs = Number.isFinite(event?.endMs)
      ? event.endMs
      : event?.end
        ? Date.parse(event.end)
        : eventStartMs

    if (!Number.isFinite(eventStartMs) || !Number.isFinite(eventEndMs)) {
      return false
    }

    return eventEndMs >= startMs && eventStartMs < endMs
  })
}

export function buildAdeUpcomingPath({ date, lookaheadDays = 21, refresh = 0 } = {}) {
  const params = new URLSearchParams()

  if (date) {
    params.set('date', String(date))
  }

  params.set('nbDays', String(lookaheadDays))
  params.set('refresh', String(refresh))

  return `/timetable/getLastFromResources?${params.toString()}`
}

export function createAdeApiClient({
  adeOrigin,
  casOrigin = null,
  fetchImpl = fetch,
  followRedirectChain = null,
  passwordKey,
  passwordIv,
  appHeaders = {},
  etab,
} = {}) {
  const adeApiBase = `${adeOrigin}/api`

  async function fetchAdeApi(path, session, extraHeaders = {}) {
    const url = `${adeApiBase}${path}`
    const response = await fetchImpl(url, {
      headers: buildAdeAppHeaders(session, extraHeaders, appHeaders),
    })
    const text = await response.text()
    const data = readJsonSafely(text) ?? text

    return {
      ok: response.ok,
      status: response.status,
      data,
      text,
    }
  }

  function invalidateAdeSessionCache(cacheScope = null) {
    if (!cacheScope) {
      return
    }

    adeSessionCache.delete(cacheScope)
  }

  function clearAdeCaches(cacheScope = null) {
    if (!cacheScope) {
      return
    }

    adeSessionCache.delete(cacheScope)

    for (const key of adeUpcomingCache.keys()) {
      if (key === cacheScope || key.startsWith(`${cacheScope}::`)) {
        adeUpcomingCache.delete(key)
      }
    }
  }

  async function authenticateToAde(jar, credentials = null, { cacheScope = null } = {}) {
    const cachedEntry = getFreshCacheEntry(adeSessionCache, cacheScope, ADE_SESSION_TTL_MS)
    if (cachedEntry) {
      return {
        ...cachedEntry.value,
        cache: 'hit',
      }
    }

    let authResult = null

    if (credentials?.username && credentials?.password) {
      const loginResponse = await fetchImpl(`${adeApiBase}/auth/login`, {
        method: 'POST',
        headers: buildAdeAppHeaders('null', {}, appHeaders),
        body: JSON.stringify({
          username: normalizeAdeUsername(credentials.username),
          password: encryptAdePassword(credentials.password, passwordKey, passwordIv),
          etab: credentials.etab ?? etab,
        }),
      })
      const loginText = await loginResponse.text()
      const loginData = readJsonSafely(loginText)
      const session = extractAdeSessionValue(loginData)

      if (session) {
        authResult = {
          session,
          loginStatus: loginResponse.status,
          loginData,
          authMode: 'credentials',
          cache: 'miss',
        }
      } else if (loginResponse.ok) {
        authResult = {
          session: null,
          loginStatus: loginResponse.status,
          loginData,
          authMode: 'credentials',
          cache: 'miss',
        }
      }
    }

    if (!authResult?.session && jar && followRedirectChain && casOrigin) {
      const serviceUrl = `${adeOrigin}/web/`
      const casLoginUrl = `${casOrigin}/login?service=${encodeURIComponent(serviceUrl)}`
      const casResult = await followRedirectChain(casLoginUrl, jar, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        },
      })
      await casResult.response.text()

      let ticket = null
      let actualServiceUrl = serviceUrl

      for (const hop of casResult.chain) {
        for (const candidate of [hop.location, hop.url]) {
          if (!candidate) {
            continue
          }

          const match = candidate.match(/^([^?]+)\?.*ticket=([^&]+)/)
          if (match) {
            actualServiceUrl = match[1]
            ticket = match[2]
          }
        }
      }

      if (!ticket) {
        const finalMatch = casResult.finalUrl.match(/^([^?]+)\?.*ticket=([^&]+)/)
        if (finalMatch) {
          actualServiceUrl = finalMatch[1]
          ticket = finalMatch[2]
        }
      }

      if (ticket) {
        const loginResponse = await fetchImpl(`${adeApiBase}/auth/login`, {
          method: 'POST',
          headers: buildAdeAppHeaders('null', {}, appHeaders),
          body: JSON.stringify({
            ticket,
            service: actualServiceUrl,
          }),
        })
        const loginText = await loginResponse.text()
        const loginData = readJsonSafely(loginText)
        const session = extractAdeSessionValue(loginData)

        authResult = {
          session,
          ticket,
          loginStatus: loginResponse.status,
          loginData,
          actualServiceUrl,
          finalUrl: casResult.finalUrl,
          authMode: 'cas',
          cache: 'miss',
        }
      } else if (!authResult) {
        authResult = {
          session: null,
          ticket: null,
          error: 'No CAS ticket obtained',
          finalUrl: casResult.finalUrl,
          chain: casResult.chain,
          authMode: 'cas',
          cache: 'miss',
        }
      }
    }

    if (!authResult) {
      authResult = {
        session: null,
        authMode: credentials ? 'credentials' : 'cas',
        cache: 'miss',
      }
    }

    if (cacheScope && authResult.session) {
      setCacheEntry(adeSessionCache, cacheScope, authResult)
    }

    return authResult
  }

  async function fetchAdeUpcomingRaw(jar, credentials, {
    date,
    lookaheadDays = 21,
    resourceIds = [],
    cacheScope = null,
  } = {}) {
    const authResult = await authenticateToAde(jar, credentials, { cacheScope })

    if (!authResult.session) {
      throw new Error('Unable to establish an ADE mobile-app session.')
    }

    const normalizedResourceIds = normalizeAdeResourceIds(resourceIds, authResult.loginData)
    const resourceHeader = normalizedResourceIds.join(',')
    const cacheKey = cacheScope
      ? `${cacheScope}::${String(date ?? '')}::${String(lookaheadDays)}::${resourceHeader}`
      : null
    const freshCacheEntry = getFreshCacheEntry(adeUpcomingCache, cacheKey, ADE_UPCOMING_TTL_MS)

    if (freshCacheEntry) {
      return {
        ...freshCacheEntry.value,
        authResult,
        cache: 'hit',
      }
    }

    const staleCacheEntry = getCacheEntry(adeUpcomingCache, cacheKey)
    const path = buildAdeUpcomingPath({ date, lookaheadDays, refresh: 0 })

    async function performRequest(sessionValue) {
      return fetchAdeApi(path, sessionValue, resourceHeader ? { CustomVets: resourceHeader } : {})
    }

    let response = await performRequest(authResult.session)

    if ((response.status === 401 || response.status === 403) && cacheScope) {
      invalidateAdeSessionCache(cacheScope)
      const refreshedAuthResult = await authenticateToAde(jar, credentials, { cacheScope })

      if (!refreshedAuthResult.session) {
        throw new Error('ADE session refresh failed.')
      }

      response = await performRequest(refreshedAuthResult.session)

      if (response.ok) {
        authResult.session = refreshedAuthResult.session
        authResult.loginData = refreshedAuthResult.loginData
        authResult.authMode = refreshedAuthResult.authMode
      }
    }

    if (!response.ok || !response.data || typeof response.data !== 'object') {
      if (staleCacheEntry) {
        return {
          ...staleCacheEntry.value,
          authResult,
          cache: 'stale',
        }
      }

      throw new Error(`ADE upcoming request failed with status ${response.status}.`)
    }

    const rawResult = {
      complete: response.data.complete !== false,
      rawData: response.data,
      resourceIds: normalizedResourceIds,
      apiStatus: response.status,
    }

    if (cacheKey) {
      setCacheEntry(adeUpcomingCache, cacheKey, rawResult)
    }

    return {
      ...rawResult,
      authResult,
      cache: 'miss',
    }
  }

  async function fetchAdeUpcomingFromApi(jar, credentials, {
    date,
    lookaheadDays = 21,
    resourceIds = [],
    selectionLabels = [],
    cacheScope = null,
  } = {}) {
    const rawResult = await fetchAdeUpcomingRaw(jar, credentials, {
      date,
      lookaheadDays,
      resourceIds,
      cacheScope,
    })
    const normalizedResult = normalizeAdeUpcomingResponse(rawResult.rawData)
    const windowedEvents = limitAdeUpcomingEvents(normalizedResult.events, {
      date,
      lookaheadDays,
    })
    const allowedLabels = selectionLabels.filter(Boolean)

    return {
      complete: rawResult.complete,
      events: filterAdeUpcomingEvents(windowedEvents, allowedLabels),
      allEvents: windowedEvents,
      resourceIds: rawResult.resourceIds,
      selectionLabels: allowedLabels,
      authMode: rawResult.authResult?.authMode ?? null,
      apiStatus: rawResult.apiStatus,
      cache: rawResult.cache,
      sessionCache: rawResult.authResult?.cache ?? 'miss',
    }
  }

  return {
    authenticateToAde,
    fetchAdeApi,
    fetchAdeUpcomingFromApi,
    clearAdeCaches,
    invalidateAdeSessionCache,
  }
}
