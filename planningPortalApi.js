const PORTAL_SESSION_TTL_MS = 25 * 60 * 1000
const PORTAL_TREE_TTL_MS = 30 * 60 * 1000
const PORTAL_CALENDAR_TTL_MS = 60 * 60 * 1000

const portalSessionCache = new Map()
// Sign-ins under way, by session: the planning asks several weeks at once,
// and sign-ins running side by side on one portal session step on each
// other (ADE gives the access token to one of them, the others get none).
// The others wait for that one and share its context.
const portalSignIns = new Map()
const portalTreeCache = new Map()
const portalCalendarCache = new Map()

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

function getFreshCacheEntry(cache, key, ttlMs) {
  if (!key) {
    return null
  }

  const entry = cache.get(key)
  if (!entry) {
    return null
  }

  if (Date.now() - entry.cachedAt > ttlMs) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function setCacheEntry(cache, key, value) {
  if (!key) {
    return
  }

  cache.set(key, {
    cachedAt: Date.now(),
    value,
  })
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  return value == null ? [] : [value]
}

function normalizeLabel(value, fallback = '') {
  const label = String(value ?? '').replace(/\s+/g, ' ').trim()
  return label || fallback
}

function buildPortalNodeId(node, fallbackId) {
  const id = String(node?.id ?? '').trim()
  return id || fallbackId
}

const PORTAL_CATEGORY_METADATA = {
  trainee: { id: '-1', name: 'Etudiants' },
  instructor: { id: '-2', name: 'Enseignants' },
  classroom: { id: '-3', name: 'Salles' },
}

function normalizePortalTreeCategory(rawNode, state, depth = 0, parentPath = '') {
  const categoryKey = normalizeLabel(rawNode?.category ?? rawNode?.family).toLowerCase()
  const categoryMetadata = depth === 1 ? PORTAL_CATEGORY_METADATA[categoryKey] : null
  const fallbackId = categoryMetadata?.id ?? `portal-category-${state.nextSyntheticId++}`
  const id = buildPortalNodeId(rawNode, fallbackId)
  const name = categoryMetadata?.name ?? normalizeLabel(
    rawNode?.name
      ?? rawNode?.label
      ?? rawNode?.category
      ?? rawNode?.title,
    id,
  )
  const path = parentPath ? `${parentPath}.${name}` : name
  const rawChildren = [
    ...asArray(rawNode?.branch),
    ...asArray(rawNode?.leaf),
    ...asArray(rawNode?.children),
  ]
  const children = rawChildren.map((child) => normalizePortalTreeCategory(child, state, depth + 1, path))

  return {
    id,
    name,
    path,
    family: rawNode?.category ?? rawNode?.family ?? null,
    depth,
    color: rawNode?.color ?? rawNode?.fields?.COLOR ?? null,
    childrenLoaded: true,
    config: null,
    fields: rawNode?.fields && typeof rawNode.fields === 'object' ? rawNode.fields : {},
    children,
  }
}

function normalizePortalTreePayload(rawCategory) {
  const state = { nextSyntheticId: 1 }

  if (Array.isArray(rawCategory)) {
    const root = {
      id: '-100',
      name: 'Ressources',
      path: 'Ressources',
      family: null,
      depth: 0,
      color: null,
      childrenLoaded: true,
      config: null,
      fields: {},
      children: [],
    }
    root.children = rawCategory.map((child) => normalizePortalTreeCategory(child, state, 1, root.path))
    return root
  }

  return normalizePortalTreeCategory(rawCategory ?? {}, state)
}

function findPortalTreePath(root, targetId, path = []) {
  if (!root) {
    return null
  }

  const nextPath = [...path, root]
  if (String(root.id) === String(targetId)) {
    return nextPath
  }

  for (const child of root.children ?? []) {
    const match = findPortalTreePath(child, targetId, nextPath)
    if (match) {
      return match
    }
  }

  return null
}

function flattenPortalTree(root, entries = []) {
  if (!root) {
    return entries
  }

  entries.push(root)
  for (const child of root.children ?? []) {
    flattenPortalTree(child, entries)
  }

  return entries
}

function clonePortalTreeNode(node, children = []) {
  return {
    ...node,
    children,
  }
}

function isPortalTreeContainerNode(node) {
  return ['-100', '-1', '-2', '-3'].includes(String(node?.id ?? ''))
}

function getMeaningfulPortalPath(pathNodes = []) {
  return pathNodes.filter((node) => !isPortalTreeContainerNode(node))
}

function looksLikePortalLevel(node) {
  const label = normalizeLabel(node?.name)
  return [
    /\b(?:licence|master|but|bachelor)\s*[1-9]\b/i,
    /\b(?:L|M)\s*[1-3]\b/,
    /\b[A-Z]{2,}\s+A[1-5]\b/i,
    /\b(?:1re|[1-5](?:e|ème))\s+ann[eé]e\b/i,
  ].some((pattern) => pattern.test(label))
}

function isPortalGroupContainer(node) {
  return /^(?:groupes?|classes?)\s+(?:td|tp)\b/i.test(normalizeLabel(node?.name))
}

function looksLikePortalTd(node) {
  const label = normalizeLabel(node?.name)
  if (!label || isPortalGroupContainer(node)) {
    return false
  }

  return /\bTD\s*[-_. ]?[A-Z0-9]+\b/i.test(label)
    || /^\d+[A-Z]\b/i.test(label)
    || /^groupe\s+[A-Z0-9]+\b/i.test(label)
}

function buildPortalSelectionPath(pathNodes = []) {
  const meaningfulPath = getMeaningfulPortalPath(pathNodes)
  if (meaningfulPath.length === 0) {
    return meaningfulPath
  }

  const detectedLevelIndex = meaningfulPath.findIndex(looksLikePortalLevel)
  const levelIndex = detectedLevelIndex >= 0
    ? detectedLevelIndex
    : Math.min(2, meaningfulPath.length - 1)
  const programIndex = Math.max(0, levelIndex - 1)
  const contextIndex = Math.max(0, programIndex - 1)
  const candidateTdNodes = meaningfulPath.slice(levelIndex + 1, -1)
  const tdNode = candidateTdNodes.find(looksLikePortalTd)
    ?? candidateTdNodes.find((node) => !isPortalGroupContainer(node))
    ?? null
  const selectedNodes = [
    meaningfulPath[contextIndex],
    meaningfulPath[programIndex],
    meaningfulPath[levelIndex],
    tdNode,
    meaningfulPath.at(-1),
  ]

  return selectedNodes.filter((node, index, nodes) => (
    node && nodes.findIndex((candidate) => (
      candidate && String(candidate.id) === String(node.id)
    )) === index
  ))
}

function collectPortalLeafDescendants(node, leaves = []) {
  const children = node?.children ?? []
  if (children.length === 0) {
    leaves.push(node)
    return leaves
  }

  for (const child of children) {
    collectPortalLeafDescendants(child, leaves)
  }

  return leaves
}

function getPortalLevelOptions(node) {
  return (node?.children ?? []).flatMap((child) => (
    isPortalGroupContainer(child) ? child.children ?? [] : [child]
  ))
}

function buildFocusedPortalTree(pathNodes, expandedNodeId, expandedChildren = null) {
  if (pathNodes.length === 0) {
    return null
  }

  let focusedChild = null

  for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
    const node = pathNodes[index]
    let children = focusedChild ? [focusedChild] : []

    if (String(node.id) === String(expandedNodeId)) {
      const sourceChildren = expandedChildren ?? node.children ?? []
      children = sourceChildren.map((child) => (
        focusedChild && String(child.id) === String(focusedChild.id)
          ? focusedChild
          : clonePortalTreeNode(child)
      ))

      if (
        focusedChild
        && !children.some((child) => String(child.id) === String(focusedChild.id))
      ) {
        children.unshift(focusedChild)
      }
    }

    focusedChild = clonePortalTreeNode(node, children)
  }

  return focusedChild
}

function normalizePortalResource(resource) {
  if (!resource || typeof resource !== 'object') {
    return null
  }

  const id = String(resource.id ?? '').trim()
  if (!id) {
    return null
  }

  return {
    ...resource,
    id,
    name: normalizeLabel(resource.name ?? resource.fields?.NAME ?? resource.fields?.Nom, `Ressource ${id}`),
  }
}

function getAccountResources(context) {
  return asArray(context?.authData?.resources)
    .map(normalizePortalResource)
    .filter(Boolean)
}

function buildDefaultSelection(resource, pathNodes = []) {
  if (!resource) {
    return null
  }

  const selectionPath = buildPortalSelectionPath(pathNodes)
  const establishmentNode = selectionPath[0] ?? null
  const programNode = selectionPath[1] ?? establishmentNode
  const yearNode = selectionPath[2] ?? null
  const tdNode = selectionPath[3] ?? null
  const finalNode = selectionPath.at(-1) ?? null
  const tpNode = finalNode && String(finalNode.id) !== String(tdNode?.id) ? finalNode : null
  const contextLabel = [establishmentNode, programNode]
    .map((node) => normalizeLabel(node?.name))
    .filter(Boolean)
    .join(' / ')

  return {
    resourceId: resource.id,
    label: resource.name,
    parentResourceId: (tpNode ? tdNode : yearNode)?.id == null
      ? null
      : String((tpNode ? tdNode : yearNode).id),
    parentLabel: normalizeLabel((tpNode ? tdNode : yearNode)?.name) || null,
    contextLabel: contextLabel || resource.name,
    programResourceId: programNode?.id == null ? null : String(programNode.id),
    programLabel: normalizeLabel(programNode?.name) || resource.name,
    yearResourceId: yearNode?.id == null ? null : String(yearNode.id),
    yearLabel: normalizeLabel(yearNode?.name) || null,
    tdResourceId: tdNode?.id == null ? null : String(tdNode.id),
    tdLabel: normalizeLabel(tdNode?.name) || null,
    tpResourceId: tpNode?.id == null ? null : String(tpNode.id),
    tpLabel: normalizeLabel(tpNode?.name) || null,
  }
}

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function parseDateOnly(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setHours(0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatPortalFilterDate(date) {
  return [
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getFullYear()),
  ].join('')
}

function parsePortalDateTime(dateValue, timeValue) {
  const dateMatch = String(dateValue ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const timeMatch = String(timeValue ?? '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$/)

  if (!dateMatch || !timeMatch) {
    return null
  }

  const [, day, month, year] = dateMatch
  const [, hour, minute, second = '00', rawOffset = ''] = timeMatch
  const offset = rawOffset && rawOffset !== 'Z' && !rawOffset.includes(':')
    ? `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`
    : rawOffset
  const isoInput = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`
  const date = new Date(isoInput)

  return Number.isNaN(date.getTime()) ? null : date
}

function getPortalParticipantRefs(event, categories) {
  const allowedCategories = new Set(categories)

  return asArray(event?.eventParticipants)
    .filter((participant) => allowedCategories.has(String(participant?.category ?? '').toLowerCase()))
    .map((participant) => ({
      id: String(participant?.id ?? participant?.resourceId ?? '').trim() || null,
      name: normalizeLabel(participant?.name ?? participant?.fields?.NAME),
    }))
    .filter((participant) => participant.name)
}

function getPortalParticipants(event, categories) {
  return getPortalParticipantRefs(event, categories).map(({ name }) => name)
}

function normalizePortalEvent(event, resourceId) {
  if (!event || typeof event !== 'object') {
    return null
  }

  const startDate = parsePortalDateTime(event.date, event.startHour)
  if (!startDate) {
    return null
  }

  const endDate = parsePortalDateTime(event.date, event.endHour) ?? startDate
  const instructorRefs = getPortalParticipantRefs(event, ['instructor', 'category2'])
  const instructors = instructorRefs.map(({ name }) => name)
  const rooms = getPortalParticipants(event, ['classroom', 'category3'])
  const groups = getPortalParticipants(event, ['trainee', 'category1', 'category8'])
  const fields = event.fields && typeof event.fields === 'object' ? event.fields : {}
  const title = normalizeLabel(
    event.name
      ?? fields.NAME
      ?? fields.Nom
      ?? fields.SUBJECT
      ?? fields.CODE_ACTIVITY,
    'Cours',
  )

  return {
    uid: String(event.id ?? event.activityId ?? ''),
    title,
    teacher: instructors.join(' - '),
    teachers: instructorRefs,
    location: rooms.join(' - '),
    groups,
    groupsLabel: groups.join(', '),
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    startMs: startDate.getTime(),
    endMs: endDate.getTime(),
    date: formatDateOnly(startDate),
    timeLabel: `${String(event.startHour ?? '').slice(0, 5)} - ${String(event.endHour ?? '').slice(0, 5)}`,
    editable: Boolean(event.canUpdateEvent),
    color: String(event.color ?? ''),
    hue: null,
    link: null,
    resourceId: String(resourceId ?? ''),
    activityId: event.activityId ?? null,
  }
}

function dedupePortalEvents(events) {
  const seen = new Set()

  return events.filter((event) => {
    const key = [event.uid, event.start, event.end, event.title].join('|')
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
}

function resolvePortalResourceIds(requestedResourceIds, context) {
  const accountResources = getAccountResources(context)
  const requestedIds = asArray(requestedResourceIds)
    .map((value) => String(value ?? '').trim())
    .filter((id, index, values) => /^-?\d+$/.test(id) && values.indexOf(id) === index)

  return requestedIds.length > 0 ? requestedIds : accountResources.map(({ id }) => id)
}

function unwrapPortalData(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload
}

function normalizeGroupKey(value) {
  return normalizeLabel(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function findPortalStudentRoot(root) {
  return (root?.children ?? []).find((node) => (
    String(node.id) === '-1' || String(node.family ?? '').toLowerCase() === 'trainee'
  )) ?? root
}

// Locates the student's own group in the "Etudiants" branch from group names
// seen in their courses, given as [{ name, count }] (count = number of courses
// listing that group). A student's TP group shows up in CM, TD and TP courses
// while the other groups of the promo only show up in CMs, so the most
// frequent matching leaf wins. Ties fall back to the groups' common parent
// (the promo or TD), which still covers every course of the student.
export function findPortalStudentNodeByGroups(root, groupHints = []) {
  const studentRoot = findPortalStudentRoot(root)
  if (!studentRoot || groupHints.length === 0) {
    return null
  }

  const counts = new Map()
  for (const hint of groupHints) {
    const key = normalizeGroupKey(hint?.name ?? hint)
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + (Number(hint?.count) || 1))
    }
  }

  const candidates = []
  const walk = (node, path) => {
    const nextPath = [...path, node]
    const children = node.children ?? []
    if (children.length === 0) {
      const count = counts.get(normalizeGroupKey(node.name))
      if (count) {
        candidates.push({ node, path: nextPath, count })
      }
      return
    }
    for (const child of children) {
      walk(child, nextPath)
    }
  }
  walk(studentRoot, findPortalTreePath(root, studentRoot.id)?.slice(0, -1) ?? [])

  if (candidates.length === 0) {
    return null
  }

  const topCount = Math.max(...candidates.map(({ count }) => count))
  const best = candidates.filter(({ count }) => count === topCount)
  if (best.length === 1) {
    return { node: best[0].node, path: best[0].path, ambiguous: false }
  }

  // Deepest node shared by every tied path.
  let commonLength = 0
  const [firstPath, ...otherPaths] = best.map(({ path }) => path)
  while (
    commonLength < firstPath.length
    && otherPaths.every((path) => String(path[commonLength]?.id) === String(firstPath[commonLength].id))
  ) {
    commonLength += 1
  }
  const commonPath = firstPath.slice(0, commonLength)
  const commonNode = commonPath.at(-1)

  if (!commonNode || isPortalTreeContainerNode(commonNode)) {
    return { node: best[0].node, path: best[0].path, ambiguous: true }
  }

  return { node: commonNode, path: commonPath, ambiguous: true }
}

export function createPlanningPortalApiClient({
  casOrigin,
  planningOrigin,
  fetchWithJar,
  followRedirectChain,
} = {}) {
  if (!casOrigin || !planningOrigin) {
    throw new TypeError('createPlanningPortalApiClient requires CAS and planning origins.')
  }

  const portalUrl = `${planningOrigin}/portal/`
  const restBase = `${portalUrl}RestApi/`

  async function readJsonResponse(response, label) {
    const text = await response.text()
    const payload = readJsonSafely(text)

    if (!response.ok || payload == null) {
      throw new Error(`${label} failed (${response.status}): ${text.slice(0, 240)}`)
    }

    return payload
  }

  async function requestPortalAccessToken(jar) {
    const tokenResponse = await fetchWithJar(`${portalUrl}sso/accessToken`, jar, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: portalUrl,
      },
      body: '{}',
      redirect: 'manual',
    })
    const tokenPayload = await readJsonResponse(tokenResponse, 'ADE portal access token')
    return String(tokenPayload?.token ?? tokenPayload?.data?.token ?? '').trim()
  }

  async function authenticatePortal(jar, { cacheScope = null, force = false } = {}) {
    if (!force) {
      const cached = getFreshCacheEntry(portalSessionCache, cacheScope, PORTAL_SESSION_TTL_MS)
      if (cached) {
        return { ...cached, cache: 'hit' }
      }
    }

    const pending = cacheScope ? portalSignIns.get(cacheScope) : null
    if (pending) {
      return pending
    }

    const signIn = signInToPortal(jar, cacheScope)
    if (cacheScope) {
      portalSignIns.set(cacheScope, signIn)
      const settle = () => portalSignIns.delete(cacheScope)
      signIn.then(settle, settle)
    }
    return signIn
  }

  async function signInToPortal(jar, cacheScope) {
    let token = ''
    let finalUrl = portalUrl

    // A /portal JSESSIONID usually travels in our encrypted session cookie and
    // can mint a fresh short-lived bearer directly; otherwise the CAS TGC
    // (also in the cookie) signs us in below.
    try {
      token = await requestPortalAccessToken(jar)
    } catch {
      token = ''
    }

    if (!token) {
      const casLoginUrl = `${casOrigin}/login?service=${encodeURIComponent(portalUrl)}`
      const casResult = await followRedirectChain(casLoginUrl, jar, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        },
      })
      await casResult.response.text()
      finalUrl = casResult.finalUrl
      token = await requestPortalAccessToken(jar)
    }

    if (!token) {
      throw new Error('ADE portal access token response did not contain a token.')
    }

    const loginResponse = await fetchWithJar(`${restBase}portal/ssologin`, jar, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Referer: portalUrl,
      },
      body: '{}',
      redirect: 'manual',
    })
    const loginPayload = await readJsonResponse(loginResponse, 'ADE portal SSO login')
    const loginData = unwrapPortalData(loginPayload)
    const authData = loginData?.authData?.authData ?? loginData?.authData ?? null
    const projectId = Number(authData?.projectId ?? loginData?.projectId)
    const apiToken = String(authData?.accessToken ?? loginData?.accessToken ?? '').trim()

    if (!authData || !Number.isFinite(projectId) || !apiToken) {
      throw new Error('ADE portal SSO login did not return an account project and API token.')
    }

    const context = {
      token: apiToken,
      ssoAccessToken: token,
      refreshToken: String(authData?.refreshToken ?? loginData?.refreshToken ?? '').trim(),
      authData,
      projectId,
      finalUrl,
      cacheScope,
      cache: 'miss',
    }
    setCacheEntry(portalSessionCache, cacheScope, context)
    return context
  }

  async function refreshPortalApiToken(jar, context) {
    if (!context.refreshToken) {
      return false
    }

    try {
      const response = await fetchWithJar(
        `${restBase}portal/refreshtoken?refresh_token=${encodeURIComponent(context.refreshToken)}`,
        jar,
        {
          headers: {
            Accept: 'application/json',
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
            Referer: portalUrl,
          },
          redirect: 'manual',
        },
      )
      const payload = await readJsonResponse(response, 'ADE portal token refresh')
      const refreshData = unwrapPortalData(payload)
      const accessToken = String(refreshData?.accessToken ?? '').trim()

      if (!accessToken) {
        return false
      }

      context.token = accessToken
      context.refreshToken = String(refreshData?.refreshToken ?? context.refreshToken).trim()
      setCacheEntry(portalSessionCache, context.cacheScope, context)
      return true
    } catch {
      return false
    }
  }

  async function fetchPortalJson(jar, context, path, options = {}) {
    const request = () => fetchWithJar(`${restBase}${path}`, jar, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${context.token}`,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Referer: portalUrl,
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    })

    let response = await request()
    if (response.status === 401 && await refreshPortalApiToken(jar, context)) {
      response = await request()
    }

    return readJsonResponse(response, options.label ?? 'ADE portal request')
  }

  async function fetchProjectJson(jar, context, path, options = {}) {
    return fetchPortalJson(jar, context, `portal/projects/${context.projectId}/${path}`, options)
  }

  async function fetchPortalStatus(jar) {
    const response = await fetchWithJar(`${restBase}configuration/sso`, jar, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: portalUrl,
      },
      body: JSON.stringify({ id: 'ade-portal' }),
      redirect: 'manual',
    })
    const payload = await readJsonResponse(response, 'ADE portal configuration')

    return {
      ok: response.ok,
      status: response.status,
      data: unwrapPortalData(payload),
    }
  }

  // `fallbackResourceId`: a group the client found for the student (from
  // ScoDoc) standing in for the account's own resource when the account has
  // none (its planning never set up), so the tree and its default selection
  // come back as for a set-up account. Ignored otherwise.
  async function fetchPortalTree(jar, {
    requestedResourceId = '',
    fallbackResourceId = '',
    cacheScope = null,
    groupHints = [],
  } = {}) {
    const context = await authenticatePortal(jar, { cacheScope })
    let cachedTree = getFreshCacheEntry(portalTreeCache, cacheScope, PORTAL_TREE_TTL_MS)
    let cache = 'hit'

    if (!cachedTree) {
      const payload = await fetchProjectJson(jar, context, 'resourcestree', {
        label: 'ADE portal resource tree',
      })
      const rawCategory = unwrapPortalData(payload)?.category ?? unwrapPortalData(payload)
      cachedTree = normalizePortalTreePayload(rawCategory)
      setCacheEntry(portalTreeCache, cacheScope, cachedTree)
      cache = 'miss'
    }

    const ownResources = getAccountResources(context)
    const fallbackId = String(fallbackResourceId ?? '').trim()
    const fallbackNode = ownResources.length === 0 && fallbackId
      ? findPortalTreePath(cachedTree, fallbackId)?.at(-1) ?? null
      : null
    const resources = fallbackNode ? [normalizePortalResource(fallbackNode)] : ownResources
    const requestedId = String(requestedResourceId ?? '').trim()
    const requestedPath = requestedId ? findPortalTreePath(cachedTree, requestedId) ?? [] : []
    let accountResource = resources.find(({ id }) => id === requestedId) ?? resources[0] ?? null
    let accountPath = accountResource ? findPortalTreePath(cachedTree, accountResource.id) ?? [] : []
    let accountSource = accountPath.length > 0 ? 'portal-account' : null

    // No group on the ADE account: locate it from the student's courses.
    if (accountPath.length === 0 && !requestedId && groupHints.length > 0) {
      const hinted = findPortalStudentNodeByGroups(cachedTree, groupHints)
      if (hinted) {
        accountResource = { id: String(hinted.node.id), name: hinted.node.name }
        accountPath = hinted.path
        accountSource = hinted.ambiguous ? 'campus-groups-parent' : 'campus-groups'
      }
    }
    const currentPath = requestedPath.length > 0 ? requestedPath : accountPath
    const currentResource = currentPath.at(-1) ?? accountResource
    const defaultSelection = requestedId ? null : buildDefaultSelection(accountResource, accountPath)
    const initialSelectionPath = buildPortalSelectionPath(accountPath)
    const requestedSelectionPath = requestedId ? buildPortalSelectionPath(currentPath) : []
    const expandedNode = requestedId
      ? currentResource
      : initialSelectionPath[1] ?? initialSelectionPath[0] ?? currentResource
    const requestedLevelNode = requestedSelectionPath[2] ?? null
    const requestedTdNode = requestedSelectionPath[3] ?? null
    const requestedIsLevel = requestedId
      && String(currentResource?.id) === String(requestedLevelNode?.id)
    const requestedIsTd = requestedId
      && String(currentResource?.id) === String(requestedTdNode?.id)
      && String(requestedTdNode?.id) !== String(requestedLevelNode?.id)
    const expandedChildren = requestedIsTd
      ? collectPortalLeafDescendants(expandedNode).map((node) => clonePortalTreeNode(node))
      : requestedIsLevel
        ? getPortalLevelOptions(expandedNode).map((node) => clonePortalTreeNode(node))
        : null
    const focusedTree = buildFocusedPortalTree(
      currentPath,
      expandedNode?.id ?? currentResource?.id ?? cachedTree.id,
      expandedChildren,
    ) ?? clonePortalTreeNode(cachedTree)

    return {
      root: focusedTree,
      fullRoot: cachedTree,
      currentResourceId: currentResource?.id ?? null,
      focusResourceId: currentResource?.id || cachedTree.id,
      currentPathIds: currentPath.map(({ id }) => String(id)),
      selectionPathIds: (requestedId
        ? buildPortalSelectionPath(currentPath)
        : initialSelectionPath
      ).map(({ id }) => String(id)),
      selectionSchema: 'rennes-portal-v2',
      defaultSelection,
      accountSource,
      resources,
      projectId: context.projectId,
      cache,
      authCache: context.cache,
      finalUrl: context.finalUrl,
    }
  }

  async function searchPortalTree(jar, query, { cacheScope = null } = {}) {
    const tree = await fetchPortalTree(jar, { cacheScope })
    const needle = normalizeLabel(query).toLocaleLowerCase('fr')
    const results = flattenPortalTree(tree.fullRoot)
      .filter((node) => node.children.length === 0 && normalizeLabel(node.name).toLocaleLowerCase('fr').includes(needle))
      .slice(0, 100)
      .map((node) => ({
        id: node.id,
        name: node.name,
        path: node.path,
        family: node.family,
      }))

    return {
      results,
      projectId: tree.projectId,
      cache: tree.cache,
    }
  }

  // Leaves of the "Enseignants" branch (category id -2), optionally filtered
  // by name. Empty when the account is not allowed to browse teachers.
  async function listPortalInstructors(jar, query = '', { cacheScope = null, limit = 60 } = {}) {
    const tree = await fetchPortalTree(jar, { cacheScope })
    const needle = normalizeLabel(query).toLocaleLowerCase('fr')
    const instructorRoot = (tree.fullRoot?.children ?? []).find((node) => (
      String(node.id) === '-2' || String(node.family ?? '').toLowerCase() === 'instructor'
    ))
    const teachers = instructorRoot
      ? flattenPortalTree(instructorRoot)
        .filter((node) => node !== instructorRoot && node.children.length === 0)
        .filter((node) => !needle || normalizeLabel(node.name).toLocaleLowerCase('fr').includes(needle))
        .slice(0, limit)
        .map((node) => ({ id: String(node.id), name: node.name }))
      : []

    return {
      available: Boolean(instructorRoot),
      teachers,
      projectId: tree.projectId,
      cache: tree.cache,
    }
  }

  // Leaves of the "Salles" branch (category id -3), each with the names of
  // the folders above it (site, building…), for the free-room finder.
  // Empty when the account is not allowed to browse rooms.
  async function listPortalClassrooms(jar, { cacheScope = null } = {}) {
    const tree = await fetchPortalTree(jar, { cacheScope })
    const roomRoot = (tree.fullRoot?.children ?? []).find((node) => (
      String(node.id) === '-3' || String(node.family ?? '').toLowerCase() === 'classroom'
    ))
    const rooms = []
    const walk = (node, path) => {
      for (const child of node.children ?? []) {
        if (child.children?.length) walk(child, [...path, child.name])
        else rooms.push({ id: String(child.id), name: child.name, path })
      }
    }
    if (roomRoot) walk(roomRoot, [])

    return {
      available: Boolean(roomRoot),
      rooms,
      projectId: tree.projectId,
      cache: tree.cache,
    }
  }

  async function fetchPortalCalendar(jar, { cacheScope = null } = {}) {
    const context = await authenticatePortal(jar, { cacheScope })
    const cached = getFreshCacheEntry(portalCalendarCache, cacheScope, PORTAL_CALENDAR_TTL_MS)
    if (cached) {
      return { ...cached, cache: 'hit' }
    }

    const payload = await fetchProjectJson(jar, context, 'calendar/', {
      label: 'ADE portal calendar',
    })
    const calendar = unwrapPortalData(payload)
    const result = {
      calendar,
      projectId: context.projectId,
      cache: 'miss',
    }
    setCacheEntry(portalCalendarCache, cacheScope, result)
    return result
  }

  async function fetchPortalEvents(jar, {
    date = null,
    lookaheadDays = 7,
    resourceIds = [],
    cacheScope = null,
  } = {}) {
    const context = await authenticatePortal(jar, { cacheScope })
    const resolvedResourceIds = resolvePortalResourceIds(resourceIds, context)
    if (resolvedResourceIds.length === 0) {
      return {
        complete: true,
        events: [],
        resourceIds: [],
        projectId: context.projectId,
        cache: 'miss',
      }
    }

    const startDate = parseDateOnly(date) ?? new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + Math.max(1, Number(lookaheadDays)) - 1)
    const filterPath = [
      `resources;${resolvedResourceIds.join(';')}`,
      `startdate;${formatPortalFilterDate(startDate)}`,
      `enddate;${formatPortalFilterDate(endDate)}`,
      'level;=8',
      'field;Nom;CODEZ_RESOURCE;OWNER;',
    ].join('/')
    const payload = await fetchProjectJson(jar, context, `resourcesEventsPortal/${filterPath}`, {
      label: 'ADE portal events',
    })
    const responseData = unwrapPortalData(payload)
    const nestedResponseData = unwrapPortalData(responseData)
    const resourceEventBlocks = Array.isArray(nestedResponseData)
      ? nestedResponseData
      : asArray(nestedResponseData?.resources ?? nestedResponseData?.eventsByResource)
    const events = dedupePortalEvents(resourceEventBlocks.flatMap((block) => (
      asArray(block?.events)
        .map((event) => normalizePortalEvent(event, block?.id))
        .filter(Boolean)
    )))

    return {
      complete: true,
      events,
      resourceIds: resolvedResourceIds,
      projectId: context.projectId,
      cache: 'miss',
      rawSettings: responseData?.settings ?? payload?.settings ?? null,
    }
  }

  // A call on a session signed in earlier that fails (that session gone on
  // ADE's side before our 25 minutes are up) signs in again and is tried
  // once more.
  function retryOnStaleSession(fetchFromPortal) {
    return async (jar, options = {}) => {
      const cacheScope = options.cacheScope ?? null
      const signedInBefore = getFreshCacheEntry(portalSessionCache, cacheScope, PORTAL_SESSION_TTL_MS) !== null
      try {
        return await fetchFromPortal(jar, options)
      } catch (error) {
        if (!signedInBefore) throw error
        portalSessionCache.delete(cacheScope)
        return fetchFromPortal(jar, options)
      }
    }
  }

  function clearPortalCaches(cacheScope = null) {
    if (!cacheScope) {
      return
    }

    portalSessionCache.delete(cacheScope)
    portalTreeCache.delete(cacheScope)
    portalCalendarCache.delete(cacheScope)
  }

  return {
    authenticatePortal,
    clearPortalCaches,
    fetchPortalCalendar: retryOnStaleSession(fetchPortalCalendar),
    fetchPortalEvents: retryOnStaleSession(fetchPortalEvents),
    fetchPortalStatus,
    fetchPortalTree: retryOnStaleSession(fetchPortalTree),
    listPortalClassrooms,
    listPortalInstructors,
    searchPortalTree,
  }
}
