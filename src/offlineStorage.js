// Offline storage and network status utilities for Tafac.
// Provides persistent IndexedDB / localStorage caching so students
// can consult their timetable, grades, courses and mail even in amphis
// or transit with poor or no internet connection.

const DB_NAME = 'tafac_offline_db'
const DB_VERSION = 1
const STORE_NAME = 'cache_store'
const LOCAL_STORAGE_PREFIX = 'tafac:offline:'

let dbPromise = null

function getIndexedDb() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return null
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = (event) => {
          const db = event.target.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' })
          }
        }

        request.onsuccess = (event) => {
          resolve(event.target.result)
        }

        request.onerror = () => {
          resolve(null)
        }
      } catch {
        resolve(null)
      }
    })
  }

  return dbPromise
}

export async function setOfflineCache(key, data) {
  if (!key || data === undefined) return
  const record = {
    key,
    data,
    updatedAt: Date.now(),
  }

  // 1. Try IndexedDB
  try {
    const db = await getIndexedDb()
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const req = store.put(record)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      return
    }
  } catch {
    // Fallback to localStorage
  }

  // 2. Fallback to localStorage
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(record))
  } catch {
    // Storage quota or disabled
  }
}

export async function getOfflineCache(key) {
  if (!key) return null

  // 1. Try IndexedDB
  try {
    const db = await getIndexedDb()
    if (db) {
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (record && record.data !== undefined) {
        return { data: record.data, updatedAt: record.updatedAt }
      }
    }
  } catch {
    // Fallback to localStorage
  }

  // 2. Fallback to localStorage
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.data !== undefined) {
        return { data: parsed.data, updatedAt: parsed.updatedAt || Date.now() }
      }
    }
  } catch {
    // Ignore
  }

  return null
}

// Called on login/logout so a shared device never shows the previous user's data.
export async function clearOfflineCache() {
  try {
    const db = await getIndexedDb()
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).clear()
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
      })
    }
  } catch {
    // Ignore
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LOCAL_STORAGE_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    // Ignore
  }
}

export function formatOfflineTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Check network status
export function isOnline() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true
  }
  return navigator.onLine
}
