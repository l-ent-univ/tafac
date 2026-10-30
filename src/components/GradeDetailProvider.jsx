import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackGradesAction } from '../analytics'
import { findEvaluation } from '../gradeDetail'
import { GradeDetailContext } from '../gradeDetailContext'
import GradeDetailModal from './GradeDetailModal'

// The key the open sheet adds to its history entry's state, next to
// appHistory's `tafac`: the entry shows the same page and UE, so the app's
// and the UE view's popstate handlers leave it alone, and Back (Android's
// gesture, the browser button) only closes the sheet. It holds the grade's
// ids ({ moduleCode, evaluationId }), so Forward reopens the sheet on it.
const HISTORY_KEY = 'tafacGradeDetail'

// The grade an entry's sheet shows, or null. An older entry held the
// evaluation id alone.
function readOpenEntry(state = globalThis.history?.state) {
  const entry = state?.[HISTORY_KEY]
  if (entry == null) return null
  if (typeof entry !== 'object') return { moduleCode: null, evaluationId: String(entry) }
  return entry.evaluationId != null ? { moduleCode: entry.moduleCode ?? null, evaluationId: String(entry.evaluationId) } : null
}

function readOpenId(state) {
  return readOpenEntry(state)?.evaluationId ?? null
}

// Gives the evaluation rows below it a way to open the grade detail sheet
// (useGradeDetail), and shows it. `semesterId`: the relevé's, for the
// promo's histogram. `subjectIcon`: the page's icon for a subject title.
// `onWrite({ moduleCode, evaluationId })`: a mail about a grade (the
// sheet's button, the rows' menus, as `write`), null where there's none.
function GradeDetailProvider({ report, semesterId, subjectIcon = () => null, onWrite = null, children }) {
  const [request, setRequest] = useState(null)
  // Read by the history handlers, which outlive a render.
  const requestRef = useRef(null)
  useEffect(() => {
    requestRef.current = request
  }, [request])

  // A reload on a sheet's entry: the sheet isn't reopened, so its mark goes.
  useEffect(() => {
    if (readOpenId() == null) return
    try {
      const { [HISTORY_KEY]: _omit, ...state } = window.history.state ?? {}
      window.history.replaceState(state, '')
    } catch {
      // No history: nothing to tidy.
    }
  }, [])

  // `from`: where the row was ('latest', 'ue_view', 'subjects',
  // 'dashboard'), for the anonymous analytics. Forward reopening a sheet
  // (popstate below) isn't a new opening.
  const open = useCallback(({ moduleCode, evaluationId, isNew = false, from = null }) => {
    const id = String(evaluationId)
    trackGradesAction('grade_detail_opened', { from })
    setRequest({ moduleCode, evaluationId: id, isNew })
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: { moduleCode: moduleCode ?? null, evaluationId: id } }, '')
    } catch {
      // Sandboxed frame: the sheet just closes without its entry.
    }
  }, [])

  // The close button, Escape, the backdrop: back off the sheet's entry when
  // it's the current one (popstate then closes it), plainly otherwise.
  const close = useCallback(() => {
    const current = requestRef.current
    if (current && readOpenId() === current.evaluationId) window.history.back()
    else setRequest(null)
  }, [])

  // Back off the sheet's entry closes it; Forward onto one (or onto another
  // grade's) shows that grade again, as it was opened (no "Nouveau" then:
  // it's been read).
  useEffect(() => {
    const handlePopState = (event) => {
      const current = requestRef.current
      const entry = readOpenEntry(event.state)
      if (entry && entry.evaluationId !== current?.evaluationId) setRequest({ ...entry, isNew: false })
      else if (!entry && current) setRequest(null)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const found = request ? findEvaluation(report, request.moduleCode, request.evaluationId) : null
  // The semester changed under an open sheet (or its grade went): drop it.
  useEffect(() => {
    if (request && !found) setRequest(null)
  }, [request, found])

  const value = useMemo(() => ({ open, write: onWrite }), [open, onWrite])

  return (
    <GradeDetailContext.Provider value={value}>
      {children}
      {found ? (
        <GradeDetailModal
          key={`${found.module.code}:${found.evaluation.id}`}
          report={report}
          module={found.module}
          evaluation={found.evaluation}
          semesterId={semesterId}
          icon={subjectIcon(found.module.title)}
          isNew={request.isNew}
          onWrite={onWrite ? () => onWrite({ moduleCode: found.module.code, evaluationId: found.evaluation.id }) : null}
          onClose={close}
        />
      ) : null}
    </GradeDetailContext.Provider>
  )
}

export default GradeDetailProvider
