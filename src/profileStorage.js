export const ESTABLISHMENT_KEY = 'l-ent:establishment'
export const STUDENT_TP_KEY = 'l-ent:student-tp'
export const ADE_LOOKAHEAD_KEY = 'l-ent:ade-lookahead-days'
export const GREETING_HIDDEN_KEY = 'l-ent:greeting-hidden'
export const HIDDEN_WIDGETS_KEY = 'l-ent:hidden-widgets'
export const APP_DESCRIPTIONS_KEY = 'l-ent:show-app-descriptions'
export const PLANNING_WEEKEND_KEY = 'l-ent:planning-weekend'
export const WALLPAPER_KEY = 'l-ent:show-wallpaper'
export const UNIVERSITY_LOGO_KEY = 'l-ent:show-university-logo'
export const LOGO_SOURCE_KEY = 'l-ent:logo-source'
export const ANONYMOUS_ANALYTICS_KEY = 'l-ent:anonymous-analytics'
const STUDENT_TP_SELECTION_VERSION = 4

// Discrete steps offered by the "next class" lookahead slider (in days).
export const ADE_LOOKAHEAD_DAY_OPTIONS = [7, 14, 21, 30, 60]
export const DEFAULT_ADE_LOOKAHEAD_DAYS = 21

function readStoredValue(key) {
  try {
    const rawValue = localStorage.getItem(key)
    if (!rawValue) {
      return null
    }

    try {
      return JSON.parse(rawValue)
    } catch {
      return rawValue
    }
  } catch {
    return null
  }
}

function readScopedStorageValue(key, userId) {
  const storedValue = readStoredValue(key)

  if (!storedValue) {
    return null
  }

  if (typeof storedValue === 'string') {
    return userId ? null : storedValue
  }

  if (typeof storedValue !== 'object' || storedValue === null) {
    return null
  }

  if ('value' in storedValue) {
    if (userId && storedValue.user && storedValue.user !== userId) {
      return null
    }
    return storedValue.value
  }

  if (userId && storedValue.user && storedValue.user !== userId) {
    return null
  }

  return storedValue
}

export function getStoredEstablishment(userId = null) {
  const storedValue = readScopedStorageValue(ESTABLISHMENT_KEY, userId)
  return typeof storedValue === 'string' && storedValue.trim() ? storedValue : null
}

export function persistEstablishment(establishmentId, userId = null) {
  try {
    localStorage.setItem(ESTABLISHMENT_KEY, JSON.stringify({
      user: userId || null,
      value: establishmentId,
    }))
  } catch {
    // Storage unavailable
  }
}

function normalizeTpSelection(selection, { requireVersion = false } = {}) {
  if (!selection || typeof selection !== 'object') {
    return null
  }

  if (requireVersion && Number(selection.selectionVersion ?? 0) < STUDENT_TP_SELECTION_VERSION) {
    return null
  }

  const resourceId = String(selection.resourceId ?? '').trim()
  const label = String(selection.label ?? '').trim()

  if (!resourceId || !label) {
    return null
  }

  return {
    resourceId,
    label,
    parentResourceId: selection.parentResourceId == null ? null : String(selection.parentResourceId),
    parentLabel: selection.parentLabel ? String(selection.parentLabel) : null,
    contextLabel: selection.contextLabel ? String(selection.contextLabel) : null,
    programResourceId: selection.programResourceId == null ? null : String(selection.programResourceId),
    programLabel: selection.programLabel ? String(selection.programLabel) : null,
    yearResourceId: selection.yearResourceId == null ? null : String(selection.yearResourceId),
    yearLabel: selection.yearLabel ? String(selection.yearLabel) : null,
    tdResourceId: selection.tdResourceId == null ? null : String(selection.tdResourceId),
    tdLabel: selection.tdLabel ? String(selection.tdLabel) : null,
    tpResourceId: selection.tpResourceId == null ? null : String(selection.tpResourceId),
    tpLabel: selection.tpLabel ? String(selection.tpLabel) : null,
  }
}

export function getStoredTpSelection(userId = null) {
  return normalizeTpSelection(readScopedStorageValue(STUDENT_TP_KEY, userId), { requireVersion: true })
}

export function persistTpSelection(selection, userId = null) {
  const normalizedSelection = normalizeTpSelection(selection)
  if (!normalizedSelection) {
    return
  }

  try {
    localStorage.setItem(STUDENT_TP_KEY, JSON.stringify({
      user: userId || null,
      selectionVersion: STUDENT_TP_SELECTION_VERSION,
      ...normalizedSelection,
    }))
  } catch {
    // Storage unavailable
  }
}

export function clearStoredTpSelection() {
  try {
    localStorage.removeItem(STUDENT_TP_KEY)
  } catch {
    // Storage unavailable
  }
}

function normalizeAdeLookaheadDays(value) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return DEFAULT_ADE_LOOKAHEAD_DAYS
  }

  if (ADE_LOOKAHEAD_DAY_OPTIONS.includes(numeric)) {
    return numeric
  }

  // Snap unknown/legacy values to the closest available step.
  return ADE_LOOKAHEAD_DAY_OPTIONS.reduce((closest, option) => (
    Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest
  ), ADE_LOOKAHEAD_DAY_OPTIONS[0])
}

export function getStoredAdeLookaheadDays(userId = null) {
  const storedValue = readScopedStorageValue(ADE_LOOKAHEAD_KEY, userId)

  if (storedValue == null || storedValue === '') {
    return DEFAULT_ADE_LOOKAHEAD_DAYS
  }

  return normalizeAdeLookaheadDays(storedValue)
}

export function persistAdeLookaheadDays(days, userId = null) {
  try {
    localStorage.setItem(ADE_LOOKAHEAD_KEY, JSON.stringify({
      user: userId || null,
      value: normalizeAdeLookaheadDays(days),
    }))
  } catch {
    // Storage unavailable
  }
}

// Ids of dashboard widgets the user hid (see src/dashboardWidgets.js).
// Falls back to the older greeting-only flag so a dismissed greeting stays hidden.
export function getStoredHiddenWidgets(userId = null) {
  const storedValue = readScopedStorageValue(HIDDEN_WIDGETS_KEY, userId)
  if (Array.isArray(storedValue)) {
    return storedValue.filter((widgetId) => typeof widgetId === 'string')
  }

  return readScopedStorageValue(GREETING_HIDDEN_KEY, userId) === true ? ['greeting'] : []
}

export function persistHiddenWidgets(widgetIds, userId = null) {
  try {
    localStorage.setItem(HIDDEN_WIDGETS_KEY, JSON.stringify({
      user: userId || null,
      value: Array.from(new Set(widgetIds)),
    }))
    localStorage.removeItem(GREETING_HIDDEN_KEY)
  } catch {
    // Storage unavailable
  }
}

export function getStoredShowAppDescriptions(userId = null) {
  return readScopedStorageValue(APP_DESCRIPTIONS_KEY, userId) === true
}

export function persistShowAppDescriptions(show, userId = null) {
  try {
    localStorage.setItem(APP_DESCRIPTIONS_KEY, JSON.stringify({
      user: userId || null,
      value: Boolean(show),
    }))
  } catch {
    // Storage unavailable
  }
}

// The planning week's Saturday and Sunday without classes (Mon compte):
// hidden unless this user shows them.
export function getStoredShowPlanningWeekend(userId = null) {
  return readScopedStorageValue(PLANNING_WEEKEND_KEY, userId) === true
}

export function persistShowPlanningWeekend(show, userId = null) {
  try {
    localStorage.setItem(PLANNING_WEEKEND_KEY, JSON.stringify({
      user: userId || null,
      value: Boolean(show),
    }))
  } catch {
    // Storage unavailable
  }
}

// Dashboard background photo (Mon compte): off unless this user switched it on.
export function getStoredShowWallpaper(userId = null) {
  return readScopedStorageValue(WALLPAPER_KEY, userId) === true
}

export function persistShowWallpaper(show, userId = null) {
  try {
    localStorage.setItem(WALLPAPER_KEY, JSON.stringify({
      user: userId || null,
      value: Boolean(show),
    }))
  } catch {
    // Storage unavailable
  }
}

// The logo next to Tafac's, sidebar and header (Mon compte): shown unless
// this user hid it.
export function getStoredShowUniversityLogo(userId = null) {
  return readScopedStorageValue(UNIVERSITY_LOGO_KEY, userId) !== false
}

export function persistShowUniversityLogo(show, userId = null) {
  try {
    localStorage.setItem(UNIVERSITY_LOGO_KEY, JSON.stringify({
      user: userId || null,
      value: Boolean(show),
    }))
  } catch {
    // Storage unavailable
  }
}

// Whose logo that is when the student's establishment has its own (Mon
// compte): the establishment's ('establishment') unless this user picked
// the university's ('university').
export function getStoredLogoSource(userId = null) {
  return readScopedStorageValue(LOGO_SOURCE_KEY, userId) === 'university' ? 'university' : 'establishment'
}

export function persistLogoSource(source, userId = null) {
  try {
    localStorage.setItem(LOGO_SOURCE_KEY, JSON.stringify({
      user: userId || null,
      value: source === 'university' ? 'university' : 'establishment',
    }))
  } catch {
    // Storage unavailable
  }
}

// "Statistiques anonymes" (Mon compte): on unless this user switched it off.
export function getStoredAnonymousAnalytics(userId = null) {
  return readScopedStorageValue(ANONYMOUS_ANALYTICS_KEY, userId) !== false
}

export function persistAnonymousAnalytics(enabled, userId = null) {
  try {
    localStorage.setItem(ANONYMOUS_ANALYTICS_KEY, JSON.stringify({
      user: userId || null,
      value: Boolean(enabled),
    }))
  } catch {
    // Storage unavailable
  }
}
