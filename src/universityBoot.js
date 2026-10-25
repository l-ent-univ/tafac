// Runs before App is imported (main.jsx): asks the server which universities
// it has and which one this browser is signed in to, picks the university the
// page runs for (universityRuntime.js#pickBootUniversity) and fills the
// @university config with its client.js, loaded on demand, or with the
// neutral one (the picker) when there's none yet.
import universityConfig from './university'
import neutralConfig from './neutralUniversity'
import {
  pickBootUniversity,
  readEntryPath,
  readUniversityChoice,
  setLoadedUniversityId,
  setUniversityDirectory,
  writeUniversityChoice,
} from './universityRuntime'
import { switchUniversityStorage } from './universityStorage'

// One chunk per university: a page only downloads its own.
const clientConfigs = import.meta.glob('../universities/*/client.js', { import: 'default' })

export async function loadUniversityClientConfig(id) {
  const load = clientConfigs[`../universities/${id}/client.js`]
  return load ? load() : null
}

async function fetchUniversityDirectory() {
  try {
    const response = await fetch('/__ent_auth/universities', { credentials: 'same-origin', cache: 'no-store' })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// The picker's address is an entry point to signing in: once read, the
// address becomes the login page's (App's LOGIN_PATH). A university's
// /<slug> is its landing page while signed out (search engines index it), and
// signed in the app's home page (/): the session's university, whatever the
// address.
const LOGIN_ENTRY_PATH = '/login'

function replacePath(path) {
  try {
    const { search, hash } = window.location
    window.history.replaceState(window.history.state, '', `${path}${search}${hash}`)
  } catch {
    // Sandboxed frame: the address stays.
  }
}

export async function bootUniversity() {
  const info = await fetchUniversityDirectory()
  setUniversityDirectory(info)

  const entry = readEntryPath(window.location.pathname, info?.universities ?? [])
  if (entry?.kind === 'picker') replacePath(LOGIN_ENTRY_PATH)
  else if (entry && info?.session) replacePath('/')

  const id = pickBootUniversity({ info, entry, storedChoice: readUniversityChoice() })
  let config = null
  if (id) {
    try {
      config = await loadUniversityClientConfig(id)
    } catch {
      config = null
    }
  }

  if (config) {
    writeUniversityChoice(id)
    if (info) {
      switchUniversityStorage(id, { legacyUniversityId: info.host ?? info.defaultUniversity ?? null })
    }
  } else if (entry?.kind === 'picker') {
    // « Changer d'université »: the picker until another one is picked.
    writeUniversityChoice(null)
  }

  Object.assign(universityConfig, config ?? neutralConfig)
  setLoadedUniversityId(config ? id : null)

  // The page as the service worker kept it still has its placeholders.
  if (document.title.includes('%LENT_')) {
    document.title = universityConfig.branding.seoTitle
  }
}
