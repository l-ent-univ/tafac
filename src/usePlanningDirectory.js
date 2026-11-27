import { useCallback, useEffect, useState } from 'react'
import universityConfig from '@university'
import { getAdeDirectory } from './entApi'
import { prepareDirectory } from './planningDirectory'

// What the planning's directory offers: ADE's rooms, staff and groups,
// listed under the student's site; or what the university's planning says
// (planning.directory: its `kinds`, and `bySite: false` for a tree that
// isn't by site, listed whole). None for another planning service.
const DIRECTORY_KINDS = ['room', 'person', 'group']
export const PLANNING_DIRECTORY = (() => {
  const set = universityConfig.planning?.directory
  if (set) {
    const kinds = DIRECTORY_KINDS.filter((kind) => set.kinds?.includes(kind))
    return kinds.length ? { kinds, bySite: set.bySite !== false } : null
  }
  return (universityConfig.planning?.providerName ?? 'ADE') === 'ADE' ? { kinds: DIRECTORY_KINDS, bySite: true } : null
})()
export const HAS_PLANNING_DIRECTORY = PLANNING_DIRECTORY !== null
// Its name: « Salles et personnels », « Salles » with rooms alone.
export const DIRECTORY_TITLE = PLANNING_DIRECTORY?.kinds.length === 1 && PLANNING_DIRECTORY.kinds[0] === 'room' ? 'Salles' : 'Salles et personnels'

// « Salles et personnels »' entries (prepareDirectory), asked of
// the planning's trees once the panel first opens and kept for the visit,
// by account (a few MB at Rennes: not stored on the device). → { status:
// 'idle' | 'loading' | 'loaded' | 'unsupported' | 'unavailable', entries,
// retry }.
const loaded = new Map()
const pending = new Map()

function askDirectory(user) {
  if (pending.has(user)) return pending.get(user)
  const promise = getAdeDirectory(PLANNING_DIRECTORY?.kinds)
    .then((data) => {
      if (!data?.authenticated) throw new Error('Connexion requise')
      const entry = data.supported === false
        ? { status: 'unsupported', entries: [] }
        : { status: 'loaded', entries: prepareDirectory(data.directory) }
      loaded.set(user, entry)
      return entry
    })
    .finally(() => pending.delete(user))
  pending.set(user, promise)
  return promise
}

export function usePlanningDirectory({ user, enabled }) {
  const key = user ?? ''
  const [state, setState] = useState(() => loaded.get(key) ?? { status: 'idle', entries: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined
    const known = loaded.get(key)
    if (known) {
      setState(known)
      return undefined
    }
    let live = true
    setState({ status: 'loading', entries: [] })
    askDirectory(key)
      .then((entry) => { if (live) setState(entry) })
      .catch(() => { if (live) setState({ status: 'unavailable', entries: [] }) })
    return () => { live = false }
  }, [key, enabled, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { ...state, retry }
}
