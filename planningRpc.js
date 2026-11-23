// All university-specific values (planning origin, GWT client id) come from
// universities/<id>/server.js via the createPlanningRpcClient options.
const DAY_MS = 24 * 60 * 60 * 1000
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const CONTEXT_CACHE_STALE_MS = 55 * 60 * 1000
const TREE_CACHE_TTL_MS = 30 * 60 * 1000
const TREE_CACHE_STALE_MS = 6 * 60 * 60 * 1000
const TIMETABLE_CURRENT_WEEK_TTL_MS = 5 * 60 * 1000
const TIMETABLE_CURRENT_WEEK_STALE_MS = 2 * 60 * 60 * 1000
const TIMETABLE_HISTORICAL_TTL_MS = 60 * 60 * 1000
const TIMETABLE_HISTORICAL_STALE_MS = 24 * 60 * 60 * 1000
const PLANNING_CACHE_LIMITS = {
  context: 200,
  tree: 500,
  timetable: 1000,
}
const PLANNING_GWT_PERMUTATION_KEYS = [
  'webClient',
  'configuration',
  'myPlanning',
  'directPlanning',
  'directPlanningPlanning',
  'pac',
]
const PLANNING_GWT_SERVICE_NAMES = {
  webClient: 'WebClientServiceProxy',
  configuration: 'ConfigurationServiceProxy',
  myPlanning: 'MyPlanningClientServiceProxy',
  directPlanning: 'DirectPlanningServiceProxy',
  directPlanningPlanning: 'DirectPlanningPlanningServiceProxy',
  pac: 'PacServiceProxy',
}
const PLANNING_GWT_PREFERRED_LOCALES = ['fr', 'en']
const PLANNING_GWT_PREFERRED_USER_AGENTS = ['gecko1_8', 'safari', 'opera', 'ie9', 'ie8', 'ie6']
const PLANNING_GWT_FALLBACK_HASH = 'D74BAF09539E11D1E86ED106DDBCC395'
const PLANNING_GWT_FALLBACK_SERIALIZATION_POLICIES = {
  webClient: 'FE500F0EAC5A5732DFC902C566E7EBA7',
  configuration: '2151F6DCAC1F72D0ABE4B87ADF1A9E37',
  myPlanning: '2912ADA6C426CFB85D3ACABE4CE65F74',
  directPlanning: 'ED09B1B4CB67D19361C6552338791595',
  directPlanningPlanning: 'F37B3FF029554C53D8CCFA3BD4A4621C',
  pac: 'D9934DAC4B2CC6CE64601BBCF028E77A',
}
const PLANNING_TREE_ROOT_CONFIG = '{"-100""true""-1""-1""-1""-1""0""false"[0]"""""0""0"[0][0]'

function buildPlanningPermutationSet(hash) {
  return Object.fromEntries(PLANNING_GWT_PERMUTATION_KEYS.map((key) => [key, hash]))
}

const PLANNING_GWT_FALLBACK_PERMUTATIONS = buildPlanningPermutationSet(PLANNING_GWT_FALLBACK_HASH)

function isPlanningPermutationHash(value) {
  return /^[A-F0-9]{32}$/.test(String(value ?? '').trim())
}

function extractPlanningBootstrapConstants(scriptText) {
  const constants = new Map()

  for (const match of scriptText.matchAll(/([A-Za-z$][\w$]*)='([^']*)'/g)) {
    constants.set(match[1], match[2])
  }

  return constants
}

function extractPlanningPermutationsFromBootstrap(scriptText) {
  const constants = extractPlanningBootstrapConstants(scriptText)
  const permutationsByLocale = new Map()

  for (const match of scriptText.matchAll(/H\(\[([A-Za-z$][\w$]*),([A-Za-z$][\w$]*)\],([A-Za-z$][\w$]*)\)/g)) {
    const locale = constants.get(match[1])
    const userAgent = constants.get(match[2])
    const hash = constants.get(match[3])

    if (!locale || !userAgent || !isPlanningPermutationHash(hash)) {
      continue
    }

    if (!permutationsByLocale.has(locale)) {
      permutationsByLocale.set(locale, new Map())
    }

    permutationsByLocale.get(locale).set(userAgent, hash)
  }

  for (const locale of PLANNING_GWT_PREFERRED_LOCALES) {
    const localePermutations = permutationsByLocale.get(locale)
    if (!localePermutations) {
      continue
    }

    for (const userAgent of PLANNING_GWT_PREFERRED_USER_AGENTS) {
      const selectedHash = localePermutations.get(userAgent)
      if (isPlanningPermutationHash(selectedHash)) {
        return buildPlanningPermutationSet(selectedHash)
      }
    }

    const firstHash = Array.from(localePermutations.values()).find(isPlanningPermutationHash)
    if (firstHash) {
      return buildPlanningPermutationSet(firstHash)
    }
  }

  const fallbackHash = Array.from(permutationsByLocale.values())
    .flatMap((localePermutations) => Array.from(localePermutations.values()))
    .find(isPlanningPermutationHash)

  if (fallbackHash) {
    return buildPlanningPermutationSet(fallbackHash)
  }

  throw new Error('Could not extract any planning GWT permutation from bootstrap.')
}

function buildPlanningSerializationPolicySet(policiesByServiceName) {
  const serializationPolicies = {}

  for (const key of PLANNING_GWT_PERMUTATION_KEYS) {
    const serviceName = PLANNING_GWT_SERVICE_NAMES[key]
    const policy = policiesByServiceName.get(serviceName)

    if (!isPlanningPermutationHash(policy)) {
      throw new Error(`Could not extract planning GWT serialization policy for ${serviceName}.`)
    }

    serializationPolicies[key] = policy
  }

  return serializationPolicies
}

export function extractPlanningSerializationPoliciesFromCache(scriptText) {
  const policiesByServiceName = new Map()

  // The minified names change with each ADE build (Rennes: $w/$Ad,
  // Sorbonne Nouvelle 6.12: Xx/UDd): any `<fn>.call(this,<fn>(),…)`.
  for (const match of scriptText.matchAll(/[\w$]+\.call\(this,[\w$]+\(\),'([^']+)','([A-F0-9]{32})'/g)) {
    policiesByServiceName.set(match[1], match[2])
  }

  return buildPlanningSerializationPolicySet(policiesByServiceName)
}

function clonePlanningCacheValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

function createPlanningCacheStore(maxEntries) {
  return {
    entries: new Map(),
    maxEntries,
  }
}

function prunePlanningCacheStore(store) {
  if (!(store?.entries instanceof Map)) {
    return
  }

  const now = Date.now()

  for (const [key, entry] of store.entries.entries()) {
    if (entry.pendingPromise) {
      continue
    }

    if (entry.staleUntil <= now) {
      store.entries.delete(key)
    }
  }

  if (store.entries.size <= store.maxEntries) {
    return
  }

  const evictionCandidates = Array.from(store.entries.entries())
    .filter(([, entry]) => !entry.pendingPromise)
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)

  while (store.entries.size > store.maxEntries && evictionCandidates.length > 0) {
    const [key] = evictionCandidates.shift()
    store.entries.delete(key)
  }
}

function createPlanningCacheEntry(value, policy) {
  const now = Date.now()

  return {
    value: clonePlanningCacheValue(value),
    cachedAt: now,
    expiresAt: now + policy.ttlMs,
    staleUntil: now + policy.ttlMs + policy.staleMs,
    lastAccessedAt: now,
    pendingPromise: null,
  }
}

function touchPlanningCacheEntry(entry) {
  if (!entry) {
    return
  }

  entry.lastAccessedAt = Date.now()
}

function buildPlanningCacheMetadata(bucket, status, policy, entry, extra = {}) {
  const now = Date.now()

  return {
    bucket,
    enabled: true,
    status,
    cachedAt: entry?.cachedAt ?? null,
    expiresAt: entry?.expiresAt ?? null,
    staleUntil: entry?.staleUntil ?? null,
    ageMs: entry?.cachedAt ? Math.max(0, now - entry.cachedAt) : null,
    ttlMs: policy.ttlMs,
    staleMs: policy.staleMs,
    ...extra,
  }
}

function attachPlanningCacheMetadata(value, cache) {
  const clonedValue = clonePlanningCacheValue(value)
  clonedValue.cache = cache
  return clonedValue
}

function buildBypassCacheMetadata(bucket, policy) {
  return {
    bucket,
    enabled: false,
    status: 'bypass',
    cachedAt: null,
    expiresAt: null,
    staleUntil: null,
    ageMs: null,
    ttlMs: policy.ttlMs,
    staleMs: policy.staleMs,
  }
}

function startPlanningCacheRefresh(store, key, loadValue, policy) {
  const existingEntry = store.entries.get(key)

  if (existingEntry?.pendingPromise) {
    return existingEntry.pendingPromise
  }

  const refreshPromise = (async () => {
    const loadedValue = await loadValue()
    const nextEntry = createPlanningCacheEntry(loadedValue, policy)
    store.entries.set(key, nextEntry)
    prunePlanningCacheStore(store)
    return nextEntry
  })()

  store.entries.set(key, {
    value: existingEntry?.value,
    cachedAt: existingEntry?.cachedAt ?? null,
    expiresAt: existingEntry?.expiresAt ?? 0,
    staleUntil: existingEntry?.staleUntil ?? 0,
    lastAccessedAt: Date.now(),
    pendingPromise: refreshPromise,
  })

  refreshPromise.catch(() => {
    const currentEntry = store.entries.get(key)
    if (!currentEntry || currentEntry.pendingPromise !== refreshPromise) {
      return
    }

    if (existingEntry?.value !== undefined) {
      store.entries.set(key, {
        ...existingEntry,
        pendingPromise: null,
        lastAccessedAt: Date.now(),
      })
      return
    }

    store.entries.delete(key)
  })

  return refreshPromise
}

async function readThroughPlanningCache({
  bucket,
  cacheScope,
  cacheStore,
  cacheKey,
  policy,
  loadValue,
  allowStaleWhileRevalidate = false,
}) {
  if (!cacheScope || !cacheStore || !cacheKey) {
    const value = await loadValue()
    return attachPlanningCacheMetadata(value, buildBypassCacheMetadata(bucket, policy))
  }

  const now = Date.now()
  const entry = cacheStore.entries.get(cacheKey)
  touchPlanningCacheEntry(entry)

  if (entry?.value !== undefined && now < entry.expiresAt) {
    return attachPlanningCacheMetadata(entry.value, buildPlanningCacheMetadata(bucket, 'hit', policy, entry))
  }

  if (entry?.value !== undefined && now < entry.staleUntil && allowStaleWhileRevalidate) {
    startPlanningCacheRefresh(cacheStore, cacheKey, loadValue, policy)

    return attachPlanningCacheMetadata(
      entry.value,
      buildPlanningCacheMetadata(bucket, 'stale', policy, entry, {
        revalidating: true,
      }),
    )
  }

  const hadCachedValue = entry?.value !== undefined

  try {
    const freshEntry = await startPlanningCacheRefresh(cacheStore, cacheKey, loadValue, policy)
    return attachPlanningCacheMetadata(
      freshEntry.value,
      buildPlanningCacheMetadata(bucket, hadCachedValue ? 'refresh' : 'miss', policy, freshEntry),
    )
  } catch (error) {
    if (entry?.value !== undefined && now < entry.staleUntil) {
      return attachPlanningCacheMetadata(
        entry.value,
        buildPlanningCacheMetadata(bucket, 'stale-error', policy, entry, {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }

    throw error
  }
}

function normalizePlanningCacheScope(rawScope) {
  const normalizedScope = String(rawScope ?? '').trim()
  return normalizedScope || null
}

function deletePlanningCacheEntry(store, key) {
  if (!(store?.entries instanceof Map) || !key) {
    return
  }

  store.entries.delete(key)
}

function isPlanningInvalidIdentifierError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('GwtInvalidIdentifier')
}

function buildPlanningTimetablePolicy(resolvedWeek) {
  if (resolvedWeek?.current) {
    return {
      ttlMs: TIMETABLE_CURRENT_WEEK_TTL_MS,
      staleMs: TIMETABLE_CURRENT_WEEK_STALE_MS,
    }
  }

  return {
    ttlMs: TIMETABLE_HISTORICAL_TTL_MS,
    staleMs: TIMETABLE_HISTORICAL_STALE_MS,
  }
}

function buildPlanningRpcHeaders(moduleBase, permutation) {
  return {
    'Content-Type': 'text/x-gwt-rpc; charset=utf-8',
    'X-GWT-Module-Base': moduleBase,
    'X-GWT-Permutation': permutation,
  }
}

function evaluatePlanningRpcPayload(text) {
  if (!text.startsWith('//OK')) {
    throw new Error(`Unexpected planning payload: ${text.slice(0, 120)}`)
  }

  return Function(`"use strict"; return (${text.slice(4)});`)()
}

function parsePlanningFirstInteger(text) {
  const match = text.match(/^\/\/OK\[(-?\d+)/)
  return match ? Number(match[1]) : null
}

function parsePlanningIdentifier(text) {
  const match = text.match(/"L\d+"/)
  return match ? match[0].slice(1, -1) : null
}

// The criteria getResourceIds takes: the student's "L…" identifier (Rennes),
// or, on ADE 6.12 (Sorbonne Nouvelle), their enrolment codes, listed right
// after the String class in the login's string table.
export function parsePlanningLoginIdentifiers(text) {
  const legacyIdentifier = parsePlanningIdentifier(text)
  if (legacyIdentifier) {
    return [legacyIdentifier]
  }

  const strings = extractPlanningStringArray(text)
  const start = strings.indexOf('java.lang.String/2004016611')
  const codes = []
  for (const value of start === -1 ? [] : strings.slice(start + 1)) {
    if (!/^[A-Z0-9{}:-]+$/.test(value)) {
      break
    }
    codes.push(value)
  }
  return codes
}

// The student's own ADE resources, from getResourceIds. The Rennes Planning
// (an "L…" identifier) has exactly one: a failed call, or no id in its
// answer, is an error as it always was, so a passing failure isn't kept as
// « no group » for the context's lifetime. ADE 6.12 (Sorbonne Nouvelle) may
// match none of the enrolment codes: [] then, the tree opens at its root
// and timetables need a chosen group.
export function readPlanningResourceIds(result, { v612 = false } = {}) {
  if (v612) {
    return result.ok ? parsePlanningIntegerList(result.text).filter(Number.isInteger) : []
  }

  if (!result.ok) {
    throw new Error(`Planning resource ids failed (${result.status}): ${result.text.slice(0, 240)}`)
  }

  const resourceId = parsePlanningFirstInteger(result.text)
  if (!Number.isInteger(resourceId)) {
    throw new Error(`Could not extract planning resource id: ${result.text.slice(0, 240)}`)
  }
  return [resourceId]
}

// An ArrayList<Integer> answer, which GWT writes backwards:
// [last, Integer type, …, first, Integer type, size, ArrayList type, [strings], …].
export function parsePlanningIntegerList(text) {
  const payload = evaluatePlanningRpcPayload(text)
  const numbers = payload.slice(0, payload.findIndex(Array.isArray))
  return numbers.slice(0, -2).filter((_, index) => index % 2 === 0).reverse()
}

function extractPlanningCalendarString(text) {
  const payload = evaluatePlanningRpcPayload(text)
  const stringArray = payload.find((value) => Array.isArray(value) && value.every((item) => typeof item === 'string'))
  return stringArray?.[0] ?? ''
}

function extractPlanningLegends(text) {
  const payload = evaluatePlanningRpcPayload(text)
  const strings = payload.find((value) => Array.isArray(value) && value.every((item) => typeof item === 'string')) ?? []
  const dayPattern = /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) \d{2}\/\d{2}\/\d{4}$/
  const timePattern = /^\d{2}h\d{2}$/

  return {
    weekLabel: strings.find((value) => /^S\d+ /.test(value)) ?? null,
    dayLabels: strings.filter((value) => dayPattern.test(value)),
    timeLabels: strings.filter((value) => timePattern.test(value)),
  }
}

function parseDateOnlyToUtcMs(dateString) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return Number.NaN
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatUtcDate(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10)
}

function extractPlanningWeekEntries(calendarString) {
  // Labels: "S12 01/12/2025 - 07/12/2025" (Rennes) or "01 décembre 2025" (ADE 6.12).
  const weekPattern = /\{"(-?\d+)""(\d{13})""(S\d+\s+\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}\/\d{2}\/\d{4}|\d{2} [^"\d]+ \d{4})""(true|false)"/g
  const weeksByIndex = new Map()
  let match

  while ((match = weekPattern.exec(calendarString)) !== null) {
    const index = Number(match[1])

    if (!weeksByIndex.has(index)) {
      weeksByIndex.set(index, {
        index,
        startUtcMs: Number(match[2]),
        label: match[3],
        current: match[4] === 'true',
      })
    }
  }

  return Array.from(weeksByIndex.values()).sort((left, right) => left.index - right.index)
}

function findPlanningWeekForDate(weeks, targetDate) {
  const targetUtcMs = parseDateOnlyToUtcMs(targetDate)
  if (!Number.isFinite(targetUtcMs)) {
    return null
  }

  return weeks.find((week) => targetUtcMs >= week.startUtcMs && targetUtcMs < week.startUtcMs + (7 * DAY_MS)) ?? null
}

function resolvePlanningWeekEntry(calendarString, targetDate) {
  const weeks = extractPlanningWeekEntries(calendarString)

  if (weeks.length === 0) {
    throw new Error('No planning weeks found in calendar response.')
  }

  const matchedWeek = targetDate ? findPlanningWeekForDate(weeks, targetDate) : null
  const fallbackWeek = weeks.find((week) => week.current) ?? weeks[0]

  return {
    weeks,
    week: matchedWeek ?? fallbackWeek,
    matchedTargetDate: Boolean(matchedWeek),
  }
}

function summarizePlanningWeek(week) {
  if (!week) {
    return null
  }

  const endUtcMs = week.startUtcMs + (6 * DAY_MS)

  return {
    index: week.index,
    label: week.label,
    current: week.current,
    startUtcMs: week.startUtcMs,
    endUtcMs,
    startDate: formatUtcDate(week.startUtcMs),
    endDate: formatUtcDate(endUtcMs),
  }
}

function buildPlanningLoginBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|8|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.MyPlanningClientServiceProxy|method1login|J|com.adesoft.gwt.core.client.rpc.data.LoginRequest/3705388826|com.adesoft.gwt.directplan.client.rpc.data.DirectLoginRequest/635437471||1|2|3|4|2|5|6|${clientId}|7|0|0|0|1|1|8|8|-1|0|0|`
}

function buildPlanningLoadProjectBody(moduleBase, clientId, serializationPolicy, projectId) {
  return `7|0|7|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.core.client.rpc.WebClientServiceProxy|method6loadProject|J|I|Z|1|2|3|4|3|5|6|7|${clientId}|${projectId}|0|`
}

function buildPlanningSavedPropertiesBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|6|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.core.client.rpc.WebClientServiceProxy|method26getSavedProperties|J|I|1|2|3|4|2|5|6|${clientId}|8|`
}

function buildPlanningResourceFieldsBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|5|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy|method3getResourceFields|J|1|2|3|4|1|5|${clientId}|`
}

function buildPlanningEventFieldsBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|5|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method2getEventFields|J|1|2|3|4|1|5|${clientId}|`
}

function buildPlanningDisplayConfigurationBody(moduleBase, clientId, serializationPolicy, displayConfigurationName) {
  return `7|0|8|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.core.client.rpc.ConfigurationServiceProxy|method28getDisplayConfigurationByName|J|java.lang.String/2004016611|Z|${displayConfigurationName}|1|2|3|4|3|5|6|7|${clientId}|8|0|`
}

function buildPlanningCalendarBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|8|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy|method2getCalendar|J|java.lang.String/2004016611|Etc/GMT-1|Etc/GMT-2|1|2|3|4|4|5|6|6|6|${clientId}|7|7|8|`
}

function buildPlanningSetSqlModeBody(moduleBase, clientId, serializationPolicy, calendarString) {
  return `7|0|8|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method1setSqlMode|J|Z|java.lang.String/2004016611|${calendarString}|1|2|3|4|3|5|6|7|${clientId}|0|8|`
}

function buildPlanningConnectedStudentBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|5|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.pac.client.rpc.PacServiceProxy|method2getConnectedStudent|J|1|2|3|4|1|5|${clientId}|`
}

function buildPlanningResourceIdsBody(moduleBase, clientId, serializationPolicy, identifiers) {
  const refs = identifiers.map((_, index) => `12|${13 + index}`).join('|')
  return `7|0|${12 + identifiers.length}|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy|method7getResourceIds|J|java.util.List|java.util.Map|Z|java.util.ArrayList/4159755760|java.util.HashMap/1797211028|com.adesoft.gwt.directplan.client.rpc.ResourceFieldCriteria/1324434193|java.lang.String/2004016611|${identifiers.join('|')}|1|2|3|4|4|5|6|7|8|${clientId}|9|0|10|1|11|1|9|${identifiers.length}|${refs}|0|`
}

// ADE 6.12 (Sorbonne Nouvelle): getLegends/getTimetable renumbered, with an
// extra list argument, over every resource of the student at once.
function buildPlanningLegendsBodyV612(moduleBase, clientId, serializationPolicy, displayConfigurationId, resourceIds, weekIndex) {
  const resources = resourceIds.map((id) => `10|${id}`).join('|')
  return `7|0|14|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method6getLegends|J|com.adesoft.gwt.core.client.rpc.data.planning.PlanningSelection/927838067|com.extjs.gxt.ui.client.data.SortInfo/1143517771|java.util.List|java.util.ArrayList/4159755760|java.lang.Integer/3438268394|Cumul|Déplacement|com.extjs.gxt.ui.client.Style$SortDir/3873584144|NAME|1|2|3|4|4|5|6|7|8|${clientId}|6|9|7|10|0|10|1|10|2|10|3|10|4|10|5|10|6|${displayConfigurationId}|11|12|0|0|9|${resourceIds.length}|${resources}|9|1|10|${weekIndex}|7|13|1|14|9|0|`
}

function buildPlanningTimetableBodyV612(moduleBase, clientId, serializationPolicy, displayConfigurationId, resourceIds, weekIndex) {
  const resources = resourceIds.map((id) => `11|${id}`).join('|')
  return `7|0|13|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method10getTimetable|J|com.adesoft.gwt.core.client.rpc.data.planning.PlanningSelection/927838067|I|Z|java.util.List|java.util.ArrayList/4159755760|java.lang.Integer/3438268394|Cumul|Déplacement|1|2|3|4|7|5|6|7|7|8|9|9|${clientId}|6|10|7|11|0|11|1|11|2|11|3|11|4|11|5|11|6|${displayConfigurationId}|12|13|0|0|10|${resourceIds.length}|${resources}|10|1|11|${weekIndex}|770|627|1|10|0|10|0|`
}

function buildPlanningLegendsBody(moduleBase, clientId, serializationPolicy, displayConfigurationId, resourceId, weekIndex) {
  return `7|0|13|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method5getLegends|J|com.adesoft.gwt.core.client.rpc.data.planning.PlanningSelection/927838067|com.extjs.gxt.ui.client.data.SortInfo/1143517771|java.util.ArrayList/4159755760|java.lang.Integer/3438268394|Cumul|Déplacement|com.extjs.gxt.ui.client.Style$SortDir/3873584144|NAME|1|2|3|4|3|5|6|7|${clientId}|6|8|7|9|0|9|1|9|2|9|3|9|4|9|5|9|6|${displayConfigurationId}|10|11|0|0|8|1|9|${resourceId}|8|1|9|${weekIndex}|7|12|1|13|`
}

function buildPlanningTimetableBody(moduleBase, clientId, serializationPolicy, displayConfigurationId, resourceId, weekIndex) {
  return `7|0|13|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningPlanningServiceProxy|method8getTimetable|J|com.adesoft.gwt.core.client.rpc.data.planning.PlanningSelection/927838067|I|Z|java.util.List|java.util.ArrayList/4159755760|java.lang.Integer/3438268394|Cumul|Déplacement|1|2|3|4|6|5|6|7|7|8|9|${clientId}|6|10|7|11|0|11|1|11|2|11|3|11|4|11|5|11|6|${displayConfigurationId}|12|13|0|0|10|1|11|${resourceId}|10|1|11|${weekIndex}|430|344|1|10|0|`
}

function buildPlanningTreeRootBody(moduleBase, clientId, serializationPolicy) {
  return `7|0|20|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy|method4getChildren|J|java.lang.String/2004016611|com.adesoft.gwt.directplan.client.ui.tree.TreeResourceConfig/2234901663|${PLANNING_TREE_ROOT_CONFIG}|[I/2970817851|java.util.LinkedHashMap/3008245022|COLOR|com.adesoft.gwt.core.client.rpc.config.OutputField/870745015|LabelColor||com.adesoft.gwt.core.client.rpc.config.FieldType/1797283245|NAME|LabelName|java.util.ArrayList/4159755760|com.extjs.gxt.ui.client.data.SortInfo/1143517771|com.extjs.gxt.ui.client.Style$SortDir/3873584144|1|2|3|4|3|5|6|7|${clientId}|8|7|0|9|2|0|149|10|0|2|6|11|12|0|13|11|14|15|11|0|0|6|16|12|0|17|16|14|15|4|0|0|18|0|18|0|19|20|1|16|18|0|`
}

function buildPlanningTreeChildrenBody(moduleBase, clientId, serializationPolicy, nodeConfig) {
  return `7|0|20|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy|method4getChildren|J|java.lang.String/2004016611|com.adesoft.gwt.directplan.client.ui.tree.TreeResourceConfig/2234901663|${nodeConfig}|[I/2970817851|java.util.LinkedHashMap/3008245022|COLOR|com.adesoft.gwt.core.client.rpc.config.OutputField/870745015|LabelColor||com.adesoft.gwt.core.client.rpc.config.FieldType/1797283245|NAME|LabelName|java.util.ArrayList/4159755760|com.extjs.gxt.ui.client.data.SortInfo/1143517771|com.extjs.gxt.ui.client.Style$SortDir/3873584144|1|2|3|4|3|5|6|7|${clientId}|8|7|0|9|2|-1|-1|10|0|2|6|11|12|0|13|11|14|15|11|0|0|6|16|12|0|17|16|14|15|4|0|0|18|0|18|0|19|20|1|16|18|0|`
}

function buildPlanningSearchDataByIdBody(moduleBase, clientId, serializationPolicy, resourceId) {
  return `7|0|9|${moduleBase}|${serializationPolicy}|com.adesoft.gwt.core.client.rpc.ConfigurationServiceProxy|method25searchDataById|J|com.adesoft.gwt.core.client.rpc.config.FilterType/1396315430|java.util.List|java.util.ArrayList/4159755760|java.lang.Integer/3438268394|1|2|3|4|3|5|6|7|${clientId}|6|3|8|1|9|${resourceId}|`
}

function parseLegendDateLabel(label) {
  const match = label.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) {
    return null
  }

  return `${match[3]}-${match[2]}-${match[1]}`
}

function parsePlanningTimeRange(label) {
  const match = label.match(/^(\d{2})h(\d{2}) - (\d{2})h(\d{2})$/)
  if (!match) {
    return null
  }

  return {
    start: `${match[1]}:${match[2]}`,
    end: `${match[3]}:${match[4]}`,
  }
}

function extractPlanningTimetableEvents(text, dayLabels) {
  const payload = evaluatePlanningRpcPayload(text)
  const stringTable = payload.find((value) => Array.isArray(value) && value.every((item) => typeof item === 'string')) ?? []
  const stringTableIndex = payload.indexOf(stringTable)
  const numbers = payload.slice(0, stringTableIndex)
  const rawEvents = []

  function collectEvent(textStartIndex, geometryIndex) {
    const refs = []
    let cursor = textStartIndex

    while (cursor + 1 < numbers.length) {
      const ref = numbers[cursor]
      if (!(Number.isInteger(ref) && ref >= 7 && ref <= stringTable.length && numbers[cursor + 1] === 11)) {
        break
      }

      refs.push(ref)
      cursor += 2

      if (numbers[cursor] === 0) {
        cursor += 1
      }
    }

    if (refs.length < 6) {
      return null
    }

    return {
      x: numbers[geometryIndex],
      y: numbers[geometryIndex + 1],
      width: numbers[geometryIndex + 2],
      height: numbers[geometryIndex + 3],
      refs,
      nextCursor: cursor,
    }
  }

  if (
    numbers.length > 16
    && numbers[4] === 0
    && numbers[5] === 7
    && numbers[6] === 7
    && numbers[7] === 7
    && numbers[8] === 0
  ) {
    const firstEvent = collectEvent(9, 0)
    if (firstEvent) {
      rawEvents.push(firstEvent)
    }
  }

  for (let index = 10; index < numbers.length - 30; index += 1) {
    if (numbers[index - 10] !== 2) {
      continue
    }

    if (!(numbers[index - 5] === 0 && numbers[index - 4] === 7 && numbers[index - 3] === 7 && numbers[index - 2] === 7 && numbers[index - 1] === 0)) {
      continue
    }

    const event = collectEvent(index, index - 9)
    if (!event) {
      continue
    }

    rawEvents.push(event)
    index = event.nextCursor
  }

  const uniqueBandStarts = []
  for (const y of [...new Set(rawEvents.map((event) => event.y))].sort((left, right) => left - right)) {
    if (uniqueBandStarts.length === 0 || y - uniqueBandStarts[uniqueBandStarts.length - 1] > 50) {
      uniqueBandStarts.push(y)
    }
  }

  return rawEvents.map((event) => {
    const texts = event.refs.map((ref) => stringTable[ref - 1])
    const timeIndex = texts.findIndex((value) => /^\d{2}h\d{2} - \d{2}h\d{2}$/.test(value))
    const groups = timeIndex === -1 ? [] : texts.slice(0, timeIndex).filter(Boolean)
    const tail = timeIndex === -1 ? [] : texts.slice(timeIndex + 1)
    const nonEmptyTail = tail.filter(Boolean)
    const title = nonEmptyTail[nonEmptyTail.length - 1] ?? ''
    const room = tail.find((value) => value && value !== title) ?? ''
    const teacher = tail.slice(1).find((value) => value && value !== title) ?? ''
    const dayIndex = Math.max(0, uniqueBandStarts.findLastIndex((bandStart) => event.y >= bandStart))
    const dayLabel = dayLabels[dayIndex] ?? null
    const dayDate = dayLabel ? parseLegendDateLabel(dayLabel) : null
    const timeRange = timeIndex === -1 ? null : parsePlanningTimeRange(texts[timeIndex])

    return {
      title,
      teacher,
      location: room,
      groups,
      dayIndex,
      dayLabel,
      date: dayDate,
      timeLabel: timeIndex === -1 ? null : texts[timeIndex],
      start: dayDate && timeRange ? `${dayDate}T${timeRange.start}:00` : null,
      end: dayDate && timeRange ? `${dayDate}T${timeRange.end}:00` : null,
      lane: event.y - uniqueBandStarts[dayIndex],
      layout: {
        x: event.x,
        y: event.y,
        width: event.width,
        height: event.height,
      },
    }
  }).sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) {
      return left.dayIndex - right.dayIndex
    }

    if ((left.start ?? '') !== (right.start ?? '')) {
      return (left.start ?? '').localeCompare(right.start ?? '')
    }

    if (left.lane !== right.lane) {
      return left.lane - right.lane
    }

    return left.title.localeCompare(right.title)
  })
}

// ADE 6.12 (Sorbonne Nouvelle) draws the week transposed: one row per day,
// `width` pixels high. Each SquareEvent is written
// [x, y, width, height, 0, three String refs, …its text list…, size, ArrayList],
// the list being [title, null, teacher?, null, room, null, time] read backwards.
// shortcut: layout checked on a single capture; if a Planning shows
// columns-per-day, derive the day from x instead.
export function extractPlanningTimetableEventsV612(text, dayLabels) {
  const payload = evaluatePlanningRpcPayload(text)
  const stringIndex = payload.findIndex(Array.isArray)
  const strings = payload[stringIndex] ?? []
  const numbers = payload.slice(0, stringIndex)
  const stringType = strings.indexOf('java.lang.String/2004016611') + 1
  const listType = strings.indexOf('java.util.ArrayList/4159755760') + 1
  const events = []

  for (let marker = 1; marker < numbers.length - 1; marker += 1) {
    if (numbers[marker + 1] !== listType || !(numbers[marker] > 0)) {
      continue
    }

    const texts = []
    let cursor = marker - 1
    while (texts.length < numbers[marker] && cursor >= 1) {
      if (numbers[cursor] === stringType) {
        texts.push(strings[numbers[cursor - 1] - 1] ?? '')
        cursor -= 2
      } else if (numbers[cursor] === 0) {
        texts.push(null)
        cursor -= 1
      } else {
        break
      }
    }

    const values = texts.filter(Boolean)
    const timeIndex = values.findLastIndex((value) => /^\d{2}h\d{2} - \d{2}h\d{2}$/.test(value))
    if (texts.length !== numbers[marker] || timeIndex < 2 || cursor < 7) {
      continue
    }

    const [x, y, width, height] = numbers.slice(cursor - 7, cursor - 3)
    const dayIndex = width > 0 ? Math.round(y / width) : 0
    const dayLabel = dayLabels[dayIndex] ?? null
    const dayDate = dayLabel ? parseLegendDateLabel(dayLabel) : null
    const timeRange = parsePlanningTimeRange(values[timeIndex])

    events.push({
      title: values[0],
      teacher: values.slice(1, timeIndex - 1).join(', '),
      location: values[timeIndex - 1],
      groups: [],
      dayIndex,
      dayLabel,
      date: dayDate,
      timeLabel: values[timeIndex],
      start: dayDate && timeRange ? `${dayDate}T${timeRange.start}:00` : null,
      end: dayDate && timeRange ? `${dayDate}T${timeRange.end}:00` : null,
      lane: 0,
      layout: { x, y, width, height },
    })
  }

  return events.sort((left, right) => (left.start ?? '').localeCompare(right.start ?? '') || left.title.localeCompare(right.title))
}

function extractPlanningStringArray(text) {
  const payload = evaluatePlanningRpcPayload(text)
  return payload.find((value) => Array.isArray(value) && value.every((item) => typeof item === 'string')) ?? []
}

function extractPlanningTreeString(text) {
  const strings = extractPlanningStringArray(text)
  return strings.find((value) => value.startsWith('{"0"{')) ?? strings[0] ?? ''
}

function parsePlanningTreeString(treeString) {
  if (!treeString) {
    throw new Error('Planning tree payload is empty.')
  }

  let index = 0

  function currentChar() {
    return treeString[index] ?? ''
  }

  function preview() {
    return treeString.slice(Math.max(0, index - 40), Math.min(treeString.length, index + 120))
  }

  function expect(char) {
    if (treeString[index] !== char) {
      throw new Error(`Unexpected planning tree token at index ${index}: expected "${char}", got "${treeString[index] ?? 'EOF'}" near "${preview()}"`)
    }

    index += 1
  }

  function readQuotedString() {
    expect('"')
    const start = index

    while (index < treeString.length && treeString[index] !== '"') {
      index += 1
    }

    if (index >= treeString.length) {
      throw new Error(`Unterminated planning tree string near "${preview()}"`)
    }

    const value = treeString.slice(start, index)
    index += 1
    return value
  }

  function readArrayCount() {
    expect('[')
    const start = index

    while (index < treeString.length && treeString[index] !== ']') {
      index += 1
    }

    if (index >= treeString.length) {
      throw new Error(`Unterminated planning tree array near "${preview()}"`)
    }

    const count = Number(treeString.slice(start, index))
    index += 1

    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid planning tree array count "${treeString.slice(start, index - 1)}"`)
    }

    return count
  }

  function readLooseArray() {
    const count = readArrayCount()
    const items = []

    for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
      if (currentChar() === '"') {
        items.push(readQuotedString())
        continue
      }

      if (currentChar() === '[') {
        items.push(readLooseArray())
        continue
      }

      throw new Error(`Unsupported planning tree array token "${currentChar()}" near "${preview()}"`)
    }

    return items
  }

  function parseField() {
    expect('{')
    return {
      type: readQuotedString(),
      key: readQuotedString(),
      label: readQuotedString(),
      value: readQuotedString(),
      flag1: readQuotedString(),
      flag2: readQuotedString(),
    }
  }

  function readFieldArray() {
    const count = readArrayCount()
    const fields = []

    for (let fieldIndex = 0; fieldIndex < count; fieldIndex += 1) {
      fields.push(parseField())
    }

    return fields
  }

  function parseNode() {
    const nodeStart = index
    expect('{')

    const id = readQuotedString()
    const visible = readQuotedString()
    const depth = readQuotedString()
    const childHint = readQuotedString()
    const leftIndex = readQuotedString()
    const rightIndex = readQuotedString()
    const selectionMode = readQuotedString()
    const collapsed = readQuotedString()
    const fields = readFieldArray()
    const fullPath = readQuotedString()
    const family = readQuotedString()
    const familyIndex = readQuotedString()
    const tailFlag = readQuotedString()
    const selectedIds = readLooseArray()
    const hiddenIds = readLooseArray()
    const configString = treeString.slice(nodeStart, index)

    let children = []
    let trailingFlag = null

    if (currentChar() === '[') {
      const count = readArrayCount()
      children = []

      for (let childIndex = 0; childIndex < count; childIndex += 1) {
        children.push(parseNode())
      }
    }

    if (currentChar() === '"') {
      trailingFlag = readQuotedString()
    }

    return {
      id,
      visible: visible === 'true',
      depth: Number(depth),
      childHint: Number(childHint),
      leftIndex: Number(leftIndex),
      rightIndex: Number(rightIndex),
      selectionMode: Number(selectionMode),
      collapsed: collapsed === 'true',
      fields,
      fullPath,
      family,
      familyIndex: Number(familyIndex),
      tailFlag,
      selectedIds,
      hiddenIds,
      children,
      trailingFlag,
      configString,
    }
  }

  if (treeString.startsWith('{"0"{')) {
    expect('{')
    readQuotedString()
    return parseNode()
  }

  return parseNode()
}

function parsePlanningTreeResponse(text) {
  return parsePlanningTreeString(extractPlanningTreeString(text))
}

function resolvePlanningTreeLabel(node) {
  const nameField = node.fields.find((field) => field.key === 'NAME')?.value?.trim()

  if (nameField && !/^type\.Category\d+$/i.test(nameField)) {
    return nameField
  }

  if (node.fullPath?.trim()) {
    const segments = node.fullPath.split('.').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length > 0) {
      return segments[segments.length - 1]
    }
  }

  const fallbackLabels = {
    '-1': 'Etudiants',
    '-2': 'Enseignants',
    '-3': 'Salles',
    '-4': 'Equipements',
    '-5': 'Categorie 5',
    '-6': 'Categorie 6',
    '-100': 'Ressources',
  }

  return fallbackLabels[node.id] ?? nameField ?? node.fullPath ?? node.id
}

function normalizePlanningTreeNode(node) {
  const colorField = node.fields.find((field) => field.key === 'COLOR')?.value ?? null
  const path = node.fullPath?.trim() || resolvePlanningTreeLabel(node)

  return {
    id: node.id,
    name: resolvePlanningTreeLabel(node),
    path,
    family: node.family || null,
    depth: Number.isFinite(node.depth) ? node.depth : null,
    color: colorField,
    childrenLoaded: node.children.length > 0,
    config: node.configString,
    children: node.children.map(normalizePlanningTreeNode),
  }
}

function mergePlanningTreeNodes(baseNode, overrideNode) {
  if (!baseNode || baseNode.id !== overrideNode.id) {
    return overrideNode
  }

  const overrideChildrenById = new Map(overrideNode.children.map((child) => [child.id, child]))
  const mergedChildren = []

  for (const child of baseNode.children) {
    const overrideChild = overrideChildrenById.get(child.id)
    if (overrideChild) {
      mergedChildren.push(mergePlanningTreeNodes(child, overrideChild))
      overrideChildrenById.delete(child.id)
    } else {
      mergedChildren.push(child)
    }
  }

  for (const overrideChild of overrideChildrenById.values()) {
    mergedChildren.push(overrideChild)
  }

  return {
    ...baseNode,
    ...overrideNode,
    fields: overrideNode.fields.length > 0 ? overrideNode.fields : baseNode.fields,
    fullPath: overrideNode.fullPath || baseNode.fullPath,
    family: overrideNode.family || baseNode.family,
    configString: overrideNode.configString || baseNode.configString,
    children: mergedChildren,
  }
}

function replacePlanningTreeNode(rootNode, replacementNode) {
  if (rootNode.id === replacementNode.id) {
    return mergePlanningTreeNodes(rootNode, replacementNode)
  }

  if (rootNode.children.length === 0) {
    return rootNode
  }

  return {
    ...rootNode,
    children: rootNode.children.map((child) => replacePlanningTreeNode(child, replacementNode)),
  }
}

function parseAdeTreeResourceId(rawValue) {
  const matches = String(rawValue ?? '').match(/-?\d+/g)
  if (!matches || matches.length === 0) {
    return null
  }

  const parsedValue = Number(matches[matches.length - 1])
  return Number.isInteger(parsedValue) ? parsedValue : null
}

function extractPlanningTreePathIds(text) {
  const treeString = extractPlanningTreeString(text)
  if (!treeString) {
    return []
  }

  let index = 0

  function currentChar() {
    return treeString[index] ?? ''
  }

  function expect(char) {
    if (treeString[index] !== char) {
      throw new Error(`Unexpected planning path token at index ${index}: expected "${char}", got "${treeString[index] ?? 'EOF'}"`)
    }

    index += 1
  }

  function readQuotedString() {
    expect('"')
    const start = index

    while (index < treeString.length && treeString[index] !== '"') {
      index += 1
    }

    if (index >= treeString.length) {
      throw new Error('Unterminated planning path string.')
    }

    const value = treeString.slice(start, index)
    index += 1
    return value
  }

  function readArrayCount() {
    expect('[')
    const start = index

    while (index < treeString.length && treeString[index] !== ']') {
      index += 1
    }

    if (index >= treeString.length) {
      throw new Error('Unterminated planning path array.')
    }

    const count = Number(treeString.slice(start, index))
    index += 1
    return count
  }

  function skipField() {
    expect('{')
    for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) {
      readQuotedString()
    }
  }

  function skipLooseArray() {
    const count = readArrayCount()

    for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
      if (currentChar() === '"') {
        readQuotedString()
      } else if (currentChar() === '[') {
        skipLooseArray()
      } else {
        throw new Error(`Unsupported planning path array token "${currentChar()}" at index ${index}`)
      }
    }
  }

  function parsePathNode() {
    expect('{')
    const id = readQuotedString()

    for (let stringIndex = 0; stringIndex < 7; stringIndex += 1) {
      readQuotedString()
    }

    const fieldCount = readArrayCount()
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      skipField()
    }

    readQuotedString()
    const ids = [id]

    if (currentChar() === '[') {
      const firstArrayCount = readArrayCount()
      if (firstArrayCount > 0 && currentChar() === '{') {
        for (let childIndex = 0; childIndex < firstArrayCount; childIndex += 1) {
          ids.push(...parsePathNode())
        }
        return ids
      }

      if (firstArrayCount > 0) {
        for (let itemIndex = 0; itemIndex < firstArrayCount; itemIndex += 1) {
          if (currentChar() === '"') {
            readQuotedString()
          } else if (currentChar() === '[') {
            skipLooseArray()
          } else {
            throw new Error(`Unsupported planning path array token "${currentChar()}" at index ${index}`)
          }
        }
      }

      if (currentChar() === '[') {
        const childCount = readArrayCount()
        for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
          ids.push(...parsePathNode())
        }
      }
    }

    return ids
  }

  return parsePathNode()
}

function findPlanningTreeNodeById(node, targetId) {
  if (!node) {
    return null
  }

  if (String(node.id) === String(targetId)) {
    return node
  }

  for (const child of node.children ?? []) {
    const match = findPlanningTreeNodeById(child, targetId)
    if (match) {
      return match
    }
  }

  return null
}

export function createPlanningRpcClient({
  casOrigin,
  fetchWithJar,
  followRedirectChain,
  planningOrigin,
  gwtClientId,
  projectId = 1,
  displayConfigurationName = 'web-default',
}) {
  if (typeof casOrigin !== 'string' || !casOrigin) {
    throw new TypeError('createPlanningRpcClient requires a casOrigin string.')
  }

  if (typeof fetchWithJar !== 'function' || typeof followRedirectChain !== 'function') {
    throw new TypeError('createPlanningRpcClient requires fetchWithJar and followRedirectChain functions.')
  }

  const serviceUrl = `${planningOrigin}/direct/myplanning.jsp`
  const moduleBase = `${planningOrigin}/direct/gwtdirectplanning/`
  const bootstrapUrl = `${moduleBase}gwtdirectplanning.nocache.js`

  const contextCache = createPlanningCacheStore(PLANNING_CACHE_LIMITS.context)
  const treeCache = createPlanningCacheStore(PLANNING_CACHE_LIMITS.tree)
  const timetableCache = createPlanningCacheStore(PLANNING_CACHE_LIMITS.timetable)
  let planningMetadataPromise = null

  async function getPlanningRpcMetadata(jar) {
    if (planningMetadataPromise) {
      return planningMetadataPromise
    }

    planningMetadataPromise = (async () => {
      const response = await fetchWithJar(bootstrapUrl, jar, {
        headers: {
          Accept: 'application/javascript,text/javascript,*/*;q=0.9',
        },
        redirect: 'follow',
      })
      const scriptText = await response.text()

      if (!response.ok) {
        throw new Error(`Planning bootstrap failed (${response.status}).`)
      }

      const permutations = extractPlanningPermutationsFromBootstrap(scriptText)
      const selectedPermutation = permutations.myPlanning ?? PLANNING_GWT_FALLBACK_HASH
      let serializationPolicies = PLANNING_GWT_FALLBACK_SERIALIZATION_POLICIES
      let v612 = false

      try {
        const cacheResponse = await fetchWithJar(`${moduleBase}${selectedPermutation}.cache.html`, jar, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
          },
          redirect: 'follow',
        })
        const cacheText = await cacheResponse.text()

        if (cacheResponse.ok) {
          serializationPolicies = extractPlanningSerializationPoliciesFromCache(cacheText)
          v612 = cacheText.includes('method10getTimetable')
        }
      } catch {
        serializationPolicies = PLANNING_GWT_FALLBACK_SERIALIZATION_POLICIES
      }

      return {
        permutations,
        serializationPolicies,
        v612,
      }
    })()

    try {
      return await planningMetadataPromise
    } catch {
      planningMetadataPromise = null
      return {
        permutations: PLANNING_GWT_FALLBACK_PERMUTATIONS,
        serializationPolicies: PLANNING_GWT_FALLBACK_SERIALIZATION_POLICIES,
      }
    }
  }

  async function postPlanningRpc(jar, serviceName, permutation, body) {
    const response = await fetchWithJar(`${moduleBase}${serviceName}`, jar, {
      method: 'POST',
      headers: buildPlanningRpcHeaders(moduleBase, permutation),
      body,
      redirect: 'follow',
    })

    const text = await response.text()

    return {
      ok: response.ok && text.startsWith('//OK'),
      status: response.status,
      text,
    }
  }

  function ensurePlanningRpcOk(result, label) {
    if (result.ok) {
      return
    }

    throw new Error(`${label} failed (${result.status}): ${result.text.slice(0, 240)}`)
  }

  async function initializePlanningRpcContext(jar) {
    const clientId = gwtClientId
    const acceptHeader = 'text/html,application/xhtml+xml,*/*'
    const casLoginUrl = `${casOrigin}/login?service=${encodeURIComponent(serviceUrl)}`
    const casResult = await followRedirectChain(casLoginUrl, jar, {
      headers: { Accept: acceptHeader },
    })
    await casResult.response.text()

    // ADE 2026 protects the GWT bootstrap as well as the RPC endpoints. Fetch
    // its live permutation and serialization policies only after CAS has
    // established the /direct session; otherwise the response is the CAS
    // login page and the client silently falls back to obsolete hashes.
    const {
      permutations,
      serializationPolicies,
      v612 = false,
    } = await getPlanningRpcMetadata(jar)

    const loginResult = await postPlanningRpc(jar, 'MyPlanningClientServiceProxy', permutations.myPlanning, buildPlanningLoginBody(moduleBase, clientId, serializationPolicies.myPlanning))
    ensurePlanningRpcOk(loginResult, 'Planning login')

    const planningIdentifiers = parsePlanningLoginIdentifiers(loginResult.text)
    const planningIdentifier = planningIdentifiers[0] ?? null
    if (!planningIdentifier) {
      throw new Error(`Could not extract planning identifier from login response: ${loginResult.text.slice(0, 240)}`)
    }

    const loadProjectResult = await postPlanningRpc(jar, 'WebClientServiceProxy', permutations.webClient, buildPlanningLoadProjectBody(moduleBase, clientId, serializationPolicies.webClient, projectId))
    ensurePlanningRpcOk(loadProjectResult, 'Planning project load')

    const savedPropertiesResult = await postPlanningRpc(jar, 'WebClientServiceProxy', permutations.webClient, buildPlanningSavedPropertiesBody(moduleBase, clientId, serializationPolicies.webClient))
    ensurePlanningRpcOk(savedPropertiesResult, 'Planning saved properties')

    const resourceFieldsResult = await postPlanningRpc(jar, 'DirectPlanningServiceProxy', permutations.directPlanning, buildPlanningResourceFieldsBody(moduleBase, clientId, serializationPolicies.directPlanning))
    ensurePlanningRpcOk(resourceFieldsResult, 'Planning resource fields')

    const eventFieldsResult = await postPlanningRpc(jar, 'DirectPlanningPlanningServiceProxy', permutations.directPlanningPlanning, buildPlanningEventFieldsBody(moduleBase, clientId, serializationPolicies.directPlanningPlanning))
    ensurePlanningRpcOk(eventFieldsResult, 'Planning event fields')

    const displayConfigurationResult = await postPlanningRpc(jar, 'ConfigurationServiceProxy', permutations.configuration, buildPlanningDisplayConfigurationBody(moduleBase, clientId, serializationPolicies.configuration, displayConfigurationName))
    ensurePlanningRpcOk(displayConfigurationResult, 'Planning display configuration')

    const displayConfigurationId = parsePlanningFirstInteger(displayConfigurationResult.text)
    if (!Number.isInteger(displayConfigurationId)) {
      throw new Error(`Could not extract planning display configuration id: ${displayConfigurationResult.text.slice(0, 240)}`)
    }

    // Called as the web client does; its answer is unused, and a Planning
    // without the PAC module (Sorbonne Nouvelle) fails it harmlessly.
    await postPlanningRpc(jar, 'PacServiceProxy', permutations.pac, buildPlanningConnectedStudentBody(moduleBase, clientId, serializationPolicies.pac))

    const calendarResult = await postPlanningRpc(jar, 'DirectPlanningServiceProxy', permutations.directPlanning, buildPlanningCalendarBody(moduleBase, clientId, serializationPolicies.directPlanning))
    ensurePlanningRpcOk(calendarResult, 'Planning calendar')

    const calendarString = extractPlanningCalendarString(calendarResult.text)
    if (!calendarString) {
      throw new Error('Could not extract planning calendar data.')
    }

    const sqlModeResult = await postPlanningRpc(jar, 'DirectPlanningPlanningServiceProxy', permutations.directPlanningPlanning, buildPlanningSetSqlModeBody(moduleBase, clientId, serializationPolicies.directPlanningPlanning, calendarString))
    ensurePlanningRpcOk(sqlModeResult, 'Planning SQL mode')

    // The student's own ADE resources, found by their identifier (Rennes: one)
    // or enrolment codes (Sorbonne Nouvelle: one per group, maybe none):
    // readPlanningResourceIds.
    const resourceIdsResult = await postPlanningRpc(jar, 'DirectPlanningServiceProxy', permutations.directPlanning, buildPlanningResourceIdsBody(moduleBase, clientId, serializationPolicies.directPlanning, planningIdentifiers))
    const resourceIds = readPlanningResourceIds(resourceIdsResult, { v612 })
    const resourceId = resourceIds[0] ?? null

    return {
      clientId,
      v612,
      resourceId,
      resourceIds,
      planningIdentifier,
      displayConfigurationId,
      calendarString,
      finalUrl: casResult.finalUrl,
      permutations,
      serializationPolicies,
    }
  }

  async function getPlanningContext(jar, options = {}) {
    const cacheScope = normalizePlanningCacheScope(options.cacheScope)
    const cachePolicy = {
      ttlMs: CONTEXT_CACHE_TTL_MS,
      staleMs: CONTEXT_CACHE_STALE_MS,
    }

    return readThroughPlanningCache({
      bucket: 'context',
      cacheScope,
      cacheStore: contextCache,
      cacheKey: cacheScope,
      policy: cachePolicy,
      loadValue: () => initializePlanningRpcContext(jar),
      allowStaleWhileRevalidate: false,
    })
  }

  async function withPlanningContextRetry(jar, options, loadWithContext) {
    const cacheScope = normalizePlanningCacheScope(options.cacheScope)
    let context = await getPlanningContext(jar, options)

    try {
      const value = await loadWithContext(context)
      return { value, context }
    } catch (error) {
      if (!isPlanningInvalidIdentifierError(error)) {
        throw error
      }

      deletePlanningCacheEntry(contextCache, cacheScope)
      context = await getPlanningContext(jar, { ...options, cacheScope })
      const value = await loadWithContext(context)
      return { value, context }
    }
  }

  async function fetchPlanningTimetableFromRpc(jar, targetDate, rawTargetResourceId = null, options = {}) {
    const cacheScope = normalizePlanningCacheScope(options.cacheScope)
    const { value: timetable, context } = await withPlanningContextRetry(jar, options, async (context) => {
      const requestedResourceId = parseAdeTreeResourceId(rawTargetResourceId)
      const resourceId = Number.isInteger(requestedResourceId) ? requestedResourceId : context.resourceId
      if (!Number.isInteger(resourceId)) {
        throw new Error('No planning resource: choose a group in the planning tree.')
      }
      const resourceIds = Number.isInteger(requestedResourceId) ? [requestedResourceId] : (context.resourceIds ?? [resourceId])
      const weekResolution = resolvePlanningWeekEntry(context.calendarString, targetDate)
      const resolvedWeek = summarizePlanningWeek(weekResolution.week)
      const planningSelectionWeekIndex = Math.max(0, weekResolution.week.index - 1)
      const cachePolicy = buildPlanningTimetablePolicy(resolvedWeek)
      const cacheKey = cacheScope ? `${cacheScope}:${resourceIds.join(',')}:${resolvedWeek?.startDate ?? planningSelectionWeekIndex}` : null
      const legendsBody = context.v612
        ? buildPlanningLegendsBodyV612(moduleBase, context.clientId, context.serializationPolicies.directPlanningPlanning, context.displayConfigurationId, resourceIds, planningSelectionWeekIndex)
        : buildPlanningLegendsBody(moduleBase, context.clientId, context.serializationPolicies.directPlanningPlanning, context.displayConfigurationId, resourceId, planningSelectionWeekIndex)
      const timetableBody = context.v612
        ? buildPlanningTimetableBodyV612(moduleBase, context.clientId, context.serializationPolicies.directPlanningPlanning, context.displayConfigurationId, resourceIds, planningSelectionWeekIndex)
        : buildPlanningTimetableBody(moduleBase, context.clientId, context.serializationPolicies.directPlanningPlanning, context.displayConfigurationId, resourceId, planningSelectionWeekIndex)

      return readThroughPlanningCache({
        bucket: 'timetable',
        cacheScope,
        cacheStore: timetableCache,
        cacheKey,
        policy: cachePolicy,
        loadValue: async () => {
          const legendsResult = await postPlanningRpc(jar, 'DirectPlanningPlanningServiceProxy', context.permutations.directPlanningPlanning, legendsBody)
          ensurePlanningRpcOk(legendsResult, 'Planning legends')

          const legends = extractPlanningLegends(legendsResult.text)

          const timetableResult = await postPlanningRpc(jar, 'DirectPlanningPlanningServiceProxy', context.permutations.directPlanningPlanning, timetableBody)
          ensurePlanningRpcOk(timetableResult, 'Planning timetable')

          const events = context.v612
            ? extractPlanningTimetableEventsV612(timetableResult.text, legends.dayLabels)
            : extractPlanningTimetableEvents(timetableResult.text, legends.dayLabels)

          return {
            events,
            weekLabel: legends.weekLabel ?? weekResolution.week.label,
            dayLabels: legends.dayLabels,
            resourceId,
            currentResourceId: context.resourceId,
            planningIdentifier: context.planningIdentifier,
            displayConfigurationId: context.displayConfigurationId,
            weekIndex: planningSelectionWeekIndex,
            calendarWeekIndex: weekResolution.week.index,
            requestedDate: targetDate,
            requestedDateMatched: weekResolution.matchedTargetDate,
            outOfRange: !weekResolution.matchedTargetDate,
            resolvedWeek,
            finalUrl: context.finalUrl,
          }
        },
        allowStaleWhileRevalidate: true,
      })
    })

    timetable.cache.context = context.cache
    return timetable
  }

  async function fetchPlanningTreeFromRpc(jar, rawTargetResourceId, options = {}) {
    const cacheScope = normalizePlanningCacheScope(options.cacheScope)
    const cachePolicy = {
      ttlMs: TREE_CACHE_TTL_MS,
      staleMs: TREE_CACHE_STALE_MS,
    }
    const { value: tree, context } = await withPlanningContextRetry(jar, options, async (context) => {
      const explicitTargetResourceId = parseAdeTreeResourceId(rawTargetResourceId)
      const focusResourceId = Number.isInteger(explicitTargetResourceId) ? explicitTargetResourceId : context.resourceId
      const treeVariant = explicitTargetResourceId === null
        ? 'implicit-current-path'
        : `explicit:${explicitTargetResourceId}`
      const cacheKey = cacheScope ? `${cacheScope}:${treeVariant}:${focusResourceId}` : null

      return readThroughPlanningCache({
        bucket: 'tree',
        cacheScope,
        cacheStore: treeCache,
        cacheKey,
        policy: cachePolicy,
        loadValue: async () => {
          const rootTreeResult = await postPlanningRpc(jar, 'DirectPlanningServiceProxy', context.permutations.directPlanning, buildPlanningTreeRootBody(moduleBase, context.clientId, context.serializationPolicies.directPlanning))
          ensurePlanningRpcOk(rootTreeResult, 'Planning tree root')

          let mergedTreeRoot = parsePlanningTreeResponse(rootTreeResult.text)
          let currentPathIds = []

          if (Number.isInteger(focusResourceId)) {
            const pathResult = await postPlanningRpc(jar, 'ConfigurationServiceProxy', context.permutations.configuration, buildPlanningSearchDataByIdBody(moduleBase, context.clientId, context.serializationPolicies.configuration, focusResourceId))
            ensurePlanningRpcOk(pathResult, 'Planning tree current path')

            currentPathIds = extractPlanningTreePathIds(pathResult.text)

            const pathIdsToExpand = explicitTargetResourceId === null
              ? currentPathIds.slice(1, -1)
              : currentPathIds.slice(1)

            for (const pathNodeId of pathIdsToExpand) {
              const pathNode = findPlanningTreeNodeById(mergedTreeRoot, pathNodeId)
              if (!pathNode?.configString) {
                throw new Error(`Could not find planning tree node ${pathNodeId} to expand.`)
              }

              const childrenResult = await postPlanningRpc(
                jar,
                'DirectPlanningServiceProxy',
                context.permutations.directPlanning,
                buildPlanningTreeChildrenBody(moduleBase, context.clientId, context.serializationPolicies.directPlanning, pathNode.configString),
              )
              ensurePlanningRpcOk(childrenResult, `Planning tree children for ${pathNode.id}`)
              mergedTreeRoot = replacePlanningTreeNode(mergedTreeRoot, parsePlanningTreeResponse(childrenResult.text))
            }
          }

          return {
            root: normalizePlanningTreeNode(mergedTreeRoot),
            currentResourceId: context.resourceId,
            focusResourceId,
            currentPathIds,
            planningIdentifier: context.planningIdentifier,
            finalUrl: context.finalUrl,
          }
        },
        allowStaleWhileRevalidate: true,
      })
    })

    tree.cache.context = context.cache
    return tree
  }

  async function fetchPlanningCalendarMetadataFromRpc(jar, { targetDate = null, resourceId: rawTargetResourceId = null, cacheScope = null } = {}) {
    const context = await getPlanningContext(jar, { cacheScope })
    const weeks = extractPlanningWeekEntries(context.calendarString)

    if (weeks.length === 0) {
      throw new Error('No planning weeks found in calendar response.')
    }

    const requestedResourceId = parseAdeTreeResourceId(rawTargetResourceId)
    const weekResolution = targetDate ? resolvePlanningWeekEntry(context.calendarString, targetDate) : null

    const calendar = {
      resourceId: Number.isInteger(requestedResourceId) ? requestedResourceId : context.resourceId,
      currentResourceId: context.resourceId,
      requestedResourceId,
      planningIdentifier: context.planningIdentifier,
      displayConfigurationId: context.displayConfigurationId,
      finalUrl: context.finalUrl,
      targetDate: targetDate || null,
      targetDateMatched: weekResolution ? weekResolution.matchedTargetDate : null,
      outOfRange: weekResolution ? !weekResolution.matchedTargetDate : null,
      matchedWeek: weekResolution ? summarizePlanningWeek(weekResolution.week) : null,
      currentWeek: summarizePlanningWeek(weeks.find((week) => week.current) ?? null),
      firstWeek: summarizePlanningWeek(weeks[0] ?? null),
      lastWeek: summarizePlanningWeek(weeks[weeks.length - 1] ?? null),
      weekCount: weeks.length,
      weeks: weeks.map(summarizePlanningWeek),
    }

    calendar.cache = {
      bucket: 'calendar',
      enabled: Boolean(context.cache?.enabled),
      status: context.cache?.enabled ? context.cache.status : 'bypass',
      context: context.cache,
    }

    return calendar
  }

  function clearPlanningCaches(cacheScope = null) {
    const normalizedScope = normalizePlanningCacheScope(cacheScope)

    if (!normalizedScope) {
      return
    }

    for (const key of contextCache.entries.keys()) {
      if (key === normalizedScope) {
        contextCache.entries.delete(key)
      }
    }

    for (const store of [treeCache, timetableCache]) {
      for (const key of store.entries.keys()) {
        if (key === normalizedScope || key.startsWith(`${normalizedScope}:`)) {
          store.entries.delete(key)
        }
      }
    }
  }

  return {
    clearPlanningCaches,
    fetchPlanningCalendarMetadataFromRpc,
    fetchPlanningTimetableFromRpc,
    fetchPlanningTreeFromRpc,
  }
}
