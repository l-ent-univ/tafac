import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getGrades,
  getGradesDepartmentMessage,
  getRequestErrorKind,
  getSemesterGrades,
  peekGrades,
  peekSemesterGrades,
  prefetchSemesterGrades,
} from './entApi'
import { getReleveDepartment, htmlToPlainText, listGradesSemesters } from './gradesReport'
import { getOfflineCache, setOfflineCache } from './offlineStorage'
import { describeLoadError } from './scodocPageUtils'

// A failed load, as the page shows it (`error`, a message) and as the
// anonymous analytics count it: its category (`errorKind`) and whether the
// server found no ScoDoc relevé at all (`unavailable`), never the message.
function describeFailure(data, error) {
  return {
    status: 'error',
    error: describeLoadError(data, error),
    errorKind: error ? getRequestErrorKind(error) : data?.errorKind ?? null,
    unavailable: Boolean(data?.unavailable),
  }
}

// The semester picked on one ScoDoc page stays picked on the other.
let sharedSelectedSemesterId = null
// Department notices, fetched once per tab (the pending or settled request).
const departmentMessages = new Map()

// Everything the ScoDoc pages load: the first-connection answer (newest
// semester), the other semesters on demand and in the background, the
// department notice. Starts from the cached answer when there is one and
// refreshes it behind the scenes (`refreshing`).
export function useScodocReleve() {
  const [base, setBase] = useState(() => {
    const cached = peekGrades()
    return cached
      ? { status: 'ok', payload: cached.grades, error: null, fromCache: true }
      : { status: 'loading', payload: null, error: null, fromCache: false }
  })
  const [reloadNonce, setReloadNonce] = useState(0)
  const [selectedId, setSelectedId] = useState(() => sharedSelectedSemesterId)
  const [semesterPayloads, setSemesterPayloads] = useState({})
  const [departmentMessage, setDepartmentMessage] = useState(null)

  // Try loading from persistent offline storage if memory/session is empty
  useEffect(() => {
    if (base.status === 'loading') {
      getOfflineCache('scodoc:base').then((offline) => {
        if (offline?.data) {
          setBase((current) => (current.status === 'loading'
            ? { status: 'ok', payload: offline.data, error: null, fromCache: true, offlineTime: offline.updatedAt }
            : current))
        }
      })
    }
  }, [base.status])

  useEffect(() => {
    let cancelled = false

    getGrades({ force: reloadNonce > 0 })
      .then((data) => {
        if (cancelled) return
        if (!data?.authenticated || data.error || !data.grades) {
          // A cached copy beats an error screen while ScoDoc hiccups or is offline
          getOfflineCache('scodoc:base').then((offline) => {
            if (cancelled) return
            if (offline?.data) {
              setBase({ status: 'ok', payload: offline.data, error: null, fromCache: true, offlineTime: offline.updatedAt })
            } else {
              setBase((current) => (current.status === 'ok'
                ? { ...current, fromCache: false }
                : { ...describeFailure(data, null), payload: null, fromCache: false }))
            }
          })
          return
        }
        setBase({ status: 'ok', payload: data.grades, error: null, fromCache: false })
        void setOfflineCache('scodoc:base', data.grades)
      })
      .catch((error) => {
        if (cancelled) return
        getOfflineCache('scodoc:base').then((offline) => {
          if (cancelled) return
          if (offline?.data) {
            setBase({ status: 'ok', payload: offline.data, error: null, fromCache: true, offlineTime: offline.updatedAt })
          } else {
            setBase((current) => (current.status === 'ok'
              ? { ...current, fromCache: false }
              : { ...describeFailure(null, error), payload: null, fromCache: false }))
          }
        })
      })

    return () => { cancelled = true }
  }, [reloadNonce])

  const basePayload = base.payload
  const semesters = useMemo(() => listGradesSemesters(basePayload?.semestres), [basePayload])
  // The first-connection answer already holds the newest semester's relevé.
  const newestId = semesters[0]?.id ?? 'current'
  const activeId = selectedId && semesters.some((semester) => semester.id === selectedId) ? selectedId : newestId
  const cachedSemester = activeId === newestId ? null : peekSemesterGrades(activeId)
  const entry = activeId === newestId && basePayload
    ? { status: 'ok', payload: basePayload }
    : semesterPayloads[activeId] ?? (cachedSemester ? { status: 'ok', payload: cachedSemester.grades } : { status: 'loading' })

  // The other semesters load in the background once the page has settled, so
  // switching to them is instant.
  useEffect(() => {
    if (!basePayload || semesters.length < 2) {
      return undefined
    }

    const otherIds = semesters.slice(1).map((semester) => semester.id)
    const start = () => { void prefetchSemesterGrades(otherIds) }
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(start, { timeout: 2000 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = window.setTimeout(start, 800)
    return () => window.clearTimeout(timeoutId)
  }, [basePayload, semesters])

  useEffect(() => {
    if (!basePayload || activeId === newestId || semesterPayloads[activeId] || cachedSemester) {
      return
    }

    setSemesterPayloads((current) => ({ ...current, [activeId]: { status: 'loading' } }))
    getSemesterGrades(activeId)
      .then((data) => {
        const ok = data?.authenticated && data.grades && !data.error
        setSemesterPayloads((current) => ({
          ...current,
          [activeId]: ok ? { status: 'ok', payload: data.grades } : describeFailure(data, null),
        }))
      })
      .catch((error) => {
        setSemesterPayloads((current) => ({ ...current, [activeId]: describeFailure(null, error) }))
      })
  }, [activeId, basePayload, cachedSemester, newestId, semesterPayloads])

  const config = entry.payload?.config ?? basePayload?.config ?? null
  const releve = entry.payload?.['relevé'] ?? null
  const department = releve ? getReleveDepartment(releve) : null

  useEffect(() => {
    if (!department) {
      return undefined
    }

    // The request itself is shared, not its answer: a page that mounts
    // while it's in flight (StrictMode's second run, a quick revisit) still
    // gets the message. A failed one is forgotten, to be asked again.
    let request = departmentMessages.get(department)
    if (!request) {
      request = getGradesDepartmentMessage(department).then((data) => htmlToPlainText(data?.message) || null)
      request.catch(() => departmentMessages.delete(department))
      departmentMessages.set(department, request)
    }

    let cancelled = false
    request.then((text) => { if (!cancelled) setDepartmentMessage(text) }, () => {})
    return () => { cancelled = true }
  }, [department])

  const selectSemester = useCallback((id) => {
    sharedSelectedSemesterId = id
    setSelectedId(id)
  }, [])

  const retry = useCallback(() => {
    if (base.status === 'error') {
      setBase({ status: 'loading', payload: null, error: null, fromCache: false })
      setReloadNonce((current) => current + 1)
      return
    }

    setSemesterPayloads((current) => {
      const next = { ...current }
      delete next[activeId]
      return next
    })
  }, [activeId, base.status])

  return {
    base,
    refreshing: base.status === 'ok' && base.fromCache,
    semesters,
    activeId,
    activeSemester: semesters.find((semester) => semester.id === activeId) ?? null,
    selectSemester,
    entry,
    releve,
    config,
    department,
    departmentMessage,
    retry,
  }
}
