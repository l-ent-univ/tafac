import { useCallback, useEffect, useState } from 'react'
import universityConfig from '@university'
import { getAdeDirectory } from './entApi'
import { prepareDirectory } from './planningDirectory'

// ADE's rooms and staff can be looked up; other planning services
// (planning.providerName, ADE by default) don't offer it yet.
export const HAS_PLANNING_DIRECTORY = (universityConfig.planning?.providerName ?? 'ADE') === 'ADE'

// « Salles et personnels »' entries (prepareDirectory), asked of
// /ade/directory once the panel first opens and kept for the visit, by
// account (~600 KB at Rennes: not stored on the device). → { status:
// 'idle' | 'loading' | 'loaded' | 'unsupported' | 'unavailable', entries,
// retry }.
const loaded = new Map()
const pending = new Map()

function askDirectory(user) {
  if (pending.has(user)) return pending.get(user)
  const promise = getAdeDirectory()
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
