import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import homeAppsIcon from '../assets/home-icons/apps.png'
import { Icon, iconLoaded, loadIcons } from '@iconify/react'
import universityConfig from '@university'
import { toAppSlug, track } from '../analytics'
import { fetchAppIcons, getCachedAppIcons } from '../appIcons'
import { scoreAppSearch, searchApps } from '../appSearch'
import { DEMO_MAIL_APP_FNAME, DEMO_PLANNING_APP_FNAME, DEMO_SESSION_MODE } from '../demoAccount'
import { getGradesOrigin, opensGradesPageInApp } from '../gradesPortalApp'
import { getPlanningOrigin, opensPlanningPageInApp } from '../planningPortalApp'
import { getMailOrigins, opensMailPageInApp } from '../mailPortalApp'
import { getMoodleOrigin, opensMoodlePageInApp } from '../moodlePortalApp'
import { isInHiddenPage } from '../keptPages'
import ContextMenu from './ContextMenu'
import LoadingDots from './LoadingDots'
import MailAttachDrawer, { ATTACH_CARD_CLASS, AttachDrawerNote } from './MailAttachDrawer'
import SmoothSurface from './SmoothSurface'
import { Skeleton } from 'skullet/react'
import { useSkeletonsForced } from '../skeletonSamples'
import { ENT_AUTH_PREFIX, ENT_ORIGIN, getApps, serverFetch } from '../entApi'
import { getApplicationKey, orderApplications, resolveFavoriteKeys, toApplications } from '../portalApps'

const DEFAULT_ERROR_MESSAGE = 'Impossible de charger les applications pour le moment'
const CLOSED_CONTEXT_MENU = { open: false, x: 0, y: 0, application: null, source: 'favorite' }
const FAVORITE_REMOVAL_ANIMATION_MS = 220
// The sidebar only fits a few favorites; the rest stay starred in the full list.
const SIDEBAR_FAVORITES_LIMIT = 3
// The « Accueil » page's « Applications »: after the favourites, up to this
// many other apps of the list, as many of them as fit on the row.
const HOME_EXTRA_APPS = 12

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
// Last order of the full app list. A portal moves an app starred there out
// of its list, which loses its place: this remembers it (portalApps.js:
// orderApplications).
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

// A stored list of application keys, whatever the storage holds: a list of
// strings or nothing (a value written by an older version, by hand or by an
// import must never break the page).
function loadStoredKeys(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null')
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

function loadFavoritesOrder() {
  return loadStoredKeys(FAVORITES_ORDER_KEY)
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
  return loadStoredKeys(LOCAL_PINS_KEY)
}

function saveLocalPins(pins) {
  try {
    localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins))
  } catch {
    return
  }
}

// The favourites stay in this browser, whatever the portal: the keys of the
// starred apps, in the order they were starred. They start, once, from the
// apps the student starred on the portal (portalApps.js:
// resolveFavoriteKeys). The demo account's are kept apart: a look at the
// demo never touches the student's own.
const LOCAL_FAVORITES_KEY = 'l-ent:local-favorites'
const DEMO_FAVORITES_KEY = 'l-ent:local-favorites:demo'

// null: the browser never held any (not the same as none).
function loadLocalFavorites(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null')
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : null
  } catch {
    return null
  }
}

function saveLocalFavorites(storageKey, keys) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // Storage unavailable
  }
}

// The favourites section built from the stored keys. Apps the portal no
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

// A shortcut of the university's config, as opposed to an app the portal
// lists: starred in its own list (LOCAL_PINS_KEY).
function isLocalService(application) {
  return !application?.listed
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

const TITLE_OVERRIDES = universityConfig.services?.titleOverrides ?? {}
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

// Whether a tile opens through the launch relay, which signs the student in
// to the application with the session (services.launchRelay): a portal whose
// applications sit behind the CAS. Elsewhere a tile is a plain link.
const LAUNCH_RELAY = universityConfig.services?.launchRelay === true

// What makes the server's list this university's tiles (portalApps.js).
const APPLICATION_OPTIONS = {
  titleOverrides: TITLE_OVERRIDES,
  getCategory: getAppCategory,
  isUnavailable: isUnavailableGradeApplication,
  launchRelay: LAUNCH_RELAY,
}

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message.trim() : String(error).trim()

  if (!message || /<!doctype|<html/i.test(message) || message === '[object Object]') {
    return DEFAULT_ERROR_MESSAGE
  }

  return message
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

const PORTAL_HOST = getUrlHostname(ENT_ORIGIN)

function isPortalHost(hostname) {
  return Boolean(PORTAL_HOST) && hostname === PORTAL_HOST
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

  // A page of the portal's own (an application the portal gives no other
  // address for): it wants the portal's session.
  const hrefHost = getUrlHostname(href)
  if (isPortalHost(hrefHost) || isCasHost(hrefHost)) {
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

  const launchHref = useServerLaunch && /^https?:\/\//i.test(href)
    ? `/__ent_auth/launch?url=${encodeURIComponent(href)}`
    : href

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

// And for the webmail's app (« Messagerie », see mailPortalApp.js).
const MAIL_PORTAL_OPTIONS = {
  mailOrigins: getMailOrigins(universityConfig.mail?.webmailUrls),
  appKeys: [DEMO_MAIL_APP_FNAME],
  launchPath: `${ENT_AUTH_PREFIX}/launch`,
  casOrigin: universityConfig.origins?.cas ?? '',
}

// And for Moodle's app, where Moodle is a page of the app (the desktop
// app's, see moodlePortalApp.js). The demo's « Moodle » links elsewhere and
// stays a link.
const MOODLE_PORTAL_OPTIONS = {
  moodleOrigin: universityConfig.features?.moodle ? getMoodleOrigin(universityConfig.origins?.moodle) : null,
  launchPath: `${ENT_AUTH_PREFIX}/launch`,
  casOrigin: universityConfig.origins?.cas ?? '',
}

// What an in-app tile says it opens (aria-description).
const IN_APP_PAGE_DESCRIPTIONS = {
  grades: 'Ouvre Mes notes',
  planning: 'Ouvre le planning',
  mail: 'Ouvre la messagerie',
  moodle: 'Ouvre Moodle dans l’appli',
}

// `onOpenGradesPage`: the app's own grades page, passed only while the
// student has it (called with 'tile', its page_viewed source). With it, the grade service's app opens that page instead of
// ScoDoc from every tile; a modified or middle click and « Ouvrir dans un
// nouvel onglet » still open ScoDoc, its link stays on the tile for that.
// `onOpenPlanningPage`: the same for the planning service's app and the
// in-app Planning page, passed only while the student has it.
// `onOpenMailPage`: and for the webmail's app and the in-app mail page.
// `onOpenMoodlePage`: and for Moodle's app and « Moodle », in the desktop
// app only (elsewhere Moodle is a site, and its tile a link).
function AvailableApplications({
  establishment = null,
  canUseServerLaunch = true,
  favoritesPortalTarget = null,
  // The « Accueil » page's slot for its « Applications » row (the
  // favourites as tiles), while that page shows. In the iOS app the page
  // is kept behind the others (src/keptPages.js), its row with it:
  // `homeAppsShown` says whether it is the one shown.
  homeAppsPortalTarget = null,
  homeAppsShown = true,
  // « Toutes les applications » asked from elsewhere (« Accueil »'s icon on
  // a phone): the drawer opens each time this number goes up.
  homeDrawerRequest = 0,
  showDescriptions = false,
  onOpenGradesPage = null,
  onOpenPlanningPage = null,
  onOpenMailPage = null,
  onOpenMoodlePage = null,
}) {
  const skeletonsForced = useSkeletonsForced()
  const [viewState, setViewState] = useState({
    status: 'loading',
    source: 'none',
    rawCount: 0,
    sections: [],
    error: '',
  })
  const [reloadKey, setReloadKey] = useState(0)
  const [launchBehaviors, setLaunchBehaviors] = useState({})
  const [launchingKeys, setLaunchingKeys] = useState({})
  const [exitingFavoriteKeys, setExitingFavoriteKeys] = useState({})
  const [favoriteActionState, setFavoriteActionState] = useState({
    removingKey: '',
    error: '',
  })
  const [contextMenuState, setContextMenuState] = useState(CLOSED_CONTEXT_MENU)
  const [allServices, setAllServices] = useState([])
  const [appIcons, setAppIcons] = useState(getCachedAppIcons)
  const [loadedIconKey, setLoadedIconKey] = useState('')
  const [localPins, setLocalPins] = useState(loadLocalPins)
  const [orderedFavorites, setOrderedFavorites] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const launchBehaviorRequestsRef = useRef(new Map())
  const removalTimeoutsRef = useRef(new Map())
  // Where the favourites of the account signed in are kept: the student's
  // own, or the demo account's.
  const favoritesKeyRef = useRef(LOCAL_FAVORITES_KEY)
  const isMountedRef = useRef(true)
  const dragRef = useRef({ index: -1, didDrag: false })
  const favoritesRowRef = useRef(null)
  // The « Accueil » page's apps hold one line: the row is one tile high,
  // the tiles that wrap past it are out of sight and out of the tab order.
  // « Toutes les applications » on the « Accueil » page: a drawer of every
  // app, to open or star, its own search.
  const [isHomeDrawerOpen, setIsHomeDrawerOpen] = useState(false)
  const [homeDrawerQuery, setHomeDrawerQuery] = useState('')
  const closeHomeDrawer = useCallback(() => {
    setIsHomeDrawerOpen(false)
    setHomeDrawerQuery('')
  }, [])
  const answeredDrawerRequestRef = useRef(homeDrawerRequest)
  useEffect(() => {
    if (homeDrawerRequest === answeredDrawerRequestRef.current) return
    answeredDrawerRequestRef.current = homeDrawerRequest
    setIsHomeDrawerOpen(true)
  }, [homeDrawerRequest])
  // Leaving the page (or opening an app in it) closes it.
  useEffect(() => {
    if (!homeAppsPortalTarget || !homeAppsShown) closeHomeDrawer()
  }, [homeAppsPortalTarget, homeAppsShown, closeHomeDrawer])
  const homeAppsRowRef = useRef(null)
  useLayoutEffect(() => {
    const row = homeAppsRowRef.current
    if (!row) return undefined
    const fit = () => {
      const tiles = [...row.children]
      if (tiles.length === 0 || isInHiddenPage(row)) return
      row.style.maxHeight = `${tiles[0].offsetHeight}px`
      const firstTop = tiles[0].offsetTop
      for (const tile of tiles) {
        const wrapped = tile.offsetTop > firstTop
        tile.style.visibility = wrapped ? 'hidden' : ''
        if (wrapped) tile.setAttribute('tabindex', '-1')
        else tile.removeAttribute('tabindex')
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => observer.disconnect()
  })
  const flipRectsRef = useRef(new Map())

  const entFavoriteApplications = useMemo(
    () => getFavoriteApplications(viewState.sections),
    [viewState.sections],
  )
  const favoriteApplications = useMemo(() => {
    const entFavorites = entFavoriteApplications
      .filter((application) => !isUnavailableGradeApplication(application))
    const pinnedLocalServices = allServices.filter(
      (service) => isLocalService(service) && localPins.includes(getApplicationKey(service)),
    )
    return [...entFavorites, ...pinnedLocalServices]
  }, [entFavoriteApplications, allServices, localPins])
  const visibleServices = useMemo(() => {
    const pinnedLocalKeys = new Set(localPins)
    return allServices.filter(
      (service) => !isLocalService(service) || !pinnedLocalKeys.has(getApplicationKey(service)),
    )
  }, [allServices, localPins])
  // The « Accueil » page's drawer, on its own search: every app, the local
  // ones starred too (the list below leaves those to the favourites), so a
  // star doesn't take its app away.
  const homeDrawerServices = useMemo(() => searchApps(allServices, homeDrawerQuery), [allServices, homeDrawerQuery])
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

  useEffect(() => {
    const launchBehaviorRequests = launchBehaviorRequestsRef.current
    const removalTimeouts = removalTimeoutsRef.current
    // Set again on mount: StrictMode runs this cleanup once in development,
    // which used to leave the flag off and drop every favorite update.
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
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
      setContextMenuState(CLOSED_CONTEXT_MENU)
    }

    window.addEventListener('pageshow', handlePageShow)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])


  useEffect(() => {
    let isCancelled = false

    async function hydrateApplications() {
      try {
        const answer = await getApps()
        if (isCancelled) {
          return
        }
        if (!Array.isArray(answer?.apps)) {
          throw new Error(DEFAULT_ERROR_MESSAGE)
        }

        const services = orderApplications(toApplications(answer.apps, APPLICATION_OPTIONS), loadAppsOrder())
        saveAppsOrder(services)

        // The favourites: the browser's, started once from the portal's.
        const favoritesKey = answer.sessionMode === DEMO_SESSION_MODE ? DEMO_FAVORITES_KEY : LOCAL_FAVORITES_KEY
        favoritesKeyRef.current = favoritesKey
        const favorites = resolveFavoriteKeys(loadLocalFavorites(favoritesKey), services)
        if (favorites.seeded) {
          saveLocalFavorites(favoritesKey, favorites.keys)
        }
        const sections = buildLocalFavoriteSections(services, favorites.keys)

        // Establishment shortcuts go first. When the portal already lists one
        // (same host), promote the portal entry instead of duplicating it.
        const extraServices = universityConfig.establishments?.byId?.[establishment]?.extraServices ?? []
        const pinnedServices = extraServices.map((extraService) => {
          const extraHost = getUrlHostname(extraService.href)
          const portalIndex = extraHost ? services.findIndex((service) => getUrlHostname(service.href) === extraHost) : -1
          return portalIndex !== -1 ? services.splice(portalIndex, 1)[0] : extraService
        })
        services.unshift(...pinnedServices)

        // Tile icons come in the background: the grid never waits for them.
        void fetchAppIcons(services).then((assignments) => {
          // Shared by the whole university, so still right after a refresh.
          if (assignments) {
            setAppIcons(assignments)
          }
        })

        setAllServices(services)
        setFavoriteActionState((current) => ({ ...current, error: '' }))
        setViewState({
          status: sections.sections.length > 0 ? 'ready' : 'empty',
          source: sections.source,
          rawCount: sections.rawCount,
          sections: sections.sections,
          error: '',
        })
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

  // Whether an application opens through the launch relay: the server says,
  // from where the application's address leads (the CAS or not).
  async function resolveApplicationLaunchBehavior(application) {
    const launchKey = getApplicationKey(application)
    const cachedBehavior = launchBehaviors[launchKey]
    if (typeof cachedBehavior === 'boolean') {
      return cachedBehavior
    }

    const existingRequest = launchBehaviorRequestsRef.current.get(launchKey)
    if (existingRequest) {
      return existingRequest
    }

    const href = application?.href || ''
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

    const request = serverFetch(`/__ent_auth/launch-preview?url=${encodeURIComponent(href)}`, {
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

  // Stable: the menu listens with it (ContextMenu).
  const closeContextMenu = useCallback(() => setContextMenuState(CLOSED_CONTEXT_MENU), [])

  function handleFavoriteContextMenu(event, application, source = 'favorite') {
    event.preventDefault()

    setFavoriteActionState((current) => ({ ...current, error: '' }))
    setContextMenuState({
      open: true,
      x: event.clientX,
      y: event.clientY,
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
    const launch = { href: application.href, target: targetOverride || application.target }

    if (launchingKeys[launchKey]) {
      if (preparedWindow && !preparedWindow.closed) {
        preparedWindow.close()
      }
      return
    }

    setLaunchingKeys((current) => ({ ...current, [launchKey]: true }))

    try {
      const shouldUseServerLaunch = canUseServerLaunch
        ? await resolveApplicationLaunchBehavior(application)
        : false

      clearLaunchingState(launchKey)
      navigateToApplication(launch, preparedWindow, {
        useServerLaunch: shouldUseServerLaunch,
      })
    } catch {
      clearLaunchingState(launchKey)
      if (preparedWindow && !preparedWindow.closed) {
        preparedWindow.close()
      }
      navigateToApplication(launch, null, {
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
      await copyTextToClipboard(application?.href || '')
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

  // A favourite on its way out stays after all.
  function cancelFavoriteExit(applicationKey) {
    window.clearTimeout(removalTimeoutsRef.current.get(applicationKey))
    removalTimeoutsRef.current.delete(applicationKey)
    setPendingFavorite(setExitingFavoriteKeys, applicationKey, null)
  }

  // The favourites as the browser holds them now, shown.
  function showStoredFavorites() {
    const local = buildLocalFavoriteSections(allServices, loadLocalFavorites(favoritesKeyRef.current) ?? [])
    setViewState((current) => ({
      ...current,
      ...local,
      status: local.sections.length > 0 ? 'ready' : 'empty',
      error: '',
    }))
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
    const storageKey = favoritesKeyRef.current
    saveLocalFavorites(storageKey, (loadLocalFavorites(storageKey) ?? []).filter((key) => key !== applicationKey))
    // The star empties right away; the tile plays its exit animation, then
    // leaves the row (unless it was starred again meanwhile: the favourites
    // shown are the stored ones, as they are then).
    setExitingFavoriteKeys((current) => ({ ...current, [applicationKey]: true }))
    window.clearTimeout(removalTimeoutsRef.current.get(applicationKey))
    removalTimeoutsRef.current.set(applicationKey, window.setTimeout(() => {
      removalTimeoutsRef.current.delete(applicationKey)
      if (!isMountedRef.current) return
      setPendingFavorite(setExitingFavoriteKeys, applicationKey, null)
      showStoredFavorites()
    }, FAVORITE_REMOVAL_ANIMATION_MS))
  }

  function handleAddFavorite(application) {
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

    setFavoriteActionState({ removingKey: '', error: '' })
    cancelFavoriteExit(applicationKey)
    const storageKey = favoritesKeyRef.current
    const keys = loadLocalFavorites(storageKey) ?? []
    saveLocalFavorites(storageKey, keys.includes(applicationKey) ? keys : [...keys, applicationKey])
    showStoredFavorites()
  }

  // The grade service's app while the student has « Mes notes ».
  function opensGradesPage(application) {
    return opensGradesPageInApp(application, {
      ...GRADES_PORTAL_OPTIONS,
      hasGradesPage: Boolean(onOpenGradesPage),
      base: window.location.href,
    })
  }

  // The planning service's app while the student has the Planning page,
  // checked the same way.
  function opensPlanningPage(application) {
    return opensPlanningPageInApp(application, {
      ...PLANNING_PORTAL_OPTIONS,
      hasPlanningPage: Boolean(onOpenPlanningPage),
      base: window.location.href,
    })
  }

  // The webmail's app while the student has the mail page, likewise.
  function opensMailPage(application) {
    return opensMailPageInApp(application, {
      ...MAIL_PORTAL_OPTIONS,
      hasMailPage: Boolean(onOpenMailPage),
      base: window.location.href,
    })
  }

  // Moodle's app while Moodle is a page of the app, likewise.
  function opensMoodlePage(application) {
    return opensMoodlePageInApp(application, {
      ...MOODLE_PORTAL_OPTIONS,
      hasMoodlePage: Boolean(onOpenMoodlePage),
      base: window.location.href,
    })
  }

  // The app's own page a tile opens instead of its site, or null.
  function getInAppPage(application) {
    if (opensGradesPage(application)) return 'grades'
    if (opensPlanningPage(application)) return 'planning'
    if (opensMailPage(application)) return 'mail'
    if (opensMoodlePage(application)) return 'moodle'
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
      } else if (inAppPage === 'mail') {
        onOpenMailPage('tile')
      } else if (inAppPage === 'moodle') {
        onOpenMoodlePage('tile')
      } else {
        onOpenPlanningPage('tile')
      }
      return
    }

    // A plain link: the browser opens it.
    if (!application.relay) {
      return
    }

    event.preventDefault()

    const preparedWindow = application.target === '_blank'
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

  // One app of the full list: its icon, name (and description), a star to
  // add or remove it from the favourites. Also the « Accueil » page's
  // drawer (`inDrawer`: the star always shows, the arrows move through).
  const renderServiceCard = (service, index, { inDrawer = false } = {}) => {
    const applicationKey = getApplicationKey(service)
    const href = service.href
    const inAppPage = getInAppPage(service)
    const opensInApp = Boolean(inAppPage)
    const target = opensInApp ? '' : service.target
    const isBusy = favoriteActionState.removingKey === applicationKey
    const isLaunching = Boolean(launchingKeys[applicationKey])
    const isContextOpen = contextMenuState.open && getApplicationKey(contextMenuState.application ?? {}) === applicationKey
    const favoriteEntry = favoritesByKey.get(applicationKey)
    const isFavorite = Boolean(favoriteEntry) && !exitingFavoriteKeys[applicationKey]

    return (
      <a
        key={service.id}
        className={`app-card app-card-enter group relative flex items-center gap-2.5 p-2 border corners-[18px] ${inDrawer ? ATTACH_CARD_CLASS : ''} text-inherit no-underline min-w-0 focus-visible:outline-none ${isBusy || isLaunching ? 'pointer-events-none opacity-70' : ''} ${isContextOpen ? 'app-card--active' : ''}`}
        style={{ animationDelay: `${Math.min(index, 24) * 20}ms` }}
        href={href}
        target={target || undefined}
        rel={target === '_blank' || opensInApp ? 'noreferrer' : undefined}
        aria-description={opensInApp ? IN_APP_PAGE_DESCRIPTIONS[inAppPage] : undefined}
        aria-busy={isBusy || isLaunching}
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
          className={`app-card-action flex items-center justify-center w-8 h-8 rounded-full border-none bg-transparent cursor-pointer transition-[opacity,background-color,color] duration-[120ms] ease-in-out shrink-0 ${isFavorite ? 'text-brand opacity-100' : inDrawer ? 'text-text-muted opacity-60 hover:opacity-100 focus-visible:opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 focus-visible:opacity-100 max-md:opacity-50'}`}
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
          <Icon icon={isFavorite ? 'ph:star-fill' : 'ph:star'} className="w-[18px] h-[18px]" aria-hidden="true" />
        </button>
      </a>
    )
  }

  // The favourites, as the sidebar's list (`sidebar`, at most four) or a
  // row of tiles (the dashboard without the sidebar, and the « Accueil »
  // page's « Applications », `home`: its own title, no reordering by drag,
  // which follows the dashboard's row).
  // Loading, or held so from the debug panel (« Simuler le chargement »).
  const appsLoading = viewState.status === 'loading' || skeletonsForced
  const renderFavoritesSection = ({ sidebar = false, home = false } = {}) => {
    const isSidebarFavorites = sidebar
    const displayedFavorites = isSidebarFavorites
      // None that opens a page of the app: the sidebar has its tab.
      ? orderedFavorites.filter((application) => !getInAppPage(application)).slice(0, SIDEBAR_FAVORITES_LIMIT)
      : home
        // The favourites, then the first apps of the list that aren't; none
        // that opens a page of the app (mail, planning, grades: the page
        // has their cards, the sidebar their tabs).
        ? [...orderedFavorites, ...visibleServices.filter((service) => !favoritesByKey.has(getApplicationKey(service))).slice(0, HOME_EXTRA_APPS)]
          .filter((application) => !getInAppPage(application))
        : orderedFavorites
    // « Accueil »'s row isn't the favourites alone: without any (status
    // 'empty', the list loaded), it still has the first apps and « Toutes
    // les applications », the way to every app. A student who starred
    // nothing on the portal starts with none.
    const homeHasApps = home && (viewState.status === 'ready' || viewState.status === 'empty') && visibleServices.length > 0
    const showRow = home ? viewState.status === 'ready' || homeHasApps : shouldShowFavoriteRow
    const titleId = home ? 'home-apps-title' : 'favorites-strip-title'
    // Radii are concentric: item radius = icon radius + item padding.
    // min-w-0: as a grid item the list would otherwise grow to its longest
    // title and push past the sidebar instead of letting it end in "…".
    const favoriteListClassName = isSidebarFavorites
      ? 'flex flex-col gap-0.5 min-w-0'
      : home
        ? 'flex min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden max-md:gap-1'
        : 'flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:gap-1 max-md:overflow-x-auto max-md:overflow-y-hidden max-md:-mx-3 max-md:-my-2 max-md:px-3 max-md:py-2 favorites-scroll-hide'
    // The « Accueil » row on a phone: compact tiles (a 38px icon, its
    // name on one line under it), concentric as the others.
    const favoriteItemClassName = isSidebarFavorites
      ? 'flex items-center gap-2.5 w-full p-1 corners-[13px]'
      : home
        ? 'inline-flex items-center gap-2.5 max-w-full p-[5px] pr-3.5 corners-[14px] max-md:flex-col max-md:gap-1 max-md:w-[58px] max-md:p-1 max-md:corners-[14px] max-md:shrink-0'
        : 'inline-flex items-center gap-2.5 max-w-full p-[5px] pr-3.5 corners-[14px] max-md:flex-col max-md:gap-1.5 max-md:w-[76px] max-md:p-1.5 max-md:corners-[20px] max-md:shrink-0'
    const favoriteIconClassName = isSidebarFavorites
      ? 'w-8 h-8 corners-[9px]'
      : home
        ? 'w-8 h-8 corners-[9px] max-md:w-[38px] max-md:h-[38px] max-md:corners-[10px]'
        : 'w-8 h-8 corners-[9px] max-md:w-[52px] max-md:h-[52px] max-md:corners-[14px]'
    const favoriteTitleClassName = isSidebarFavorites
      ? 'flex-1 min-w-0 text-[14px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis'
      : home
        ? 'min-w-0 text-[14px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-md:w-full max-md:text-[11px] max-md:text-center'
        : 'min-w-0 text-[14px] font-semibold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-md:w-full max-md:text-[12px] max-md:text-center max-md:whitespace-normal max-md:line-clamp-2'

    if (shouldHideFavoritesSection && !homeHasApps) return null
    // The names are ink, not the brand: a colour palette leaves them be.
    return (
      <section className="favorites-bar grid gap-2 relative text-ink" aria-labelledby={titleId}>
        {home ? (
          // As the « Accueil » page's cards title themselves.
          <div className="flex min-w-0 items-center gap-2">
            <img src={homeAppsIcon} alt="" width="22" height="22" draggable="false" className="size-[22px] shrink-0 select-none" aria-hidden="true" />
            <h2 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]" id={titleId}>Applications</h2>
          </div>
        ) : (
          <div className="flex items-center gap-[5px]">
            <Icon icon="ph:star" className="w-[17px] h-[17px] text-brand shrink-0" aria-hidden="true" />
            <h2 className="m-0 font-body text-base font-medium tracking-normal leading-[1.06]" id={titleId}>Favoris</h2>
            {shouldShowFavoriteRow ? (
              <span className="ml-0.5 text-[13px] font-medium leading-none text-text-muted tabular-nums">
                {isSidebarFavorites && displayedFavorites.length >= SIDEBAR_FAVORITES_LIMIT
                  ? `${SIDEBAR_FAVORITES_LIMIT}/${SIDEBAR_FAVORITES_LIMIT}`
                  : displayedFavorites.length}
              </span>
            ) : null}
          </div>
        )}


        {viewState.status === 'error' ? (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex items-center gap-2">
              <Icon icon="ph:warning-circle-fill" className="w-[18px] h-[18px] text-error shrink-0" aria-hidden="true" />
              <p className="m-0 text-sm font-medium leading-[1.3] text-text-secondary font-body">{viewState.error}</p>
            </div>

            <button type="button" className="material min-h-[34px] px-[14px] rounded-full text-brand font-inherit text-sm font-semibold" onClick={handleRetry}>
              <SmoothSurface />
              Réessayer
            </button>
          </div>
        ) : null}

        {/* Loading, sample tiles measured into a skeleton (skullet); once
            the apps are in, the same <Skeleton> reveals the row over it
            (and each tile rises in, .favorites-strip-item). */}
        {appsLoading || showRow ? (
          <Skeleton loading={appsLoading} label="Chargement des favoris">
            {appsLoading ? (
              <div className={favoriteListClassName}>
                {['Application', 'Annuaire', 'Documentation', 'Assistance'].slice(0, isSidebarFavorites ? SIDEBAR_FAVORITES_LIMIT : 4).map((name) => (
                  <div key={name} className={favoriteItemClassName}>
                    <span skullet-block="" className={`shrink-0 ${favoriteIconClassName}`} />
                    <span className={favoriteTitleClassName}>{name}</span>
                  </div>
                ))}
              </div>
            ) : (
          <div className={home ? 'flex min-w-0 items-start gap-1.5 max-md:gap-1' : 'contents'}>
            <div className={`${favoriteListClassName} ${isDragging && !home ? 'is-dragging' : ''}`} ref={home ? homeAppsRowRef : favoritesRowRef}>
              {displayedFavorites.map((application, index) => {
                const applicationKey = getApplicationKey(application)
                const href = application.href
                // In-app tiles drop `target` (a new tab a plain click doesn't
                // open; a modified click still does, natively, hence `rel`) and
                // say where they lead instead.
                const inAppPage = getInAppPage(application)
                const opensInApp = Boolean(inAppPage)
                const target = opensInApp ? '' : application.target
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
                    style={{ '--i': index }}
                    className={`favorites-strip-item app-card group relative border text-inherit no-underline min-w-0 cursor-pointer focus-visible:outline-none ${favoriteItemClassName} ${isLaunching ? 'pointer-events-none cursor-progress' : ''} ${(isRemovingFavorite || isExitingFavorite) ? 'pointer-events-none opacity-70' : ''} ${isExitingFavorite ? 'animate-favorite-remove' : ''} ${isContextOpen ? 'app-card--active' : ''} ${isSearchHighlighted ? 'favorite-search-highlight' : ''}`}
                    href={href}
                    target={target || undefined}
                    rel={target === '_blank' || opensInApp ? 'noreferrer' : undefined}
                    aria-label={`Ouvrir ${application.title}`}
                    aria-description={opensInApp ? IN_APP_PAGE_DESCRIPTIONS[inAppPage] : undefined}
                    aria-busy={isLaunching || isRemovingFavorite || isExitingFavorite}
                    draggable={home ? undefined : 'true'}
                    onDragStart={home ? undefined : (event) => handleDragStart(event, index)}
                    onDragOver={home ? undefined : (event) => handleDragOver(event, index)}
                    onDragEnd={home ? undefined : handleDragEnd}
                    onClickCapture={handleClickCapture}
                    onContextMenu={(event) => handleFavoriteContextMenu(event, application, favoritesByKey.has(applicationKey) ? 'favorite' : 'all')}
                    onClick={(event) => void handleApplicationClick(event, application, favoritesByKey.has(applicationKey) ? 'favorites' : 'grid')}
                  >
                    {home && favoritesByKey.has(applicationKey) ? (
                      // On the « Accueil » row, a favourite (not one of the
                      // apps added after them) wears a star on its icon.
                      <span className="relative inline-flex shrink-0">
                        <AppIcon
                          title={application.title}
                          assignment={tileAssignments.get(applicationKey)}
                          isLaunching={isLaunching}
                          className={favoriteIconClassName}
                          letterClassName="text-sm max-md:text-base"
                        />
                        <span className="glass-solid absolute -top-1 -right-1 inline-flex size-[15px] items-center justify-center rounded-full text-brand" title="Favori">
                          <Icon icon="ph:star-fill" className="size-[9px]" aria-hidden="true" />
                          <span className="sr-only">Favori</span>
                        </span>
                      </span>
                    ) : (
                      <AppIcon
                        title={application.title}
                        assignment={tileAssignments.get(applicationKey)}
                        isLaunching={isLaunching}
                        className={favoriteIconClassName}
                        letterClassName="text-sm max-md:text-base"
                      />
                    )}
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
                        <Icon icon="ph:star-fill" className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </a>
                )
              })}
            </div>
            {home ? (
              // Always at the row's end: every app, in a drawer.
              <button
                type="button"
                className={`app-card home-all-apps group relative shrink-0 cursor-pointer border text-inherit ${favoriteItemClassName}`}
                aria-haspopup="dialog"
                aria-label="Toutes les applications"
                onClick={() => setIsHomeDrawerOpen(true)}
              >
                <span className={`inline-flex shrink-0 items-center justify-center bg-bg-subtle text-text-secondary ${favoriteIconClassName}`} aria-hidden="true">
                  <Icon icon="ph:squares-four" className="size-[18px]" />
                </span>
                {/* « Toutes » on a phone's compact tile. */}
                <span className={favoriteTitleClassName}>
                  <span className="max-md:hidden">Toutes les applications</span>
                  <span className="md:hidden">Toutes</span>
                </span>
              </button>
            ) : null}
          </div>
            )}
          </Skeleton>
        ) : null}

        {favoriteActionState.error ? (
          <p className="m-0 text-sm font-medium leading-[1.3] text-text-secondary font-body">{favoriteActionState.error}</p>
        ) : null}
      </section>
    )
  }
  const isSidebarFavorites = Boolean(favoritesPortalTarget)
  const favoritesSectionContent = renderFavoritesSection({ sidebar: isSidebarFavorites })
  const homeAppsContent = homeAppsPortalTarget ? renderFavoritesSection({ home: true }) : null

  return (
    <>
      {favoritesPortalTarget && typeof document !== 'undefined'
        ? createPortal(favoritesSectionContent, favoritesPortalTarget)
        : favoritesSectionContent}
      {homeAppsContent && typeof document !== 'undefined' ? createPortal(homeAppsContent, homeAppsPortalTarget) : null}
      {isHomeDrawerOpen && homeAppsPortalTarget && homeAppsShown && typeof document !== 'undefined'
        ? createPortal(
          <div className="fixed inset-0 z-50">
            <MailAttachDrawer
              titleId="home-all-apps-title"
              title="Toutes les applications"
              search={{ value: homeDrawerQuery, onChange: setHomeDrawerQuery, placeholder: 'Rechercher une application' }}
              onClose={closeHomeDrawer}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-1.5 max-md:grid-cols-1 max-md:gap-1">
                {homeDrawerServices.map((service, index) => renderServiceCard(service, index, { inDrawer: true }))}
              </div>
              {homeDrawerServices.length === 0 ? <AttachDrawerNote>Aucune application trouvée</AttachDrawerNote> : null}
            </MailAttachDrawer>
          </div>,
          document.body,
        )
        : null}

      {visibleServices.length > 0 ? (
        <div className={`grid gap-3 text-brand${favoritesPortalTarget || !favoritesSectionContent ? '' : ' mt-5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-[5px]">
              <Icon icon="ph:squares-four" className="w-[17px] h-[17px] text-brand shrink-0" aria-hidden="true" />
              <span className="text-base font-medium leading-[1.06]">Toutes les applications</span>
            </div>
            <div className="relative">
              <Icon icon="ph:magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-muted pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field app-search-input w-[180px] h-[36px] pl-8 pr-3 rounded-full text-text text-sm font-body leading-none placeholder:text-text-muted transition-[width,border-color,box-shadow] duration-200 focus:w-[240px] max-sm:w-[140px] max-sm:focus:w-[180px]"
              />
            </div>
          </div>
          {SHOW_CATEGORY_FILTERS && categories.length > 1 ? (
            <div className="flex items-center gap-2 flex-wrap max-md:flex-nowrap max-md:overflow-x-auto max-md:-mx-3 max-md:-my-2 max-md:px-3 max-md:py-2 favorites-scroll-hide">
              <button
                type="button"
                className={`min-h-[34px] px-[14px] border rounded-full font-inherit text-sm font-semibold transition-[background-color,border-color,color] duration-[120ms] ${selectedCategory === null ? 'lent-button' : 'glass-solid text-brand'}`}
                onClick={() => setSelectedCategory(null)}
              >
                Tout
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`min-h-[34px] px-[14px] border rounded-full font-inherit text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color] duration-[120ms] ${selectedCategory === category ? 'lent-button' : 'glass-solid text-brand'}`}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-1.5 max-md:grid-cols-1 max-md:gap-1">
            {filteredServices.map((service, index) => renderServiceCard(service, index))}
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
          <ContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            label={`Actions pour ${targetApplication.title}`}
            onClose={closeContextMenu}
            items={[
              { id: 'open', label: 'Ouvrir dans un nouvel onglet', icon: 'ph:arrow-square-out', onSelect: () => void handleOpenApplicationInNewTab(targetApplication) },
              { id: 'copy', label: 'Copier le lien', icon: 'ph:link', onSelect: () => void handleCopyApplicationLink(targetApplication) },
              'separator',
              isAddMode
                ? { id: 'favorite', label: 'Ajouter aux favoris', icon: 'ph:star', onSelect: () => void handleAddFavorite(targetApplication) }
                : { id: 'unfavorite', label: 'Retirer des favoris', icon: 'ph:x-circle', onSelect: () => void handleUnfavorite(targetApplication) },
            ]}
          />
        )
      })() : null}
    </>
  )
}

export default AvailableApplications
