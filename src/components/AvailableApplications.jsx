import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, iconLoaded, loadIcons } from '@iconify/react'
import universityConfig from '@university'
import { toAppSlug, track } from '../analytics'
import { fetchAppIcons, getCachedAppIcons } from '../appIcons'
import { scoreAppSearch, searchApps } from '../appSearch'
import { DEMO_PLANNING_APP_FNAME } from '../demoAccount'
import { getGradesOrigin, opensGradesPageInApp } from '../gradesPortalApp'
import { getPlanningOrigin, opensPlanningPageInApp } from '../planningPortalApp'
import LoadingDots from './LoadingDots'
import {
  ENT_AUTH_PREFIX,
  ENT_ORIGIN,
  buildEntProxyHref,
  collectFavoritePortlets,
  collectPortletsFromLayout,
  collectServiceSections,
  extractLaunchLink,
  getPortalBootstrap,
  getPortletFragment,
  mergePortlets,
  requestEnt,
} from '../entApi'

const DEFAULT_ERROR_MESSAGE = 'Impossible de charger les applications pour le moment'
const FAVORITES_CONTEXT_MENU_WIDTH = 216
const FAVORITES_CONTEXT_MENU_HEIGHT = 56
const FAVORITES_CONTEXT_MENU_MARGIN = 12
const FAVORITE_REMOVAL_ANIMATION_MS = 220
// The sidebar only fits a few favorites; the rest stay starred in the full list.
const SIDEBAR_FAVORITES_LIMIT = 4

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getFirstText(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmedValue = value.trim()
      if (trimmedValue) {
        return trimmedValue
      }
    }
  }

  return ''
}

function getPortletKey(item = {}) {
  return item.fname || item.nodeId || item.ID || `${item.title ?? item.name ?? 'unknown'}-${item.url ?? ''}`
}

function getLookupCandidates(item = {}) {
  return Array.from(new Set(
    [
      getPortletKey(item),
      item.fname,
      item.ID,
      item.nodeId,
      item.chanID,
      item.title,
      item.name,
      item.url,
      item.widgetURL,
    ]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).trim())
      .filter(Boolean),
  ))
}

function getApplicationKey(application = {}) {
  return application.fname || application.id
}

// Anonymous analytics: which application was opened, and from where. Only
// the portal/app identifier (slugged) is sent — never its title or URL.
// `in_app`: the grade service's app opened « Mes notes » rather than ScoDoc,
// or the planning service's app the Planning page rather than the service.
function trackApplicationOpened(application, source, { inApp = false } = {}) {
  const app = toAppSlug(getApplicationKey(application))
  if (app) {
    track('app_opened', { app, source, in_app: inApp })
  }
}

const FAVORITES_ORDER_KEY = 'l-ent:favorites-order'
// Last order of the full app list. Starring an app on the portal moves it
// into the favorites section, which loses its place: this remembers it.
const APPS_ORDER_KEY = 'l-ent:apps-order'

function loadAppsOrder() {
  try {
    const stored = JSON.parse(localStorage.getItem(APPS_ORDER_KEY) || 'null')
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

function saveAppsOrder(applications) {
  try {
    localStorage.setItem(APPS_ORDER_KEY, JSON.stringify(applications.map(getApplicationKey)))
  } catch {
    // Storage unavailable
  }
}

// Puts each app only found in the favorites section among the other apps,
// as if it weren't a favorite: where it sat last time (right after the
// closest app that preceded it and is still listed), or, never seen outside
// the favorites, at its alphabetical place among the others. Never in a pile
// at the end.
function placeInUsualOrder(regularApps, favoriteOnlyApps, rememberedKeys) {
  const rememberedIndex = new Map(rememberedKeys.map((key, index) => [key, index]))
  const result = [...regularApps]
  const unknown = []
  const known = []

  for (const app of favoriteOnlyApps) {
    const index = rememberedIndex.get(getApplicationKey(app))
    if (index === undefined) {
      unknown.push(app)
    } else {
      known.push([index, app])
    }
  }

  known.sort(([left], [right]) => left - right)
  for (const [index, app] of known) {
    let insertAt = 0
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const position = result.findIndex((listed) => getApplicationKey(listed) === rememberedKeys[previous])
      if (position !== -1) {
        insertAt = position + 1
        break
      }
    }
    result.splice(insertAt, 0, app)
  }

  unknown.sort((left, right) => compareTitles(left.title, right.title))
  for (const app of unknown) {
    const position = result.findIndex((listed) => compareTitles(listed.title, app.title) > 0)
    result.splice(position === -1 ? result.length : position, 0, app)
  }

  return result
}

function compareTitles(left = '', right = '') {
  return String(left).localeCompare(String(right), 'fr', { sensitivity: 'base' })
}

function loadFavoritesOrder() {
  try {
    const stored = localStorage.getItem(FAVORITES_ORDER_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function saveFavoritesOrder(favorites) {
  try {
    const keys = favorites.map(getApplicationKey)
    localStorage.setItem(FAVORITES_ORDER_KEY, JSON.stringify(keys))
  } catch {
    return
  }
}

function applyStoredOrder(favorites) {
  const storedKeys = loadFavoritesOrder()
  if (!storedKeys || storedKeys.length === 0) {
    return favorites
  }

  const keyToIndex = new Map(storedKeys.map((key, i) => [key, i]))
  return [...favorites].sort((a, b) => {
    const ai = keyToIndex.get(getApplicationKey(a)) ?? Infinity
    const bi = keyToIndex.get(getApplicationKey(b)) ?? Infinity
    return ai - bi
  })
}

const LOCAL_PINS_KEY = 'l-ent:local-pins'

function loadLocalPins() {
  try {
    const stored = localStorage.getItem(LOCAL_PINS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveLocalPins(pins) {
  try {
    localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins))
  } catch {
    return
  }
}

// A portal that can't store favourites (services.localFavorites: Drupal at
// Rennes 2) keeps them in this browser instead: the keys of the starred apps,
// in the order they were starred. The row then works as with the ENT's
// favourites (star, exit animation, drag order), only without the portal.
const LOCAL_FAVORITES = universityConfig.services?.localFavorites === true
const LOCAL_FAVORITES_KEY = 'l-ent:local-favorites'

function loadLocalFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_FAVORITES_KEY) || 'null')
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

function saveLocalFavorites(keys) {
  try {
    localStorage.setItem(LOCAL_FAVORITES_KEY, JSON.stringify(keys))
  } catch {
    // Storage unavailable
  }
}

// The favourites section built from the stored keys, as
// normalizeBootstrapSections builds it from the portal. Apps the portal no
// longer lists are left out.
function buildLocalFavoriteSections(services, keys) {
  const servicesByKey = new Map(services.map((service) => [getApplicationKey(service), service]))
  const applications = [...new Set(keys)].map((key) => servicesByKey.get(key)).filter(Boolean)
  return {
    source: 'local-favorites',
    rawCount: applications.length,
    sections: applications.length > 0
      ? [{ id: 'ent-favorites', title: 'Favoris', subtitle: '', applications }]
      : [],
  }
}

function isLocalService(application) {
  return !application?.portalNodeId
}

function getPortalNodeId(entry, metadata = {}) {
  return getFirstText(
    entry?.ID,
    entry?.nodeId,
    metadata?.ID,
    metadata?.nodeId,
  )
}

function toNavigableHref(value) {
  const href = getFirstText(value)
  if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
    return ''
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    return href
  }

  return buildEntProxyHref(href)
}

const LETTER_COLORS = [
  { bg: '#dbeafe', fg: '#2563eb' },
  { bg: '#ede9fe', fg: '#7c3aed' },
  { bg: '#fce7f3', fg: '#db2777' },
  { bg: '#fee2e2', fg: '#dc2626' },
  { bg: '#ffedd5', fg: '#ea580c' },
  { bg: '#fef9c3', fg: '#ca8a04' },
  { bg: '#dcfce7', fg: '#16a34a' },
  { bg: '#ccfbf1', fg: '#0d9488' },
  { bg: '#cffafe', fg: '#0891b2' },
  { bg: '#e0e7ff', fg: '#4f46e5' },
  { bg: '#f3e8ff', fg: '#9333ea' },
  { bg: '#fae8ff', fg: '#c026d3' },
  { bg: '#ffe4e6', fg: '#e11d48' },
  { bg: '#fef3c7', fg: '#d97706' },
  { bg: '#d1fae5', fg: '#059669' },
  { bg: '#e0f2fe', fg: '#0284c7' },
]

function getLetterStyle(title = '') {
  const letter = (title.trim()[0] || '?').toUpperCase()
  const code = letter.charCodeAt(0)
  return LETTER_COLORS[code % LETTER_COLORS.length]
}

function getAppLetter(title = '') {
  return (title.trim()[0] || '?').toUpperCase()
}

// Icon picked by the server for the whole university (src/appIcons.js), as
// { icon, isReady, colors: { light: { bg, fg }, dark: { bg, fg } } }. Its
// colours apply as soon as they're known; the glyph waits for Iconify, with
// the letter standing in until then (same box, so nothing moves).
function getAssignmentStyle(assignment) {
  const { light, dark } = assignment.colors
  return {
    '--app-tile-bg': light.bg,
    '--app-tile-fg': light.fg,
    '--app-tile-bg-dark': dark.bg,
    '--app-tile-fg-dark': dark.fg,
  }
}

const AppIcon = memo(function AppIcon({ title, assignment = null, isLaunching = false, className = '', letterClassName = 'text-lg' }) {
  // A university's hand-made icon wins, then the automatic one, then the letter.
  const iconSrc = getAppIcon(title)
  const autoIcon = iconSrc ? null : assignment
  const letterStyle = iconSrc || autoIcon ? null : getLetterStyle(title)

  return (
    <span
      className={`app-icon inline-flex items-center justify-center bg-widget-bg shadow-sm shrink-0 ${autoIcon ? 'app-icon--auto' : ''} ${className}`}
      aria-hidden="true"
      style={autoIcon
        ? getAssignmentStyle(autoIcon)
        : letterStyle ? { backgroundColor: letterStyle.bg, color: letterStyle.fg } : undefined}
    >
      {isLaunching ? (
        <LoadingDots label={null} />
      ) : autoIcon?.isReady ? (
        // `ssr`: draw on the first render, the icon is already loaded.
        <Icon icon={autoIcon.icon} ssr className="w-[60%] h-[60%]" />
      ) : iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-contain rounded-[inherit]"
        />
      ) : (
        <span className={`${letterClassName} font-semibold leading-none select-none`}>
          {getAppLetter(title)}
        </span>
      )}
    </span>
  )
})

function normalizeTarget(entry, metadata = {}) {
  const target = getFirstText(
    entry?.parameters?.target,
    metadata?.parameters?.target,
    entry?.target,
    metadata?.target,
  )

  if (target) {
    return target
  }

  return String(entry?.parameters?.stopImmediately ?? metadata?.parameters?.stopImmediately) === 'true'
    ? '_blank'
    : ''
}

function buildPortletLookup(layoutData, layoutDocData) {
  const mergedPortlets = mergePortlets(
    collectPortletsFromLayout(layoutData),
    Array.isArray(layoutDocData) ? layoutDocData : [],
  )

  const lookup = new Map()

  for (const item of mergedPortlets) {
    for (const candidate of getLookupCandidates(item)) {
      if (!lookup.has(candidate)) {
        lookup.set(candidate, item)
      }
    }
  }

  return lookup
}

function findPortletMetadata(item, lookup) {
  for (const candidate of getLookupCandidates(item)) {
    const match = lookup.get(candidate)
    if (match) {
      return match
    }
  }

  return null
}

const TITLE_OVERRIDES = universityConfig.services?.titleOverrides ?? {}

function normalizeServiceEntry(entry, metadata = {}, extra = {}) {
  const portalTitle = getFirstText(
    entry?.title,
    entry?.name,
    metadata?.title,
    metadata?.name,
    entry?.fname,
    metadata?.fname,
  )
  // NFC: the portal may send accents decomposed ("e" + combining accent).
  const title = TITLE_OVERRIDES[portalTitle.normalize('NFC').toLowerCase()] ?? portalTitle

  const href = toNavigableHref(
    getFirstText(
      entry?.parameters?.launchUrl,
      metadata?.parameters?.launchUrl,
      entry?.widgetURL,
      metadata?.widgetURL,
      entry?.parameters?.url,
      metadata?.parameters?.url,
      entry?.url,
      metadata?.url,
      entry?.alternativeMaximizedLink,
      metadata?.alternativeMaximizedLink,
    ),
  )

  if (!title || !href) {
    return null
  }

  return {
    id: getPortletKey(entry),
    fname: getFirstText(entry?.fname, metadata?.fname),
    portalNodeId: getFirstText(extra.portalNodeId, getPortalNodeId(entry, metadata)),
    title,
    description: getFirstText(
      entry?.description,
      metadata?.description,
      entry?.parameters?.description,
      metadata?.parameters?.description,
      metadata?.summary,
      metadata?.parameters?.subtitle,
    ),
    href,
    target: normalizeTarget(entry, metadata),
    removeFavoriteTarget: extra.removeFavoriteTarget ?? null,
  }
}

function dedupeApplications(applications) {
  const seenKeys = new Set()

  return applications.filter((application) => {
    const uniqueKey = `${application.id}-${application.href}`

    if (seenKeys.has(uniqueKey)) {
      return false
    }

    seenKeys.add(uniqueKey)
    return true
  })
}

function isFavoritesLikeLabel(value = '') {
  const normalizedValue = String(value).trim().toLowerCase()
  return normalizedValue.includes('favori')
    || normalizedValue.includes('favorite')
    || normalizedValue.includes('bookmark')
}

function hasFavoriteCollections(layoutData) {
  const layout = layoutData?.layout

  return Array.isArray(layout?.favorites)
    || Array.isArray(layout?.favoriteGroups)
    || Array.isArray(layout?.navigation?.favorites)
    || Array.isArray(layout?.navigation?.favoriteGroups)
    || typeof layout?.globals?.hasFavorites === 'string'
}

function normalizeFavoriteSections(bootstrap) {
  const layoutData = bootstrap?.layout?.data
  if (!isRecord(layoutData)) {
    return {
      available: false,
      count: 0,
      sections: [],
    }
  }

  const portletLookup = buildPortletLookup(layoutData, bootstrap?.layoutDoc?.data)
  const serviceTabs = collectServiceSections(layoutData)
  let folderFavoriteApplications = []

  for (const tab of serviceTabs) {
    const favoriteSectionIndex = tab.sections.findIndex((section) => isFavoritesLikeLabel(section.title))
    if (favoriteSectionIndex === -1) {
      continue
    }

    const favoriteSection = tab.sections[favoriteSectionIndex]
    const nextSection = tab.sections[favoriteSectionIndex + 1] ?? null
    const firstNextService = nextSection?.services?.[0] ?? null
    const firstNextMetadata = firstNextService ? findPortletMetadata(firstNextService, portletLookup) : null
    const removeFavoriteTarget = nextSection
      ? {
          wrapperId: getFirstText(nextSection.id),
          nextElementId: getPortalNodeId(firstNextService, firstNextMetadata),
        }
      : null

    folderFavoriteApplications = dedupeApplications(
      favoriteSection.services
        .map((favoritePortlet) => {
          const metadata = findPortletMetadata(favoritePortlet, portletLookup)
          return normalizeServiceEntry(favoritePortlet, metadata, {
            portalNodeId: getPortalNodeId(favoritePortlet, metadata),
            removeFavoriteTarget,
          })
        })
        .filter(Boolean),
    )

    if (folderFavoriteApplications.length > 0) {
      break
    }
  }

  const directFavoriteApplications = dedupeApplications(
    collectFavoritePortlets(layoutData)
      .map((favoritePortlet) => (
        normalizeServiceEntry(
          favoritePortlet,
          findPortletMetadata(favoritePortlet, portletLookup),
          {
            portalNodeId: getPortalNodeId(
              favoritePortlet,
              findPortletMetadata(favoritePortlet, portletLookup),
            ),
          },
        )
      ))
      .filter(Boolean),
  )
  const applications = folderFavoriteApplications.length > 0
    ? folderFavoriteApplications
    : directFavoriteApplications

  return {
    available: hasFavoriteCollections(layoutData)
      || serviceTabs.some((tab) => tab.sections.some((section) => isFavoritesLikeLabel(section.title))),
    count: applications.length,
    sections: applications.length > 0
      ? [{
          id: 'ent-favorites',
          title: 'Favoris',
          subtitle: '',
          applications,
        }]
      : [],
  }
}

function normalizeBootstrapSections(bootstrap) {
  const favoriteSource = normalizeFavoriteSections(bootstrap)
  return {
    source: favoriteSource.available ? 'ent-favorites' : 'none',
    rawCount: favoriteSource.count,
    sections: favoriteSource.sections,
  }
}

const APP_CATEGORIES = universityConfig.services?.categories ?? []
const SHOW_CATEGORY_FILTERS = universityConfig.features?.serviceCategories === true
const getAppIcon = universityConfig.services?.getAppIcon ?? (() => null)

function getAppCategory(title = '') {
  const t = title.trim().toLowerCase()
  for (const { label, keywords } of APP_CATEGORIES) {
    if (keywords.some((kw) => t.includes(kw))) {
      return label
    }
  }
  return null
}

function isUnavailableGradeApplication(application = {}) {
  const isUnavailable = universityConfig.services?.isUnavailableApplication
  return typeof isUnavailable === 'function' ? Boolean(isUnavailable(application)) : false
}

function normalizeAllServices(bootstrap, rememberedOrder = []) {
  const layoutData = bootstrap?.layout?.data
  if (!isRecord(layoutData)) {
    return []
  }

  const portletLookup = buildPortletLookup(layoutData, bootstrap?.layoutDoc?.data)
  const serviceTabs = collectServiceSections(layoutData)
  const regularApps = []
  const favoriteOnlyApps = []
  const seenKeys = new Set()
  // The portal lists its favorites section first, which would pull every
  // favorite to the top of the full list. Read it last instead: favorites
  // listed elsewhere keep that place, and those only in the favorites
  // section get their remembered one (placeInUsualOrder).
  const sections = serviceTabs.flatMap((tab) => tab.sections)
  const orderedSections = [
    ...sections.filter((section) => !isFavoritesLikeLabel(section.title)),
    ...sections.filter((section) => isFavoritesLikeLabel(section.title)),
  ]

  for (const section of orderedSections) {
    const target = isFavoritesLikeLabel(section.title) ? favoriteOnlyApps : regularApps
    for (const service of section.services) {
      const metadata = findPortletMetadata(service, portletLookup)
      const app = normalizeServiceEntry(service, metadata, {
        portalNodeId: getPortalNodeId(service, metadata),
      })

      if (!app || isUnavailableGradeApplication(app)) {
        continue
      }

      const category = getAppCategory(app.title)
      if (category) {
        app.category = category
      }

      const key = `${getApplicationKey(app)}-${app.href}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        target.push(app)
      }
    }
  }

  return placeInUsualOrder(regularApps, favoriteOnlyApps, rememberedOrder)
}

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message.trim() : String(error).trim()

  if (!message || /<!doctype|<html/i.test(message) || message === '[object Object]') {
    return DEFAULT_ERROR_MESSAGE
  }

  return message
}

function getBootstrapErrorMessage(bootstrap) {
  const failedResponse = [bootstrap?.layout, bootstrap?.layoutDoc, bootstrap?.marketplace]
    .find((response) => response?.ok === false)

  if (!failedResponse) {
    return DEFAULT_ERROR_MESSAGE
  }

  if (failedResponse.status === 401 || failedResponse.status === 403) {
    return 'Impossible de charger les applications pour le moment'
  }

  return getErrorMessage(
    failedResponse.error
      || (typeof failedResponse.data === 'object' ? failedResponse.data?.error : '')
      || failedResponse.text
      || DEFAULT_ERROR_MESSAGE,
  )
}

function getFavoriteApplications(sections) {
  const favorites = []
  const seenKeys = new Set()

  for (const section of sections) {
    for (const application of section.applications) {
      const key = `${getApplicationKey(application)}-${application.href}`

      if (seenKeys.has(key)) {
        continue
      }

      seenKeys.add(key)
      favorites.push(application)
    }
  }

  return favorites
}

function buildAddFavoriteRequestPath(application, lastFavorite) {
  const sourceId = getFirstText(application.portalNodeId)
  const previousNodeId = getFirstText(lastFavorite?.portalNodeId) || ''

  if (!sourceId) {
    return ''
  }

  const params = new URLSearchParams({
    action: 'movePortletAjax',
    sourceId,
    previousNodeId,
    nextNodeId: '',
  })

  return `/api/layout?${params.toString()}`
}

function buildRemoveFavoriteRequestPath(application) {
  const sourceId = getFirstText(application.portalNodeId)
  const wrapperId = getFirstText(application.removeFavoriteTarget?.wrapperId)
  const nextElementId = getFirstText(application.removeFavoriteTarget?.nextElementId)

  if (!sourceId) {
    return ''
  }

  if (nextElementId) {
    const params = new URLSearchParams({
      action: 'movePortletAjax',
      sourceId,
      previousNodeId: '',
      nextNodeId: nextElementId,
    })
    return `/api/layout?${params.toString()}`
  }

  if (wrapperId) {
    const params = new URLSearchParams({
      action: 'moveElement',
      sourceID: sourceId,
      elementID: wrapperId,
      method: 'appendAfter',
    })
    return `/api/layout?${params.toString()}`
  }

  return ''
}

function removeApplicationFromSections(sections, applicationKey) {
  return sections
    .map((section) => ({
      ...section,
      applications: section.applications.filter((application) => getApplicationKey(application) !== applicationKey),
    }))
    .filter((section) => section.applications.length > 0)
}

function getUrlHostname(value) {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

const CAS_HOST = universityConfig.origins?.cas ? new URL(universityConfig.origins.cas).hostname : ''

function isCasHost(hostname) {
  return Boolean(CAS_HOST) && hostname === CAS_HOST
}

function chainTouchesCas(chain = []) {
  return chain.some((step) => {
    const currentHost = getUrlHostname(step?.url)
    const nextHost = getUrlHostname(step?.location)
    return isCasHost(currentHost) || isCasHost(nextHost)
  })
}

function shouldUseServerLaunchForTarget(href, launchDebug = null) {
  if (!href) {
    return false
  }

  if (href.startsWith('/__ent_proxy')) {
    return true
  }

  const hrefHost = getUrlHostname(href)
  if (isCasHost(hrefHost)) {
    return true
  }

  if (!launchDebug || launchDebug.degraded || launchDebug.saml) {
    return false
  }

  const chain = Array.isArray(launchDebug.chain) ? launchDebug.chain : []
  if (!chainTouchesCas(chain)) {
    return false
  }

  return /[?&]ticket=ST-/i.test(String(launchDebug.finalUrl ?? ''))
}

async function resolveLaunchTarget(application) {
  if (!application?.fname) {
    return {
      href: application?.href,
      target: application?.target,
    }
  }

  const fragmentResponse = await getPortletFragment({}, application.fname)
  const launchLink = extractLaunchLink(fragmentResponse?.text ?? '')

  return {
    href: toNavigableHref(launchLink.href) || application.href,
    target: getFirstText(launchLink.target, application.target),
  }
}

// `knownTargets` are reused as-is, so a refresh only fetches the fragments of
// applications it has never seen.
async function resolveLaunchTargets(applications, knownTargets = {}) {
  const uniqueApplications = []
  const seenKeys = new Set()

  for (const application of applications) {
    const applicationKey = getApplicationKey(application)

    if (!application?.fname || seenKeys.has(applicationKey) || knownTargets[applicationKey]) {
      continue
    }

    seenKeys.add(applicationKey)
    uniqueApplications.push([applicationKey, application])
  }

  const resolvedEntries = await Promise.all(uniqueApplications.map(async ([applicationKey, application]) => {
    try {
      return [applicationKey, await resolveLaunchTarget(application)]
    } catch {
      return [applicationKey, {
        href: application.href,
        target: application.target,
      }]
    }
  }))

  return { ...knownTargets, ...Object.fromEntries(resolvedEntries) }
}


function isPlainLeftClick(event) {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
}

function navigateToApplication({ href, target }, preparedWindow = null, options = {}) {
  const { useServerLaunch = true } = options

  if (!href) {
    return
  }

  let launchHref = href
  if (useServerLaunch) {
    if (href.startsWith('/__ent_proxy')) {
      const realUrl = ENT_ORIGIN + href.replace(/^\/__ent_proxy/, '')
      launchHref = `/__ent_auth/launch?url=${encodeURIComponent(realUrl)}`
    } else if (/^https?:\/\//i.test(href)) {
      launchHref = `/__ent_auth/launch?url=${encodeURIComponent(href)}`
    }
  }

  if (target === '_blank') {
    if (preparedWindow && !preparedWindow.closed) {
      try {
        preparedWindow.opener = null
      } catch {
        // Some browsers restrict opener writes; navigation still works without it.
      }

      preparedWindow.location.assign(launchHref)
      return
    }

    window.open(launchHref, '_blank', 'noopener,noreferrer')
    return
  }

  window.location.assign(launchHref)
}

async function copyTextToClipboard(text) {
  const content = String(text ?? '')
  if (!content) {
    throw new Error("Impossible de copier un lien vide")
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const fallbackInput = document.createElement('textarea')
  fallbackInput.value = content
  fallbackInput.setAttribute('readonly', '')
  fallbackInput.style.position = 'fixed'
  fallbackInput.style.opacity = '0'
  fallbackInput.style.pointerEvents = 'none'
  document.body.appendChild(fallbackInput)
  fallbackInput.select()
  fallbackInput.setSelectionRange(0, fallbackInput.value.length)

  const didCopy = document.execCommand('copy')
  document.body.removeChild(fallbackInput)

  if (!didCopy) {
    throw new Error("Impossible de copier le lien")
  }
}

function getContextMenuPosition(event) {
  const maxX = window.innerWidth - FAVORITES_CONTEXT_MENU_WIDTH - FAVORITES_CONTEXT_MENU_MARGIN
  const maxY = window.innerHeight - FAVORITES_CONTEXT_MENU_HEIGHT - FAVORITES_CONTEXT_MENU_MARGIN
  const x = Math.max(FAVORITES_CONTEXT_MENU_MARGIN, Math.min(event.clientX, maxX))
  const y = Math.max(FAVORITES_CONTEXT_MENU_MARGIN, Math.min(event.clientY, maxY))

  return {
    x,
    y,
    originX: `${Math.max(18, event.clientX - x)}px`,
    originY: `${Math.max(18, event.clientY - y)}px`,
  }
}

// What tells the grade service's app ("Notes IUT Lannion": ScoDoc) apart,
// whatever the list it comes from (see gradesPortalApp.js).
const GRADES_PORTAL_OPTIONS = {
  gradesOrigin: getGradesOrigin(universityConfig.grades?.serviceUrl),
  launchPath: `${ENT_AUTH_PREFIX}/launch`,
  casOrigin: universityConfig.origins?.cas ?? '',
}

// Likewise for the planning service's app (« Emplois du temps », see
// planningPortalApp.js), the demo's included.
const PLANNING_PORTAL_OPTIONS = {
  planningOrigin: getPlanningOrigin(universityConfig.planning?.serviceUrl),
  appKeys: [DEMO_PLANNING_APP_FNAME],
  launchPath: `${ENT_AUTH_PREFIX}/launch`,
  casOrigin: universityConfig.origins?.cas ?? '',
}

// What an in-app tile says it opens (aria-description).
const IN_APP_PAGE_DESCRIPTIONS = {
  grades: 'Ouvre Mes notes',
  planning: 'Ouvre le planning',
}

// `onOpenGradesPage`: the app's own grades page, passed only while the
// student has it (called with 'tile', its page_viewed source). With it, the grade service's app opens that page instead of
// ScoDoc from every tile; a modified or middle click and « Ouvrir dans un
// nouvel onglet » still open ScoDoc, its link stays on the tile for that.
// `onOpenPlanningPage`: the same for the planning service's app and the
// in-app Planning page, passed only while the student has it.
function AvailableApplications({
  establishment = null,
  canUseServerLaunch = true,
  favoritesPortalTarget = null,
  showDescriptions = false,
  onOpenGradesPage = null,
  onOpenPlanningPage = null,
}) {
  const [viewState, setViewState] = useState({
    status: 'loading',
    source: 'none',
    rawCount: 0,
    sections: [],
    error: '',
  })
  const [reloadKey, setReloadKey] = useState(0)
  const [launchTargets, setLaunchTargets] = useState({})
  const [launchBehaviors, setLaunchBehaviors] = useState({})
  const [launchingKeys, setLaunchingKeys] = useState({})
  const [exitingFavoriteKeys, setExitingFavoriteKeys] = useState({})
  // Favorite changes show up right away; the ENT request runs behind them and
  // is rolled back if it fails. Added apps wait here until a portal refresh
  // lists them, removed ones stay hidden until it stops listing them.
  const [pendingFavoriteAdds, setPendingFavoriteAdds] = useState({})
  const [pendingFavoriteRemovals, setPendingFavoriteRemovals] = useState({})
  const [favoriteActionState, setFavoriteActionState] = useState({
    removingKey: '',
    error: '',
  })
  const [contextMenuState, setContextMenuState] = useState({
    open: false,
    x: 0,
    y: 0,
    originX: '24px',
    originY: '24px',
    application: null,
    source: 'favorite',
  })
  const [allServices, setAllServices] = useState([])
  const [appIcons, setAppIcons] = useState(getCachedAppIcons)
  const [loadedIconKey, setLoadedIconKey] = useState('')
  const [localPins, setLocalPins] = useState(loadLocalPins)
  const [orderedFavorites, setOrderedFavorites] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const launchRequestsRef = useRef(new Map())
  const launchBehaviorRequestsRef = useRef(new Map())
  const removalTimeoutsRef = useRef(new Map())
  // Removals asked for while the add is still unconfirmed: the remove request
  // needs the layout ids only the refreshed portal gives.
  const deferredRemovalsRef = useRef(new Set())
  const launchTargetsRef = useRef({})
  const isMountedRef = useRef(true)
  const contextMenuRef = useRef(null)
  const dragRef = useRef({ index: -1, didDrag: false })
  const favoritesRowRef = useRef(null)
  const flipRectsRef = useRef(new Map())

  const entFavoriteApplications = useMemo(
    () => getFavoriteApplications(viewState.sections),
    [viewState.sections],
  )
  const favoriteApplications = useMemo(() => {
    const entFavorites = entFavoriteApplications
      .filter((application) => !isUnavailableGradeApplication(application))
    const entKeys = new Set(entFavorites.map(getApplicationKey))
    const addedFavorites = Object.values(pendingFavoriteAdds)
      .filter((application) => !entKeys.has(getApplicationKey(application)))
    const pinnedLocalServices = allServices.filter(
      (service) => isLocalService(service) && localPins.includes(getApplicationKey(service)),
    )
    return [...entFavorites, ...addedFavorites, ...pinnedLocalServices]
      .filter((application) => !pendingFavoriteRemovals[getApplicationKey(application)])
  }, [entFavoriteApplications, pendingFavoriteAdds, pendingFavoriteRemovals, allServices, localPins])
  const visibleServices = useMemo(() => {
    const pinnedLocalKeys = new Set(localPins)
    return allServices.filter(
      (service) => !isLocalService(service) || !pinnedLocalKeys.has(getApplicationKey(service)),
    )
  }, [allServices, localPins])
  const categories = useMemo(() => {
    const present = new Set(visibleServices.map((s) => s.category).filter(Boolean))
    return APP_CATEGORIES.map((c) => c.label).filter((label) => present.has(label))
  }, [visibleServices])
  const filteredServices = useMemo(() => {
    let services = visibleServices
    if (selectedCategory) {
      services = services.filter((s) => s.category === selectedCategory)
    }
    return searchApps(services, searchQuery)
  }, [visibleServices, searchQuery, selectedCategory])
  const highlightedFavoriteKeys = useMemo(() => {
    if (!searchQuery.trim()) return new Set()
    return new Set(
      orderedFavorites
        .filter((favorite) => scoreAppSearch(favorite, searchQuery) > 0)
        .map(getApplicationKey)
    )
  }, [searchQuery, orderedFavorites])
  const favoritesByKey = useMemo(
    () => new Map(orderedFavorites.map((favorite) => [getApplicationKey(favorite), favorite])),
    [orderedFavorites],
  )
  const shouldShowFavoriteRow = viewState.status === 'ready' && orderedFavorites.length > 0
  const shouldHideFavoritesSection = viewState.status === 'empty'
    || (viewState.status === 'ready' && favoriteApplications.length === 0)

  // Iconify fetches icons on first use: preload every assigned glyph and only
  // swap a tile's letter for its icon once that icon is in.
  const appIconNames = useMemo(
    () => [...new Set(Object.values(appIcons.icons).map((entry) => entry?.icon).filter(Boolean))].sort(),
    [appIcons],
  )
  const appIconNamesKey = appIconNames.join(',')
  const tileAssignments = useMemo(() => {
    const loadedNames = new Set(loadedIconKey.split(',').filter(Boolean))
    const assignments = new Map()
    for (const [applicationKey, entry] of Object.entries(appIcons.icons)) {
      const colors = appIcons.palette[entry?.color]
      if (entry?.icon && colors?.light && colors?.dark) {
        assignments.set(applicationKey, {
          icon: entry.icon,
          isReady: loadedNames.has(entry.icon),
          colors,
        })
      }
    }
    return assignments
  }, [appIcons, loadedIconKey])

  useEffect(() => {
    const names = appIconNamesKey.split(',').filter(Boolean)
    const syncLoaded = () => setLoadedIconKey(names.filter((name) => iconLoaded(name)).join(','))
    syncLoaded()
    if (names.every((name) => iconLoaded(name))) {
      return undefined
    }

    return loadIcons(names, syncLoaded)
  }, [appIconNamesKey])

  useEffect(() => {
    setOrderedFavorites(applyStoredOrder(favoriteApplications))
  }, [favoriteApplications])

  // Once the portal reflects a change, the optimistic entry is no longer needed.
  // A removal deferred until its add was confirmed goes out now.
  useEffect(() => {
    const entByKey = new Map(entFavoriteApplications.map((application) => [getApplicationKey(application), application]))
    setPendingFavoriteAdds((current) => {
      const keys = Object.keys(current).filter((key) => entByKey.has(key))
      if (keys.length === 0) return current
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
    setPendingFavoriteRemovals((current) => {
      const keys = Object.keys(current).filter((key) => !entByKey.has(key) && !deferredRemovalsRef.current.has(key))
      if (keys.length === 0) return current
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
    for (const key of [...deferredRemovalsRef.current]) {
      const confirmed = entByKey.get(key)
      if (confirmed) {
        deferredRemovalsRef.current.delete(key)
        void sendFavoriteRemoval(confirmed)
      }
    }
    // sendFavoriteRemoval only uses setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entFavoriteApplications])

  useEffect(() => {
    const launchRequests = launchRequestsRef.current
    const launchBehaviorRequests = launchBehaviorRequestsRef.current
    const removalTimeouts = removalTimeoutsRef.current
    // Set again on mount: StrictMode runs this cleanup once in development,
    // which used to leave the flag off and drop every favorite update.
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      launchRequests.clear()
      launchBehaviorRequests.clear()
      for (const timeoutId of removalTimeouts.values()) {
        window.clearTimeout(timeoutId)
      }
      removalTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    function handlePageShow() {
      setLaunchingKeys({})
      setExitingFavoriteKeys({})
      setFavoriteActionState({
        removingKey: '',
        error: '',
      })
      setContextMenuState({
        open: false,
        x: 0,
        y: 0,
        originX: '24px',
        originY: '24px',
        application: null,
      })
    }

    window.addEventListener('pageshow', handlePageShow)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  useEffect(() => {
    if (!contextMenuState.open) {
      return undefined
    }

    function closeContextMenu() {
      setContextMenuState({
        open: false,
        x: 0,
        y: 0,
        originX: '24px',
        originY: '24px',
        application: null,
        source: 'favorite',
      })
    }

    function handlePointerDown(event) {
      if (contextMenuRef.current?.contains(event.target)) {
        return
      }

      closeContextMenu()
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    window.addEventListener('blur', closeContextMenu)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeContextMenu)
      window.removeEventListener('scroll', closeContextMenu, true)
      window.removeEventListener('blur', closeContextMenu)
    }
  }, [contextMenuState.open])

  useEffect(() => {
    let isCancelled = false

    async function hydrateApplications() {
      try {
        const bootstrap = await getPortalBootstrap()
        if (isCancelled) {
          return
        }

        const services = normalizeAllServices(bootstrap, loadAppsOrder())
        const sections = LOCAL_FAVORITES
          ? buildLocalFavoriteSections(services, loadLocalFavorites())
          : normalizeBootstrapSections(bootstrap)
        saveAppsOrder(services)

        // Tile icons come in the background: the grid never waits for them.
        void fetchAppIcons([
          ...getFavoriteApplications(sections.sections),
          ...services,
          ...(universityConfig.establishments?.byId?.[establishment]?.extraServices ?? []),
        ]).then((assignments) => {
          // Shared by the whole university, so still right after a refresh.
          if (assignments) {
            setAppIcons(assignments)
          }
        })

        const nextLaunchTargets = await resolveLaunchTargets([
          ...getFavoriteApplications(sections.sections),
          ...services,
        ].filter((application) => !isUnavailableGradeApplication(application)), launchTargetsRef.current)
        if (isCancelled) {
          return
        }

        // Establishment shortcuts go first. When the portal already lists one
        // (same resolved host), promote the portal entry instead of duplicating it.
        const getServiceHost = (service) => getUrlHostname(nextLaunchTargets[getApplicationKey(service)]?.href || service.href)
        const extraServices = universityConfig.establishments?.byId?.[establishment]?.extraServices ?? []
        const pinnedServices = extraServices.map((extraService) => {
          const extraHost = getUrlHostname(extraService.href)
          const portalIndex = extraHost ? services.findIndex((service) => getServiceHost(service) === extraHost) : -1
          if (portalIndex !== -1) {
            return services.splice(portalIndex, 1)[0]
          }
          return {
            ...extraService,
            href: toNavigableHref(extraService.href),
          }
        })
        services.unshift(...pinnedServices)

        launchTargetsRef.current = nextLaunchTargets
        setLaunchTargets(nextLaunchTargets)
        setAllServices(services)

        if (sections.sections.length > 0) {
          setFavoriteActionState((current) => ({ ...current, error: '' }))
          setViewState({
            status: 'ready',
            source: sections.source,
            rawCount: sections.rawCount,
            sections: sections.sections,
            error: '',
          })
          return
        }

        const hasSuccessfulResponse = [bootstrap.layout, bootstrap.layoutDoc, bootstrap.marketplace]
          .some((response) => response?.ok)

        setViewState({
          status: hasSuccessfulResponse ? 'empty' : 'error',
          source: sections.source,
          rawCount: sections.rawCount,
          sections: [],
          error: hasSuccessfulResponse ? '' : getBootstrapErrorMessage(bootstrap),
        })
        if (hasSuccessfulResponse) {
          setFavoriteActionState((current) => ({ ...current, error: '' }))
        }
      } catch (error) {
        if (isCancelled) {
          return
        }

        setViewState({
          status: 'error',
          source: 'none',
          rawCount: 0,
          sections: [],
          error: getErrorMessage(error),
        })
      }
    }

    void hydrateApplications()

    return () => {
      isCancelled = true
    }
  }, [reloadKey, establishment])

  async function resolveApplicationLaunch(application) {
    const launchKey = getApplicationKey(application)
    const cachedLaunch = launchTargets[launchKey]
    if (!application.fname || cachedLaunch) {
      return cachedLaunch ?? {
        href: application.href,
        target: application.target,
      }
    }

    const existingRequest = launchRequestsRef.current.get(launchKey)
    if (existingRequest) {
      return existingRequest
    }

    const request = resolveLaunchTarget(application)
      .then((resolvedLaunch) => {
        if (isMountedRef.current) {
          setLaunchTargets((current) => (
            current[launchKey]
              ? current
              : { ...current, [launchKey]: resolvedLaunch }
          ))
        }

        return resolvedLaunch
      })
      .catch(() => ({
        href: application.href,
        target: application.target,
      }))
      .finally(() => {
        launchRequestsRef.current.delete(launchKey)
      })

    launchRequestsRef.current.set(launchKey, request)
    return request
  }

  async function resolveApplicationLaunchBehavior(application, launch = null) {
    const launchKey = getApplicationKey(application)
    const cachedBehavior = launchBehaviors[launchKey]
    if (typeof cachedBehavior === 'boolean') {
      return cachedBehavior
    }

    const existingRequest = launchBehaviorRequestsRef.current.get(launchKey)
    if (existingRequest) {
      return existingRequest
    }

    const resolvedLaunch = launch ?? await resolveApplicationLaunch(application)
    const href = resolvedLaunch?.href || application?.href || ''
    if (!/^https?:\/\//i.test(href)) {
      const fallbackBehavior = shouldUseServerLaunchForTarget(href, null)

      if (isMountedRef.current) {
        setLaunchBehaviors((current) => (
          launchKey in current
            ? current
            : { ...current, [launchKey]: fallbackBehavior }
        ))
      }

      return fallbackBehavior
    }

    const request = fetch(`/__ent_auth/launch-preview?url=${encodeURIComponent(href)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        const previewPayload = await response.json().catch(() => null)

        if (typeof previewPayload?.useServerLaunch === 'boolean') {
          return previewPayload.useServerLaunch
        }

        return shouldUseServerLaunchForTarget(href, previewPayload)
      })
      .catch(() => shouldUseServerLaunchForTarget(href, null))
      .then((shouldUseServerLaunch) => {
        if (isMountedRef.current) {
          setLaunchBehaviors((current) => (
            launchKey in current
              ? current
              : { ...current, [launchKey]: shouldUseServerLaunch }
          ))
        }

        return shouldUseServerLaunch
      })
      .finally(() => {
        launchBehaviorRequestsRef.current.delete(launchKey)
      })

    launchBehaviorRequestsRef.current.set(launchKey, request)
    return request
  }

  function warmApplicationLaunch(application) {
    if (!application.fname) {
      return
    }

    void resolveApplicationLaunch(application)
  }

  function clearLaunchingState(launchKey) {
    setLaunchingKeys((current) => {
      if (!(launchKey in current)) {
        return current
      }

      const nextState = { ...current }
      delete nextState[launchKey]
      return nextState
    })
  }

  function closeContextMenu() {
    setContextMenuState({
      open: false,
      x: 0,
      y: 0,
      originX: '24px',
      originY: '24px',
      application: null,
      source: 'favorite',
    })
  }

  function handleFavoriteContextMenu(event, application, source = 'favorite') {
    event.preventDefault()

    const { x, y, originX, originY } = getContextMenuPosition(event)
    setFavoriteActionState((current) => ({ ...current, error: '' }))
    setContextMenuState({
      open: true,
      x,
      y,
      originX,
      originY,
      application,
      source,
    })
  }

  function snapshotPositions() {
    const row = favoritesRowRef.current
    if (!row) return
    flipRectsRef.current.clear()
    for (const child of row.children) {
      const id = child.getAttribute('data-app-id')
      if (id) {
        flipRectsRef.current.set(id, child.getBoundingClientRect())
      }
    }
  }

  const animateFlip = useCallback(() => {
    const row = favoritesRowRef.current
    if (!row || flipRectsRef.current.size === 0) return

    for (const child of row.children) {
      const id = child.getAttribute('data-app-id')
      const oldRect = flipRectsRef.current.get(id)
      if (!oldRect) continue

      const newRect = child.getBoundingClientRect()
      const dx = oldRect.left - newRect.left
      const dy = oldRect.top - newRect.top

      if (dx === 0 && dy === 0) continue

      child.style.transition = 'none'
      child.style.transform = `translate(${dx}px, ${dy}px)`

      requestAnimationFrame(() => {
        child.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'
        child.style.transform = ''
        child.addEventListener('transitionend', () => {
          child.style.transition = ''
        }, { once: true })
      })
    }

    flipRectsRef.current.clear()
  }, [])

  useLayoutEffect(() => {
    animateFlip()
  }, [orderedFavorites, animateFlip])

  function handleDragStart(event, index) {
    dragRef.current = { index, didDrag: false }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setIsDragging(true)
  }

  function handleDragOver(event, index) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    dragRef.current.didDrag = true

    const fromIndex = dragRef.current.index
    if (fromIndex === -1 || fromIndex === index) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const pastMid = fromIndex < index
      ? event.clientX > midX
      : event.clientX < midX

    if (!pastMid) {
      return
    }

    snapshotPositions()

    setOrderedFavorites((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    dragRef.current.index = index
  }

  function handleDragEnd() {
    dragRef.current.index = -1
    setIsDragging(false)
    setOrderedFavorites((current) => {
      saveFavoritesOrder(current)
      return current
    })
  }

  function handleClickCapture(event) {
    if (dragRef.current.didDrag) {
      event.preventDefault()
      dragRef.current.didDrag = false
    }
  }

  async function launchApplicationFromAction(application, options = {}) {
    const launchKey = getApplicationKey(application)
    const { targetOverride = null, preparedWindow = null } = options
    const resolvedLaunch = launchTargets[launchKey]

    if (launchingKeys[launchKey]) {
      if (preparedWindow && !preparedWindow.closed) {
        preparedWindow.close()
      }
      return
    }

    setLaunchingKeys((current) => ({ ...current, [launchKey]: true }))

    try {
      const nextLaunch = resolvedLaunch ?? await resolveApplicationLaunch(application)
      const shouldUseServerLaunch = canUseServerLaunch
        ? await resolveApplicationLaunchBehavior(application, nextLaunch)
        : false
      const effectiveLaunch = targetOverride
        ? { ...nextLaunch, target: targetOverride }
        : nextLaunch

      clearLaunchingState(launchKey)
      navigateToApplication(effectiveLaunch, preparedWindow, {
        useServerLaunch: shouldUseServerLaunch,
      })
    } catch {
      clearLaunchingState(launchKey)
      if (preparedWindow && !preparedWindow.closed) {
        preparedWindow.close()
      }
      navigateToApplication({
        href: resolvedLaunch?.href || application.href,
        target: targetOverride || resolvedLaunch?.target || application.target,
      }, null, {
        useServerLaunch: false,
      })
    } finally {
      if (isMountedRef.current) {
        clearLaunchingState(launchKey)
      }
    }
  }

  async function handleOpenApplicationInNewTab(application) {
    trackApplicationOpened(application, contextMenuState.source === 'all' ? 'grid' : 'favorites')
    setFavoriteActionState((current) => ({ ...current, error: '' }))
    closeContextMenu()

    const preparedWindow = window.open('about:blank', '_blank')
    if (!preparedWindow) {
      setFavoriteActionState((current) => ({
        ...current,
        error: "Impossible d'ouvrir un nouvel onglet pour le moment",
      }))
      return
    }

    await launchApplicationFromAction(application, {
      targetOverride: '_blank',
      preparedWindow,
    })
  }

  async function handleCopyApplicationLink(application) {
    setFavoriteActionState((current) => ({ ...current, error: '' }))

    try {
      const nextLaunch = await resolveApplicationLaunch(application)
      const href = nextLaunch?.href || application?.href || ''
      await copyTextToClipboard(href)
      closeContextMenu()
    } catch (error) {
      setFavoriteActionState((current) => ({
        ...current,
        error: getErrorMessage(error),
      }))
      closeContextMenu()
    }
  }

  function setPendingFavorite(setter, applicationKey, value) {
    setter((current) => {
      if (!value && !current[applicationKey]) return current
      const next = { ...current }
      if (value) next[applicationKey] = value
      else delete next[applicationKey]
      return next
    })
  }

  function postFavoriteLayoutChange(requestPath) {
    return requestEnt(requestPath, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: ENT_ORIGIN,
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
  }

  function cancelFavoriteRemoval(applicationKey) {
    window.clearTimeout(removalTimeoutsRef.current.get(applicationKey))
    removalTimeoutsRef.current.delete(applicationKey)
    deferredRemovalsRef.current.delete(applicationKey)
    setPendingFavorite(setExitingFavoriteKeys, applicationKey, null)
    setPendingFavorite(setPendingFavoriteRemovals, applicationKey, null)
  }

  // Sends the remove request for a favorite already leaving the row, and puts
  // it back if the ENT refuses. `exitAnimation` lets the tile finish animating
  // before a fast reply drops it from the list.
  async function sendFavoriteRemoval(application, exitAnimation = Promise.resolve()) {
    const applicationKey = getApplicationKey(application)

    try {
      if (LOCAL_FAVORITES) {
        saveLocalFavorites(loadLocalFavorites().filter((key) => key !== applicationKey))
      } else {
        const requestPath = buildRemoveFavoriteRequestPath(application)
        if (!requestPath) {
          throw new Error('Impossible de retirer ce favori pour le moment')
        }
        const response = await postFavoriteLayoutChange(requestPath)
        if (!response.ok) {
          throw new Error(
            (typeof response.data === 'object' ? response.data?.error : '')
            || response.text
            || 'Impossible de retirer ce favori pour le moment',
          )
        }
      }
      await exitAnimation
      if (!isMountedRef.current) return
      setViewState((current) => {
        const nextSections = removeApplicationFromSections(current.sections, applicationKey)
        return {
          ...current,
          rawCount: Math.max(0, current.rawCount - 1),
          sections: nextSections,
          status: nextSections.length > 0 ? 'ready' : 'empty',
        }
      })
      setReloadKey((current) => current + 1)
    } catch (error) {
      if (!isMountedRef.current) return
      cancelFavoriteRemoval(applicationKey)
      setFavoriteActionState({ removingKey: '', error: getErrorMessage(error) })
    }
  }

  function handleUnfavorite(application) {
    const applicationKey = getApplicationKey(application)
    closeContextMenu()

    if (isLocalService(application)) {
      setLocalPins((current) => {
        const next = current.filter((key) => key !== applicationKey)
        saveLocalPins(next)
        return next
      })
      return
    }

    setFavoriteActionState({ removingKey: '', error: '' })
    // The star empties right away; the tile plays its exit animation, then
    // leaves the row.
    setExitingFavoriteKeys((current) => ({ ...current, [applicationKey]: true }))
    window.clearTimeout(removalTimeoutsRef.current.get(applicationKey))
    removalTimeoutsRef.current.set(applicationKey, window.setTimeout(() => {
      removalTimeoutsRef.current.delete(applicationKey)
      if (!isMountedRef.current) return
      setPendingFavorite(setPendingFavoriteRemovals, applicationKey, true)
      setPendingFavorite(setExitingFavoriteKeys, applicationKey, null)
    }, FAVORITE_REMOVAL_ANIMATION_MS))

    const isConfirmed = entFavoriteApplications.some((favorite) => getApplicationKey(favorite) === applicationKey)
    if (!isConfirmed) {
      deferredRemovalsRef.current.add(applicationKey)
      return
    }

    void sendFavoriteRemoval(
      application,
      new Promise((resolve) => window.setTimeout(resolve, FAVORITE_REMOVAL_ANIMATION_MS)),
    )
  }

  async function handleAddFavorite(application) {
    const applicationKey = getApplicationKey(application)
    closeContextMenu()

    if (isLocalService(application)) {
      setLocalPins((current) => {
        if (current.includes(applicationKey)) return current
        const next = [...current, applicationKey]
        saveLocalPins(next)
        return next
      })
      return
    }

    // Undo of a removal that hasn't gone out yet: just show it again.
    if (deferredRemovalsRef.current.has(applicationKey)) {
      cancelFavoriteRemoval(applicationKey)
      return
    }

    // Stored in this browser: the favourite is confirmed at once.
    if (LOCAL_FAVORITES) {
      setFavoriteActionState({ removingKey: '', error: '' })
      cancelFavoriteRemoval(applicationKey)
      const keys = loadLocalFavorites()
      const nextKeys = keys.includes(applicationKey) ? keys : [...keys, applicationKey]
      saveLocalFavorites(nextKeys)
      const local = buildLocalFavoriteSections(allServices, nextKeys)
      setViewState((current) => ({
        ...current,
        ...local,
        status: local.sections.length > 0 ? 'ready' : 'empty',
        error: '',
      }))
      return
    }

    const lastEntFavorite = orderedFavorites.filter((f) => !isLocalService(f)).pop()
    const requestPath = buildAddFavoriteRequestPath(application, lastEntFavorite)

    if (!requestPath) {
      setFavoriteActionState({
        removingKey: '',
        error: "Impossible d'ajouter ce favori pour le moment",
      })
      return
    }

    setFavoriteActionState({ removingKey: '', error: '' })
    cancelFavoriteRemoval(applicationKey)
    setPendingFavorite(setPendingFavoriteAdds, applicationKey, application)

    try {
      const response = await postFavoriteLayoutChange(requestPath)
      if (!response.ok) {
        throw new Error("Impossible d'ajouter ce favori pour le moment")
      }
      if (!isMountedRef.current) return
      setReloadKey((current) => current + 1)
    } catch (error) {
      if (!isMountedRef.current) return
      cancelFavoriteRemoval(applicationKey)
      setPendingFavorite(setPendingFavoriteAdds, applicationKey, null)
      setFavoriteActionState({ removingKey: '', error: getErrorMessage(error) })
    }
  }

  // The grade service's app while the student has « Mes notes ». Checks the
  // resolved launch link too: the portal's own entry for ScoDoc only links
  // to the ENT.
  function opensGradesPage(application) {
    return opensGradesPageInApp(application, {
      ...GRADES_PORTAL_OPTIONS,
      hasGradesPage: Boolean(onOpenGradesPage),
      resolvedHref: launchTargets[getApplicationKey(application)]?.href,
      base: window.location.href,
    })
  }

  // The planning service's app while the student has the Planning page,
  // checked the same way.
  function opensPlanningPage(application) {
    return opensPlanningPageInApp(application, {
      ...PLANNING_PORTAL_OPTIONS,
      hasPlanningPage: Boolean(onOpenPlanningPage),
      resolvedHref: launchTargets[getApplicationKey(application)]?.href,
      base: window.location.href,
    })
  }

  // The app's own page a tile opens instead of its site, or null.
  function getInAppPage(application) {
    if (opensGradesPage(application)) return 'grades'
    if (opensPlanningPage(application)) return 'planning'
    return null
  }

  async function handleApplicationClick(event, application, source) {
    // Modified clicks still open the app (natively, in a new tab), ScoDoc
    // and the planning service included: they don't count as opening the
    // app's own page.
    const plainClick = isPlainLeftClick(event)
    const inAppPage = plainClick ? getInAppPage(application) : null
    trackApplicationOpened(application, source, { inApp: Boolean(inAppPage) })

    if (!plainClick) {
      return
    }

    if (inAppPage) {
      event.preventDefault()
      if (inAppPage === 'grades') {
        onOpenGradesPage('tile')
      } else {
        onOpenPlanningPage('tile')
      }
      return
    }

    if (!application.fname) {
      return
    }

    event.preventDefault()

    const launchKey = getApplicationKey(application)
    const resolvedLaunch = launchTargets[launchKey]
    const preparedWindow = (resolvedLaunch?.target ?? application.target) === '_blank'
      ? window.open('about:blank', '_blank')
      : null

    await launchApplicationFromAction(application, { preparedWindow })
  }

  function handleRetry() {
    setViewState((current) => ({
      ...current,
      status: 'loading',
      error: '',
    }))
    setFavoriteActionState({
      removingKey: '',
      error: '',
    })
    setReloadKey((current) => current + 1)
  }

  const isSidebarFavorites = Boolean(favoritesPortalTarget)
  const displayedFavorites = isSidebarFavorites
    ? orderedFavorites.slice(0, SIDEBAR_FAVORITES_LIMIT)
    : orderedFavorites
  const shimmerClassName = 'bg-[linear-gradient(90deg,var(--color-bg-muted)_0%,var(--color-bg-subtle)_50%,var(--color-bg-muted)_100%)] bg-[length:200%_100%] animate-shimmer'
  // Radii are concentric: item radius = icon radius + item padding.
  // min-w-0: as a grid item the list would otherwise grow to its longest
  // title and push past the sidebar instead of letting it end in "…".
  const favoriteListClassName = isSidebarFavorites
    ? 'flex flex-col gap-0.5 min-w-0'
    : 'flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:gap-1 max-md:overflow-x-auto max-md:overflow-y-hidden max-md:-mx-3 max-md:px-3 favorites-scroll-hide'
  const favoriteItemClassName = isSidebarFavorites
    ? 'flex items-center gap-2.5 w-full p-1 corners-[13px]'
    : 'inline-flex items-center gap-2.5 max-w-full p-[5px] pr-3.5 corners-[14px] max-md:flex-col max-md:gap-1.5 max-md:w-[76px] max-md:p-1.5 max-md:corners-[20px] max-md:shrink-0'
  const favoriteIconClassName = isSidebarFavorites
    ? 'w-8 h-8 corners-[9px]'
    : 'w-8 h-8 corners-[9px] max-md:w-[52px] max-md:h-[52px] max-md:corners-[14px]'
  const favoriteTitleClassName = isSidebarFavorites
    ? 'flex-1 min-w-0 text-[14px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis'
    : 'min-w-0 text-[14px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-md:w-full max-md:text-[12px] max-md:text-center max-md:whitespace-normal max-md:line-clamp-2'

  const favoritesSectionContent = shouldHideFavoritesSection ? null : (
    <section className="favorites-bar grid gap-2 relative text-brand" aria-labelledby="favorites-strip-title">
      <div className="flex items-center gap-[5px]">
        <Icon icon="carbon:star" className="w-[17px] h-[17px] text-brand shrink-0" aria-hidden="true" />
        <h2 className="m-0 font-body text-base font-medium tracking-normal leading-[1.06]" id="favorites-strip-title">Favoris</h2>
        {shouldShowFavoriteRow ? (
          <span className="ml-0.5 text-[13px] font-medium leading-none text-text-muted tabular-nums">
            {isSidebarFavorites && displayedFavorites.length >= SIDEBAR_FAVORITES_LIMIT
              ? `${SIDEBAR_FAVORITES_LIMIT}/${SIDEBAR_FAVORITES_LIMIT}`
              : displayedFavorites.length}
          </span>
        ) : null}
      </div>

      {viewState.status === 'loading' ? (
        <div className={favoriteListClassName} role="status" aria-live="polite" aria-label="Chargement des favoris">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`loading-favorite-${index}`} className={favoriteItemClassName} aria-hidden="true">
              <span className={`badge-placeholder shrink-0 ${favoriteIconClassName} ${shimmerClassName}`} />
              <span className={`text-placeholder-shimmer h-3 rounded-full ${isSidebarFavorites ? 'w-[55%]' : 'w-[80px] max-md:w-[48px] max-md:h-2.5'} ${shimmerClassName}`} />
            </div>
          ))}
        </div>
      ) : null}

      {viewState.status === 'error' ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2">
            <Icon icon="carbon:warning-filled" className="w-[18px] h-[18px] text-error shrink-0" aria-hidden="true" />
            <p className="m-0 text-sm font-medium leading-[1.3] text-text-secondary font-body">{viewState.error}</p>
          </div>

          <button type="button" className="min-h-[34px] px-[14px] border border-border rounded-full bg-bg text-brand font-inherit text-sm font-semibold hover:bg-bg-subtle" onClick={handleRetry}>
            Réessayer
          </button>
        </div>
      ) : null}

      {shouldShowFavoriteRow ? (
        <div className={`${favoriteListClassName} ${isDragging ? 'is-dragging' : ''}`} ref={favoritesRowRef}>
          {displayedFavorites.map((application, index) => {
            const applicationKey = getApplicationKey(application)
            const resolvedLaunch = launchTargets[applicationKey]
            const href = resolvedLaunch?.href || application.href
            // In-app tiles drop `target` (a new tab a plain click doesn't
            // open; a modified click still does, natively, hence `rel`) and
            // say where they lead instead.
            const inAppPage = getInAppPage(application)
            const opensInApp = Boolean(inAppPage)
            const target = opensInApp ? '' : resolvedLaunch?.target || application.target
            const isLaunching = Boolean(launchingKeys[applicationKey])
            const isRemovingFavorite = favoriteActionState.removingKey === applicationKey
            const isExitingFavorite = Boolean(exitingFavoriteKeys[applicationKey])
            const isContextOpen = contextMenuState.open
              && getApplicationKey(contextMenuState.application ?? {}) === applicationKey
            const isSearchHighlighted = highlightedFavoriteKeys.has(applicationKey)
            return (
              <a
                key={application.id}
                data-app-id={application.id}
                className={`favorites-strip-item app-card group relative border text-inherit no-underline min-w-0 cursor-pointer focus-visible:outline-none ${favoriteItemClassName} ${isLaunching ? 'pointer-events-none cursor-progress' : ''} ${(isRemovingFavorite || isExitingFavorite) ? 'pointer-events-none opacity-70' : ''} ${isExitingFavorite ? 'animate-favorite-remove' : ''} ${isContextOpen ? 'app-card--active' : ''} ${isSearchHighlighted ? 'favorite-search-highlight' : ''}`}
                href={href}
                target={target || undefined}
                rel={target === '_blank' || opensInApp ? 'noreferrer' : undefined}
                aria-label={`Ouvrir ${application.title}`}
                aria-description={opensInApp ? IN_APP_PAGE_DESCRIPTIONS[inAppPage] : undefined}
                aria-busy={isLaunching || isRemovingFavorite || isExitingFavorite}
                draggable="true"
                onDragStart={(event) => handleDragStart(event, index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDragEnd={handleDragEnd}
                onClickCapture={handleClickCapture}
                onMouseEnter={() => warmApplicationLaunch(application)}
                onFocus={() => warmApplicationLaunch(application)}
                onContextMenu={(event) => handleFavoriteContextMenu(event, application, 'favorite')}
                onClick={(event) => void handleApplicationClick(event, application, 'favorites')}
              >
                <AppIcon
                  title={application.title}
                  assignment={tileAssignments.get(applicationKey)}
                  isLaunching={isLaunching}
                  className={favoriteIconClassName}
                  letterClassName="text-sm max-md:text-base"
                />
                <span className={favoriteTitleClassName}>
                  {isLaunching ? 'Ouverture…' : application.title}
                </span>
                {isSidebarFavorites ? (
                  <button
                    type="button"
                    className="app-card-action flex items-center justify-center w-7 h-7 rounded-full border-none bg-transparent text-text-muted opacity-0 cursor-pointer transition-[opacity,background-color,color] duration-[120ms] ease-in-out shrink-0 group-hover:opacity-70 group-focus-visible:opacity-70 focus-visible:opacity-100"
                    aria-label={`Retirer ${application.title} des favoris`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void handleUnfavorite(application)
                    }}
                  >
                    <Icon icon="carbon:star-filled" className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : null}
              </a>
            )
          })}
        </div>
      ) : null}

      {favoriteActionState.error ? (
        <p className="m-0 text-sm font-medium leading-[1.3] text-text-secondary font-body">{favoriteActionState.error}</p>
      ) : null}
    </section>
  )

  return (
    <>
      {favoritesPortalTarget && typeof document !== 'undefined'
        ? createPortal(favoritesSectionContent, favoritesPortalTarget)
        : favoritesSectionContent}

      {visibleServices.length > 0 ? (
        <div className={`grid gap-3 text-brand${favoritesPortalTarget || !favoritesSectionContent ? '' : ' mt-5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-[5px]">
              <Icon icon="carbon:app-switcher" className="w-[17px] h-[17px] text-brand shrink-0" aria-hidden="true" />
              <span className="text-base font-medium leading-[1.06]">Toutes les applications</span>
            </div>
            <div className="relative">
              <Icon icon="carbon:search" className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-muted pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="app-search-input w-[180px] h-[36px] pl-8 pr-3 border border-border rounded-full bg-widget-bg text-text text-sm font-body leading-none placeholder:text-text-muted transition-[width,border-color] duration-200 focus:w-[240px] focus:border-text-muted max-sm:w-[140px] max-sm:focus:w-[180px]"
              />
            </div>
          </div>
          {SHOW_CATEGORY_FILTERS && categories.length > 1 ? (
            <div className="flex items-center gap-2 flex-wrap max-md:flex-nowrap max-md:overflow-x-auto max-md:-mx-3 max-md:px-3 favorites-scroll-hide">
              <button
                type="button"
                className={`min-h-[34px] px-[14px] border rounded-full font-inherit text-sm font-semibold transition-[background-color,border-color,color] duration-[120ms] ${selectedCategory === null ? 'border-brand bg-brand text-bg' : 'border-border bg-bg text-brand hover:bg-bg-subtle'}`}
                onClick={() => setSelectedCategory(null)}
              >
                Tout
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`min-h-[34px] px-[14px] border rounded-full font-inherit text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color] duration-[120ms] ${selectedCategory === category ? 'border-brand bg-brand text-bg' : 'border-border bg-bg text-brand hover:bg-bg-subtle'}`}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-1.5 max-md:grid-cols-1 max-md:gap-1">
            {filteredServices.map((service, index) => {
              const applicationKey = getApplicationKey(service)
              const resolvedLaunch = launchTargets[applicationKey]
              const href = resolvedLaunch?.href || service.href
              const inAppPage = getInAppPage(service)
              const opensInApp = Boolean(inAppPage)
              const target = opensInApp ? '' : resolvedLaunch?.target || service.target
              const isBusy = favoriteActionState.removingKey === applicationKey
              const isLaunching = Boolean(launchingKeys[applicationKey])
              const isContextOpen = contextMenuState.open && getApplicationKey(contextMenuState.application ?? {}) === applicationKey
              const favoriteEntry = favoritesByKey.get(applicationKey)
              const isFavorite = Boolean(favoriteEntry) && !exitingFavoriteKeys[applicationKey]

              return (
                <a
                  key={service.id}
                  className={`app-card app-card-enter group relative flex items-center gap-2.5 p-2 border corners-[18px] text-inherit no-underline min-w-0 focus-visible:outline-none ${isBusy || isLaunching ? 'pointer-events-none opacity-70' : ''} ${isContextOpen ? 'app-card--active' : ''}`}
                  style={{ animationDelay: `${Math.min(index, 24) * 20}ms` }}
                  href={href}
                  target={target || undefined}
                  rel={target === '_blank' || opensInApp ? 'noreferrer' : undefined}
                  aria-description={opensInApp ? IN_APP_PAGE_DESCRIPTIONS[inAppPage] : undefined}
                  aria-busy={isBusy || isLaunching}
                  onMouseEnter={() => warmApplicationLaunch(service)}
                  onFocus={() => warmApplicationLaunch(service)}
                  onContextMenu={(event) => handleFavoriteContextMenu(event, service, 'all')}
                  onClick={(event) => void handleApplicationClick(event, service, 'grid')}
                >
                  <AppIcon
                    title={service.title}
                    assignment={tileAssignments.get(applicationKey)}
                    isLaunching={isLaunching}
                    className="w-10 h-10 corners-[11px]"
                  />
                  <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[15px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis">{service.title}</span>
                    {showDescriptions && service.description ? (
                      <span className="text-[13px] font-medium leading-[1.3] text-text-muted line-clamp-1 font-body">{service.description}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className={`app-card-action flex items-center justify-center w-8 h-8 rounded-full border-none bg-transparent cursor-pointer transition-[opacity,background-color,color] duration-[120ms] ease-in-out shrink-0 ${isFavorite ? 'text-brand opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 focus-visible:opacity-100 max-md:opacity-50'}`}
                    aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    aria-pressed={isFavorite}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (isFavorite) {
                        void handleUnfavorite(favoriteEntry)
                      } else {
                        void handleAddFavorite(service)
                      }
                    }}
                  >
                    <Icon icon={isFavorite ? 'carbon:star-filled' : 'carbon:star'} className="w-[18px] h-[18px]" aria-hidden="true" />
                  </button>
                </a>
              )
            })}
            {filteredServices.length === 0 ? (
              <p className="col-span-full m-0 py-6 text-center text-sm font-medium text-text-secondary font-body">
                Aucune application trouvée
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {contextMenuState.open && contextMenuState.application ? (() => {
        const applicationKey = getApplicationKey(contextMenuState.application)
        const favoriteEntry = favoritesByKey.get(applicationKey)
        const isAddMode = !favoriteEntry && contextMenuState.source === 'all'
        const targetApplication = favoriteEntry ?? contextMenuState.application

        return (
        <div
          ref={contextMenuRef}
          className="favorites-context-menu fixed z-60 min-w-[252px] p-[6px] border border-border corners-[18px] bg-context-bg shadow-[0_18px_40px_var(--color-shadow)] backdrop-blur-[12px] animate-context-menu-in max-md:min-w-[220px]"
          role="menu"
          aria-label={`Actions pour ${targetApplication.title}`}
          style={{
            top: `${contextMenuState.y}px`,
            left: `${contextMenuState.x}px`,
            '--favorites-context-origin-x': contextMenuState.originX,
            '--favorites-context-origin-y': contextMenuState.originY,
          }}
        >
          <button
            type="button"
            className="favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 corners-[12px] bg-transparent text-brand font-inherit text-[15px] font-semibold text-left animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none"
            role="menuitem"
            onClick={() => void handleOpenApplicationInNewTab(targetApplication)}
          >
            <Icon icon="carbon:launch" className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
            <span>Ouvrir dans un nouvel onglet</span>
          </button>
          <button
            type="button"
            className="favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 corners-[12px] bg-transparent text-brand font-inherit text-[15px] font-semibold text-left animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none"
            role="menuitem"
            onClick={() => void handleCopyApplicationLink(targetApplication)}
          >
            <Icon icon="carbon:copy-link" className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
            <span>Copier le lien</span>
          </button>
          <div className="mx-2 my-1 h-px bg-border/80" aria-hidden="true" />
          {isAddMode ? (
            <button
              type="button"
              className="favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 corners-[12px] bg-transparent text-brand font-inherit text-[15px] font-semibold text-left animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none"
              role="menuitem"
              onClick={() => void handleAddFavorite(targetApplication)}
            >
              <Icon icon="carbon:star" className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
              <span>Ajouter aux favoris</span>
            </button>
          ) : (
            <button
              type="button"
              className="favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 corners-[12px] bg-transparent text-brand font-inherit text-[15px] font-semibold text-left animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none"
              role="menuitem"
              onClick={() => void handleUnfavorite(targetApplication)}
            >
              <Icon icon="carbon:close-outline" className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
              <span>Retirer des favoris</span>
            </button>
          )}
        </div>
      )})() : null}
    </>
  )
}

export default AvailableApplications
