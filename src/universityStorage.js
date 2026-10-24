// Local data of one university on a device used for several. Every
// university now runs on the same address, so they share localStorage: the
// settings below belong to the account of one university (its establishment,
// TP, favourite apps…) and are set aside when the page boots for another one,
// then put back when it boots for the first one again. Caches are dropped.
// Pure (storage passed in), see tests/universityStorage.test.js.
//
// Data from before this existed has no owner recorded: it belongs to the
// university the address served then (`legacyUniversityId`), Rennes on
// tafac.fr, so nothing changes for those students.

export const STORAGE_UNIVERSITY_KEY = 'l-ent:storage-university'
export const UNIVERSITY_SETTINGS_PREFIX = 'l-ent:university-settings:'

export const UNIVERSITY_SETTING_KEYS = [
  'l-ent:establishment',
  'l-ent:student-tp',
  'l-ent:favorites-order',
  'l-ent:local-pins',
  'l-ent:apps-order',
  'l-ent:grade-colors',
  'l-ent:class-colors',
  'l-ent:planning-accents',
  'l-ent:grades-seen-ids',
  'l-ent:grades-dept-message-dismissed',
  'l-ent:moodle-href',
  'l-ent:webmail-href',
]

export const UNIVERSITY_CACHE_KEYS = [
  'l-ent:ade-timetable-cache',
  'l-ent:grades-cache',
  'l-ent:next-class-cache',
  'l-ent:session-cache',
]

function readStash(storage, universityId) {
  try {
    const parsed = JSON.parse(storage.getItem(`${UNIVERSITY_SETTINGS_PREFIX}${universityId}`) ?? 'null')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Makes the stored settings those of `universityId`. Returns whether it had
// to swap them.
export function switchUniversityStorage(universityId, { legacyUniversityId = null, storage = globalThis.localStorage } = {}) {
  if (!universityId || !storage) return false

  try {
    const owner = storage.getItem(STORAGE_UNIVERSITY_KEY) || legacyUniversityId
    // Unknown owner (offline boot of old data): taken as this university's.
    if (!owner || owner === universityId) {
      storage.setItem(STORAGE_UNIVERSITY_KEY, universityId)
      return false
    }

    if (owner) {
      const settings = {}
      for (const key of UNIVERSITY_SETTING_KEYS) {
        const value = storage.getItem(key)
        if (value !== null) settings[key] = value
      }
      if (Object.keys(settings).length > 0) {
        storage.setItem(`${UNIVERSITY_SETTINGS_PREFIX}${owner}`, JSON.stringify(settings))
      }
    }

    for (const key of [...UNIVERSITY_SETTING_KEYS, ...UNIVERSITY_CACHE_KEYS]) {
      storage.removeItem(key)
    }

    const saved = readStash(storage, universityId)
    for (const key of UNIVERSITY_SETTING_KEYS) {
      if (typeof saved[key] === 'string') storage.setItem(key, saved[key])
    }
    storage.removeItem(`${UNIVERSITY_SETTINGS_PREFIX}${universityId}`)
    storage.setItem(STORAGE_UNIVERSITY_KEY, universityId)
    return true
  } catch {
    // Storage blocked or full: the settings stay as they are.
    return false
  }
}
