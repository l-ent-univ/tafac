export const DEMO_SESSION_MODE = 'demo'

export const DEMO_CREDENTIALS = Object.freeze({
  username: 'demo@tafac.fr',
  password: 'tafac-demo',
})

// The CAS login the demo's automatic signature shows where the university
// names it (mail.signature.showLogin): its username is an address, which
// the signature never shows.
export const DEMO_SIGNATURE_LOGIN = 'demo'

const DEMO_DEFAULT_FAVORITE_IDS = [
  'demo-mail',
  'demo-planning',
  'demo-moodle',
  'demo-directory',
]

const DEMO_SCHEDULE_TEMPLATES = [
  {
    key: 'ux-writing',
    dayOffset: 0,
    startHour: 9,
    startMinute: 0,
    durationMinutes: 120,
    title: 'R5.07 UX Writing',
    teacher: 'M. Le Goff',
    location: 'B03 - Salle Atelier',
  },
  {
    key: 'anglais-lun',
    dayOffset: 0,
    startHour: 11,
    startMinute: 15,
    durationMinutes: 90,
    title: 'R5.02 Anglais',
    teacher: 'Mme Kerjean',
    location: 'B12 - Langues',
  },
  {
    key: 'dev-back-lun',
    dayOffset: 0,
    startHour: 14,
    startMinute: 0,
    durationMinutes: 120,
    title: 'R5.12 Développement back-end',
    teacher: 'M. Lemoine',
    location: 'A08 - Info 2',
  },
  {
    key: 'accessibilite-mar',
    dayOffset: 1,
    startHour: 8,
    startMinute: 30,
    durationMinutes: 90,
    title: 'R5.03 Accessibilité numérique',
    teacher: 'Mme Riou',
    location: 'A10 - Info 4',
  },
  {
    key: 'portfolio-mar',
    dayOffset: 1,
    startHour: 10,
    startMinute: 15,
    durationMinutes: 90,
    title: 'Portfolio',
    teacher: 'Mme Le Fur',
    location: 'B03 - Salle Atelier',
  },
  {
    key: 'sae-proto',
    dayOffset: 1,
    startHour: 13,
    startMinute: 30,
    durationMinutes: 180,
    title: 'SAE Prototype interactif',
    teacher: 'Mme Le Fur',
    location: 'C12 - FabLab',
  },
  {
    key: 'gestion-projet-mer',
    dayOffset: 2,
    startHour: 8,
    startMinute: 30,
    durationMinutes: 90,
    title: 'R5.04 Gestion de projet',
    teacher: 'M. Guillou',
    location: 'B08 - TD 3',
  },
  {
    key: 'dev-front',
    dayOffset: 2,
    startHour: 10,
    startMinute: 15,
    durationMinutes: 105,
    title: 'R5.11 Développement Front',
    teacher: 'M. Lemoine',
    location: 'A08 - Info 2',
  },
  {
    key: 'ux-writing-mer',
    dayOffset: 2,
    startHour: 14,
    startMinute: 0,
    durationMinutes: 120,
    title: 'R5.07 UX Writing',
    teacher: 'Mme Riou',
    location: 'B03 - Salle Atelier',
  },
  {
    key: 'anglais-mer',
    dayOffset: 2,
    startHour: 16,
    startMinute: 15,
    durationMinutes: 90,
    title: 'R5.02 Anglais',
    teacher: 'Mme Kerjean',
    location: 'B12 - Langues',
  },
  {
    key: 'dev-back-jeu',
    dayOffset: 3,
    startHour: 8,
    startMinute: 30,
    durationMinutes: 120,
    title: 'R5.12 Développement back-end',
    teacher: 'M. Lemoine',
    location: 'A08 - Info 2',
  },
  {
    key: 'ux-writing-jeu',
    dayOffset: 3,
    startHour: 10,
    startMinute: 45,
    durationMinutes: 90,
    title: 'R5.07 UX Writing',
    teacher: 'M. Le Goff',
    location: 'B03 - Salle Atelier',
  },
  {
    key: 'culture-num',
    dayOffset: 3,
    startHour: 15,
    startMinute: 15,
    durationMinutes: 90,
    title: 'R5.09 Culture numérique',
    teacher: 'Mme Martin',
    location: 'Amphi 2',
  },
  {
    key: 'sae-proto-ven',
    dayOffset: 4,
    startHour: 9,
    startMinute: 0,
    durationMinutes: 180,
    title: 'SAE Prototype interactif',
    teacher: 'Mme Le Fur',
    location: 'C12 - FabLab',
  },
  {
    key: 'gestion-projet-ven',
    dayOffset: 4,
    startHour: 13,
    startMinute: 30,
    durationMinutes: 90,
    title: 'R5.04 Gestion de projet',
    teacher: 'M. Guillou',
    location: 'B08 - TD 3',
  },
  {
    key: 'accessibilite-ven',
    dayOffset: 4,
    startHour: 15,
    startMinute: 15,
    durationMinutes: 90,
    title: 'R5.03 Accessibilité numérique',
    teacher: 'Mme Riou',
    location: 'A10 - Info 4',
  },
]

// The demo's « Emplois du temps »: a public calendar for its link, it opens
// the in-app Planning page all the same (planningPortalApp.js's `appKeys`).
export const DEMO_PLANNING_APP_FNAME = 'demo-emploi-du-temps'
// The demo's webmail app: the mail page opens in its place (mailPortalApp.js).
export const DEMO_MAIL_APP_FNAME = 'demo-messagerie'

const DEMO_APPLICATIONS = Object.freeze([
  {
    id: 'demo-mail',
    fname: DEMO_MAIL_APP_FNAME,
    title: 'Messagerie',
    description: 'Consulter un webmail de démonstration.',
    href: 'https://outlook.office.com/mail/',
    target: '_blank',
  },
  {
    id: 'demo-planning',
    fname: DEMO_PLANNING_APP_FNAME,
    title: 'Emplois du temps',
    description: 'Ouvrir un calendrier public.',
    href: 'https://calendar.google.com/',
    target: '_blank',
  },
  {
    id: 'demo-moodle',
    fname: 'demo-moodle',
    title: 'Moodle',
    description: 'Découvrir une plateforme de cours en ligne.',
    href: 'https://moodle.org/',
    target: '_blank',
  },
  {
    id: 'demo-directory',
    fname: 'demo-annuaire',
    title: 'Annuaire',
    description: 'Parcourir un annuaire public.',
    href: 'https://www.pagesjaunes.fr/',
    target: '_blank',
  },
  {
    id: 'demo-docs',
    fname: 'demo-documentation',
    title: 'Documentation services',
    description: 'Lire une documentation produit publique.',
    href: 'https://support.microsoft.com/',
    target: '_blank',
  },
  {
    id: 'demo-help',
    fname: 'demo-assistance',
    title: 'Assistance',
    description: 'Consulter une page d’aide.',
    href: 'https://support.google.com/',
    target: '_blank',
  },
  {
    id: 'demo-webconf',
    fname: 'demo-webconference',
    title: 'Webconference',
    description: 'Lancer une visioconférence publique.',
    href: 'https://meet.jit.si/',
    target: '_blank',
  },
  {
    id: 'demo-365',
    fname: 'demo-m365',
    title: 'Microsoft 365',
    description: 'Voir la suite bureautique en ligne.',
    href: 'https://www.microsoft.com/microsoft-365',
    target: '_blank',
  },
])

const DEMO_APPLICATIONS_BY_ID = new Map(DEMO_APPLICATIONS.map((application) => [application.id, application]))
const DEMO_APPLICATIONS_BY_FNAME = new Map(DEMO_APPLICATIONS.map((application) => [application.fname, application]))

const DEMO_TREE_ROOT = Object.freeze({
  id: '-100',
  name: 'Ressources',
  path: 'Ressources',
  children: [
    {
      id: '10',
      name: 'IUT Lannion',
      path: 'Université de Rennes / IUT Lannion',
      children: [
        {
          id: '110',
          name: 'BUT MMI',
          path: 'Université de Rennes / IUT Lannion / BUT MMI',
          children: [
            {
              id: '111',
              name: 'MMI 2',
              path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2',
              children: [
                {
                  id: '1111',
                  name: 'TD A',
                  path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2 / TD A',
                  children: [
                    {
                      id: '11111',
                      name: 'TP 1',
                      path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2 / TD A / TP 1',
                      children: [],
                    },
                    {
                      id: '11112',
                      name: 'TP 2',
                      path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2 / TD A / TP 2',
                      children: [],
                    },
                  ],
                },
                {
                  id: '1112',
                  name: 'TD B',
                  path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2 / TD B',
                  children: [
                    {
                      id: '11121',
                      name: 'TP 3',
                      path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 2 / TD B / TP 3',
                      children: [],
                    },
                  ],
                },
              ],
            },
            {
              id: '112',
              name: 'MMI 1',
              path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 1',
              children: [
                {
                  id: '1121',
                  name: 'TD A',
                  path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 1 / TD A',
                  children: [
                    {
                      id: '11211',
                      name: 'TP 1',
                      path: 'Université de Rennes / IUT Lannion / BUT MMI / MMI 1 / TD A / TP 1',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
})

const DEMO_DEFAULT_TREE_PATH = Object.freeze(['-100', '10', '110', '111', '1111', '11111'])

function cloneDemoValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createDemoAvatarDataUri(initials = 'CM') {
  // Just the initials on a flat warm tone; the app crops it to a circle.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Avatar demo"><rect width="128" height="128" fill="#ebe4d6"/><text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="46" font-weight="600" fill="#341200">${escapeHtml(initials)}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export const DEMO_ACCOUNT = Object.freeze({
  preferred_username: DEMO_CREDENTIALS.username,
  given_name: 'Camille',
  family_name: 'Martin',
  email: DEMO_CREDENTIALS.username,
  mail: DEMO_CREDENTIALS.username,
  name: 'Camille Martin',
  picture: createDemoAvatarDataUri('CM'),
})

function normalizeDemoFavoriteIds(value) {
  if (!Array.isArray(value)) {
    return [...DEMO_DEFAULT_FAVORITE_IDS]
  }

  return value
    .map((id) => String(id ?? '').trim())
    .filter((id, index, ids) => id && ids.indexOf(id) === index && DEMO_APPLICATIONS_BY_ID.has(id))
}

export function isDemoCredentials(username, password) {
  return String(username ?? '').trim().toLowerCase() === DEMO_CREDENTIALS.username.toLowerCase()
    && String(password ?? '') === DEMO_CREDENTIALS.password
}

export function createInitialDemoState() {
  return {
    favoritePortletIds: [...DEMO_DEFAULT_FAVORITE_IDS],
  }
}

export function normalizeDemoState(value) {
  return {
    favoritePortletIds: normalizeDemoFavoriteIds(value?.favoritePortletIds),
  }
}

function getDemoApplicationPortlets(ids = []) {
  return ids
    .map((id) => DEMO_APPLICATIONS_BY_ID.get(id))
    .filter(Boolean)
    .map((application) => ({
      _objectType: 'portlet',
      ID: application.id,
      nodeId: application.id,
      chanID: application.id,
      fname: application.fname,
      title: application.title,
      name: application.title,
      description: application.description,
      portletName: 'app-launcher',
      typeID: '2',
      parameters: {
        launchUrl: application.href,
        description: application.description,
        target: application.target,
        stopImmediately: application.target === '_blank' ? 'true' : 'false',
      },
      widgetURL: application.href,
      url: application.href,
      target: application.target,
    }))
}

export function buildDemoLayoutData(demoStateInput) {
  const demoState = normalizeDemoState(demoStateInput)
  const favoritePortlets = getDemoApplicationPortlets(demoState.favoritePortletIds)
  const allPortlets = getDemoApplicationPortlets(DEMO_APPLICATIONS.map((application) => application.id))

  return {
    authenticated: 'true',
    user: DEMO_ACCOUNT.preferred_username,
    layout: {
      globals: {
        hasFavorites: 'true',
      },
      navigation: {
        tabs: [
          {
            ID: 'demo-tab-services',
            name: 'Services',
            content: [
              {
                _objectType: 'folder',
                ID: 'demo-folder-favorites',
                name: 'Favoris',
                content: favoritePortlets,
              },
              {
                _objectType: 'folder',
                ID: 'demo-folder-services',
                name: 'Toutes les applications',
                content: allPortlets,
              },
            ],
          },
        ],
        favorites: favoritePortlets,
      },
      favorites: favoritePortlets,
    },
  }
}

export function buildDemoLayoutDocData() {
  return DEMO_APPLICATIONS.map((application) => ({
    ID: application.id,
    nodeId: application.id,
    fname: application.fname,
    title: application.title,
    name: application.title,
    description: application.description,
    portletName: 'app-launcher',
    typeID: '2',
    parameters: {
      launchUrl: application.href,
      description: application.description,
      target: application.target,
      stopImmediately: application.target === '_blank' ? 'true' : 'false',
    },
    widgetURL: application.href,
    url: application.href,
    target: application.target,
  }))
}

export function buildDemoMarketplaceEntries() {
  return []
}

export function buildDemoPortletFragment(fname) {
  const application = DEMO_APPLICATIONS_BY_FNAME.get(String(fname ?? '').trim())
  if (!application) {
    return null
  }

  return `<div class="demo-portlet-fragment"><a href="${escapeHtml(application.href)}" target="${escapeHtml(application.target)}" rel="noreferrer">${escapeHtml(application.title)}</a></div>`
}

export function buildDemoPortletMetadata(fname) {
  const application = DEMO_APPLICATIONS_BY_FNAME.get(String(fname ?? '').trim())
  if (!application) {
    return null
  }

  return {
    ID: application.id,
    nodeId: application.id,
    fname: application.fname,
    title: application.title,
    name: application.title,
    description: application.description,
    portletName: 'app-launcher',
    typeID: '2',
    parameters: {
      launchUrl: application.href,
      description: application.description,
      target: application.target,
      stopImmediately: application.target === '_blank' ? 'true' : 'false',
    },
    widgetURL: application.href,
    url: application.href,
    target: application.target,
  }
}

function insertAfter(list, targetValue, nextValue) {
  const nextList = [...list]
  const targetIndex = nextList.indexOf(targetValue)

  if (targetIndex !== -1) {
    return nextList
  }

  if (nextValue && nextList.includes(nextValue)) {
    nextList.splice(nextList.indexOf(nextValue), 0, targetValue)
    return nextList
  }

  nextList.push(targetValue)
  return nextList
}

export function applyDemoLayoutMutation(requestPath, demoStateInput) {
  const demoState = normalizeDemoState(demoStateInput)
  const requestUrl = new URL(String(requestPath ?? '/api/layout'), 'https://demo.l-ent.local')

  if (requestUrl.pathname !== '/api/layout') {
    return {
      handled: false,
      demoState,
    }
  }

  const sourceId = String(
    requestUrl.searchParams.get('sourceId')
      || requestUrl.searchParams.get('sourceID')
      || '',
  ).trim()

  if (!DEMO_APPLICATIONS_BY_ID.has(sourceId)) {
    return {
      handled: true,
      demoState,
    }
  }

  const favoritePortletIds = demoState.favoritePortletIds.includes(sourceId)
    ? demoState.favoritePortletIds.filter((id) => id !== sourceId)
    : insertAfter(
      demoState.favoritePortletIds,
      sourceId,
      String(requestUrl.searchParams.get('nextNodeId') || '').trim(),
    )

  return {
    handled: true,
    demoState: normalizeDemoState({ favoritePortletIds }),
    payload: {
      ok: true,
      action: requestUrl.searchParams.get('action') || 'toggleFavorite',
      favoritePortletIds,
    },
  }
}

function findDemoTreeNodeById(node, targetId) {
  if (!node) {
    return null
  }

  if (String(node.id) === String(targetId)) {
    return node
  }

  for (const child of node.children ?? []) {
    const match = findDemoTreeNodeById(child, targetId)
    if (match) {
      return match
    }
  }

  return null
}

function findDemoTreePathIds(node, targetId, currentPath = []) {
  if (!node) {
    return null
  }

  const nextPath = [...currentPath, String(node.id)]
  if (String(node.id) === String(targetId)) {
    return nextPath
  }

  for (const child of node.children ?? []) {
    const match = findDemoTreePathIds(child, targetId, nextPath)
    if (match) {
      return match
    }
  }

  return null
}

function collectDemoTreeNodes(node, collector) {
  if (!node) {
    return
  }

  collector.push(node)

  for (const child of node.children ?? []) {
    collectDemoTreeNodes(child, collector)
  }
}

export function buildDemoAdeTreePayload(requestedResourceId = '') {
  const normalizedRequestedResourceId = String(requestedResourceId ?? '').trim()
  const hasRequestedResource = normalizedRequestedResourceId && findDemoTreeNodeById(DEMO_TREE_ROOT, normalizedRequestedResourceId)
  const focusResourceId = hasRequestedResource ? normalizedRequestedResourceId : DEMO_DEFAULT_TREE_PATH[DEMO_DEFAULT_TREE_PATH.length - 1]
  const currentPathIds = findDemoTreePathIds(DEMO_TREE_ROOT, focusResourceId) ?? [...DEMO_DEFAULT_TREE_PATH]

  return {
    source: 'demo',
    root: cloneDemoValue(DEMO_TREE_ROOT),
    currentResourceId: currentPathIds[currentPathIds.length - 1] ?? null,
    focusResourceId,
    currentPathIds,
  }
}

export function searchDemoAdeTree(query) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  const nodes = []
  collectDemoTreeNodes(DEMO_TREE_ROOT, nodes)

  return nodes
    .filter((node) => {
      const haystack = [node.name, node.path, node.id].join(' | ').toLowerCase()
      return haystack.includes(normalizedQuery) && String(node.id) !== '-100'
    })
    .map((node) => ({
      id: String(node.id),
      name: node.name,
      path: node.path,
      childrenCount: Array.isArray(node.children) ? node.children.length : 0,
    }))
}

function parseDateOnly(dateString) {
  const rawValue = String(dateString ?? '').trim()
  if (!rawValue) {
    return new Date()
  }

  const parts = rawValue.split('-').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return new Date(rawValue)
  }

  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0)
}

function formatDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(date) {
  const nextDate = new Date(date)
  nextDate.setHours(0, 0, 0, 0)
  const currentDay = nextDate.getDay()
  const shift = currentDay === 0 ? -6 : 1 - currentDay
  nextDate.setDate(nextDate.getDate() + shift)
  return nextDate
}

function addDays(date, amount) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + amount)
  return nextDate
}

function makeLocalDateTime(date, hours, minutes) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    0,
    0,
  )
}

function getSelectionLabel(selection = null) {
  return selection?.tpLabel
    || selection?.tdLabel
    || selection?.yearLabel
    || 'TP 1'
}

function buildDemoEventsForWeek(anchorDate, selectionLabel) {
  const weekStart = startOfWeek(anchorDate)

  return DEMO_SCHEDULE_TEMPLATES.map((template) => {
    const eventDate = addDays(weekStart, template.dayOffset)
    const start = makeLocalDateTime(eventDate, template.startHour, template.startMinute)
    const end = new Date(start.getTime() + template.durationMinutes * 60 * 1000)

    return {
      id: `${template.key}-${formatDateOnly(start)}`,
      title: template.title,
      teacher: template.teacher,
      location: template.location,
      description: template.title,
      groups: [selectionLabel],
      start: start.toISOString(),
      end: end.toISOString(),
    }
  })
}

function normalizeSelectionFromResource(resourceId = '') {
  const normalizedResourceId = String(resourceId ?? '').trim()
  const currentPathIds = findDemoTreePathIds(DEMO_TREE_ROOT, normalizedResourceId) ?? DEMO_DEFAULT_TREE_PATH
  const selectedNode = findDemoTreeNodeById(DEMO_TREE_ROOT, currentPathIds[currentPathIds.length - 1])

  return {
    resourceId: selectedNode ? String(selectedNode.id) : DEMO_DEFAULT_TREE_PATH[DEMO_DEFAULT_TREE_PATH.length - 1],
    label: selectedNode?.name ?? 'TP 1',
  }
}

function buildWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 4)
  return `Semaine du ${formatDateOnly(weekStart)} au ${formatDateOnly(weekEnd)}`
}

export function buildDemoTimetablePayload({ date, resourceId } = {}) {
  const anchorDate = parseDateOnly(date || formatDateOnly(new Date()))
  const resolvedSelection = normalizeSelectionFromResource(resourceId)
  const weekStart = startOfWeek(anchorDate)
  const events = buildDemoEventsForWeek(anchorDate, resolvedSelection.label)

  return {
    source: 'demo',
    date: formatDateOnly(anchorDate),
    resourceId: resolvedSelection.resourceId,
    weekLabel: buildWeekLabel(weekStart),
    resolvedWeek: {
      label: buildWeekLabel(weekStart),
      start: formatDateOnly(weekStart),
      end: formatDateOnly(addDays(weekStart, 6)),
      current: formatDateOnly(startOfWeek(new Date())) === formatDateOnly(weekStart),
    },
    outOfRange: false,
    dayLabels: Array.from({ length: 5 }, (_, index) => formatDateOnly(addDays(weekStart, index))),
    events,
  }
}

export function buildDemoPlanningPayload({ date, resourceId } = {}) {
  const timetable = buildDemoTimetablePayload({ date, resourceId })
  return {
    events: timetable.events,
    weekLabel: timetable.weekLabel,
    dayLabels: timetable.dayLabels,
    resolvedWeek: timetable.resolvedWeek,
    outOfRange: timetable.outOfRange,
  }
}

export function buildDemoCalendarPayload({ date, resourceId } = {}) {
  const anchorDate = parseDateOnly(date || formatDateOnly(new Date()))
  const weekStart = startOfWeek(anchorDate)
  const resolvedSelection = normalizeSelectionFromResource(resourceId)
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const currentWeekStart = addDays(weekStart, index * 7)
    const currentWeekEnd = addDays(currentWeekStart, 6)

    return {
      index,
      label: buildWeekLabel(currentWeekStart),
      start: formatDateOnly(currentWeekStart),
      end: formatDateOnly(currentWeekEnd),
      current: index === 0,
    }
  })

  return {
    source: 'demo',
    resourceId: resolvedSelection.resourceId,
    currentResourceId: resolvedSelection.resourceId,
    requestedResourceId: String(resourceId ?? '').trim() || resolvedSelection.resourceId,
    targetDate: formatDateOnly(anchorDate),
    targetDateMatched: true,
    outOfRange: false,
    matchedWeek: weeks[0],
    currentWeek: weeks[0],
    firstWeek: weeks[0],
    lastWeek: weeks[weeks.length - 1],
    weekCount: weeks.length,
    weeks,
  }
}

export function buildDemoUpcomingPayload({ date, lookaheadDays = 14, selection = null } = {}) {
  const requestedDate = parseDateOnly(date || formatDateOnly(new Date()))
  const selectionLabel = getSelectionLabel(selection)
  const upcomingEvents = [
    ...buildDemoEventsForWeek(requestedDate, selectionLabel),
    ...buildDemoEventsForWeek(addDays(requestedDate, 7), selectionLabel),
  ]
    .filter((event) => {
      const eventStart = new Date(event.start)
      const maxDate = addDays(requestedDate, lookaheadDays)
      return eventStart >= requestedDate && eventStart <= maxDate
    })
    .sort((left, right) => left.start.localeCompare(right.start))

  return {
    source: 'demo',
    date: formatDateOnly(requestedDate),
    lookaheadDays,
    complete: true,
    resourceIds: [
      selection?.tpResourceId,
      selection?.tdResourceId,
      selection?.yearResourceId,
      selection?.resourceId,
    ].filter(Boolean).map((value) => String(value)),
    selectionLabels: [selectionLabel],
    events: upcomingEvents,
    nextEvent: upcomingEvents[0] ?? null,
  }
}

export function buildDemoAlertsPayload() {
  return [
    {
      level: 'info',
      title: 'Mode démo',
      message: 'Certaines applications ouvrent des pages publiques pour illustrer le parcours.',
    },
  ]
}

// Demo ScoDoc relevés ("Mes notes"): see demoGrades.js.
export {
  DEMO_GRADES_DEPARTMENT_MESSAGE,
  buildDemoEvaluationDistribution,
  buildDemoGradesPayload,
  buildDemoSemesterGradesPayload,
} from './demoGrades.js'

// Demo inbox for the "Mails récents" widget. `minutesAgo` is resolved against
// the request time so the widget always shows fresh-looking relative dates.
const DEMO_MAIL_MESSAGES = Object.freeze([
  {
    id: 'demo-mail-1',
    minutesAgo: 12,
    unread: true,
    from: { name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' },
    subject: 'R5.11 – Rendu du TP React décalé à vendredi',
    snippet: 'Bonjour à tous, suite aux soucis de serveur de mardi, le rendu du TP 4 (composants et état) est repoussé à vendredi 18h sur Moodle. Pensez à…',
  },
  {
    id: 'demo-mail-2',
    minutesAgo: 95,
    unread: true,
    from: { name: 'Scolarité IUT de Lannion', email: 'scolarite-iut-lannion@univ-rennes.fr' },
    subject: 'Inscriptions pédagogiques S6 : ouverture le 14 octobre',
    snippet: 'Madame, Monsieur, les inscriptions pédagogiques du semestre 6 seront ouvertes du 14 au 25 octobre via votre dossier étudiant. Le choix des parcours…',
  },
  {
    id: 'demo-mail-3',
    minutesAgo: 60 * 5 + 20,
    unread: false,
    from: { name: 'Moodle UR', email: 'noreply-moodle@univ-rennes.fr' },
    subject: 'Nouveau devoir : SAE Prototype interactif – Livrable 2',
    snippet: 'Mme Le Fur a publié un nouveau devoir dans le cours « SAE Prototype interactif ». Date limite : lundi 23:59. Consultez les consignes détaillées…',
  },
  {
    id: 'demo-mail-4',
    minutesAgo: 60 * 22,
    unread: true,
    from: { name: 'BU Lannion', email: 'bu-lannion@univ-rennes.fr' },
    subject: 'Rappel : 2 documents à rendre avant le 10/10',
    snippet: 'Bonjour Camille, nous vous rappelons que les documents suivants arrivent à échéance : « Design emotionnel » (D. Norman), « Refactoring UI »…',
  },
  {
    id: 'demo-mail-5',
    minutesAgo: 60 * 28,
    unread: false,
    from: { name: 'BDE MMI Lannion', email: 'bde.mmi.lannion@gmail.com' },
    subject: 'Soirée d’intégration jeudi 🎉 dernières places',
    snippet: 'Salut les MMI ! Il reste une vingtaine de places pour la soirée de jeudi au Quai des Bulles. Inscription et paiement sur le HelloAsso avant mercredi…',
  },
])

// Demo sessions open the same demo webmail as the "Messagerie" app tile,
// never the real university webmail.
const DEMO_WEBMAIL_HREF = DEMO_APPLICATIONS.find((application) => application.id === 'demo-mail')?.href ?? null

export function buildDemoMailPayload({ now = Date.now(), webmailHref = DEMO_WEBMAIL_HREF } = {}) {
  const messages = DEMO_MAIL_MESSAGES.map(({ minutesAgo, ...message }) => ({
    ...cloneDemoValue(message),
    receivedAt: new Date(now - minutesAgo * 60 * 1000).toISOString(),
    href: null,
  }))

  return {
    unreadCount: 7,
    webmailHref,
    messages,
    hasMore: false,
  }
}

// Demo deadlines for the "Échéances Moodle" widget. `hoursFromNow` is resolved
// against the request time (negative = overdue) so dates always look current.
const DEMO_MOODLE_DEADLINES = Object.freeze([
  {
    id: 'demo-moodle-tp3-api',
    hoursFromNow: -2 * 24 - 3,
    title: 'TP 3 – API REST avec Express',
    courseName: 'R5.12 Développement back-end',
    type: 'assign',
    submitted: false,
  },
  {
    id: 'demo-moodle-sae501-livrable2',
    hoursFromNow: 4,
    title: 'Rendu SAE 501 – Livrable 2',
    courseName: 'SAE 5.01 Développement web',
    type: 'assign',
    submitted: false,
  },
  {
    id: 'demo-moodle-qcm-rgaa',
    hoursFromNow: 24 + 2,
    title: 'QCM – Accessibilité et RGAA',
    courseName: 'R5.03 Accessibilité numérique',
    type: 'quiz',
    submitted: false,
  },
  {
    id: 'demo-moodle-forum-maquettes',
    hoursFromNow: 3 * 24 + 5,
    title: 'Forum : retours croisés sur les maquettes',
    courseName: 'R5.07 Design d’interaction',
    type: 'forum',
    submitted: null,
  },
  {
    id: 'demo-moodle-veille',
    hoursFromNow: 7 * 24,
    title: 'Dossier de veille technologique',
    courseName: 'R5.06 Culture numérique',
    type: 'assign',
    submitted: true,
  },
  {
    id: 'demo-moodle-sondage-s5',
    hoursFromNow: 10 * 24 + 6,
    title: 'Questionnaire de mi-semestre S5',
    courseName: 'BUT MMI 3 – Vie de promo',
    type: 'other',
    submitted: null,
  },
])

// Demo sessions open the demo "Moodle" app tile, never the real Moodle.
const DEMO_MOODLE_HREF = DEMO_APPLICATIONS.find((application) => application.id === 'demo-moodle')?.href ?? null

export function buildDemoMoodleDeadlinesPayload({ now = Date.now(), moodleHref = DEMO_MOODLE_HREF } = {}) {
  const quarterHourMs = 15 * 60 * 1000
  const items = DEMO_MOODLE_DEADLINES.map(({ hoursFromNow, ...deadline }) => {
    // Round to the next quarter hour so due times look like real deadlines.
    const dueAtMs = Math.ceil((now + hoursFromNow * 60 * 60 * 1000) / quarterHourMs) * quarterHourMs
    return {
      ...cloneDemoValue(deadline),
      dueAt: new Date(dueAtMs).toISOString(),
      overdue: dueAtMs < now,
      href: null,
    }
  }).sort((left, right) => left.dueAt.localeCompare(right.dueAt))

  return { moodleHref, items }
}
