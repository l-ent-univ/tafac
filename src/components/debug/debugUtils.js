// Helpers of the debug menu (dev only, loaded with it): the output's JSON,
// the local storage snapshot and the full reset.
import { ESTABLISHMENT_KEY, STUDENT_TP_KEY } from '../../profileStorage'
import { appendPreviewToken } from '../../profilePhoto'

const LOCAL_STORAGE_ACCOUNT_KEYS = [ESTABLISHMENT_KEY, STUDENT_TP_KEY]
const LOCAL_STORAGE_SETTINGS_KEYS = [
  'l-ent:favorites-order',
  'l-ent:local-pins',
  'l-ent:local-favorites',
  'l-ent:weather-city',
  'l-ent:grade-colors',
  'l-ent:visit-count',
  'l-ent:pwa-prompt-dismissed',
]
const LOCAL_STORAGE_CACHE_KEYS = [
  'l-ent:ade-timetable-cache',
]

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function clearClientRuntimeState() {
  try {
    localStorage.clear()
  } catch {
    // Ignore storage failures
  }

  try {
    sessionStorage.clear()
  } catch {
    // Ignore storage failures
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cacheKeys = await window.caches.keys()
      await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)))
    } catch {
      // Ignore cache storage failures
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    } catch {
      // Ignore service worker failures
    }
  }
}

export function prettyPrint(value) {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function parseStoredDebugValue(rawValue) {
  if (rawValue == null) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

function collectLocalStorageEntries(keys) {
  return Object.fromEntries(keys.map((key) => [key, parseStoredDebugValue(localStorage.getItem(key))]))
}

export function buildLocalStorageDebugSnapshot(userId = null) {
  try {
    const allKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
    const lentKeys = allKeys.filter((key) => key.startsWith('l-ent:'))
    const knownKeys = new Set([
      ...LOCAL_STORAGE_ACCOUNT_KEYS,
      ...LOCAL_STORAGE_SETTINGS_KEYS,
      ...LOCAL_STORAGE_CACHE_KEYS,
    ])
    const extraLentKeys = lentKeys.filter((key) => !knownKeys.has(key))

    return {
      currentUser: userId ?? null,
      summary: {
        totalLocalStorageKeys: allKeys.length,
        lentKeys: lentKeys.length,
        extraLentKeys: extraLentKeys.length,
      },
      account: collectLocalStorageEntries(LOCAL_STORAGE_ACCOUNT_KEYS),
      settings: collectLocalStorageEntries(LOCAL_STORAGE_SETTINGS_KEYS),
      caches: collectLocalStorageEntries(LOCAL_STORAGE_CACHE_KEYS),
      otherLentEntries: Object.fromEntries(extraLentKeys.map((key) => [key, parseStoredDebugValue(localStorage.getItem(key))])),
      allLentKeys: lentKeys,
    }
  } catch (error) {
    return {
      error: getErrorMessage(error),
    }
  }
}

// The photo the « Photo profil » call found, for the output's preview.
export function resolveDebugImagePreviewFromSnapshot(snapshot) {
  const data = snapshot?.data
  const token = snapshot?.capturedAt ?? String(Date.now())

  if (data?.available && data?.previewUrl) {
    return {
      src: appendPreviewToken(data.previewUrl, token),
      fieldPath: 'student-pic',
      kind: data.source ?? 'profile-photo',
    }
  }

  if (data?.photo?.available && data?.photo?.previewUrl) {
    return {
      src: appendPreviewToken(data.photo.previewUrl, token),
      fieldPath: data.photo.fieldPath ?? 'account',
      kind: data.photo.sourceKind ?? 'account',
    }
  }

  return null
}
