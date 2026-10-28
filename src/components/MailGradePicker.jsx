import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { getGrades } from '../entApi'
import { buildGradesReport } from '../gradesReport'
import { buildUeWash, formatGradeDay, formatScore } from '../gradesSubjects'
import { filterRecentGrades, listRecentGrades } from '../mailGradeAttach'
import { describeLoadError } from '../scodocPageUtils'
import { assignSubjectIcons } from '../subjectIcons'
import { useUeColor } from '../useUeColor'
import CloseButton from './CloseButton'
import MailSearchField from './MailSearchField'
import { CARD_CLASSES, LatestGradeCardBody } from './LatestGradesList'
import { SHIMMER_CLASSES } from './widgetListUtils'

// From this many grades, a search field over the list.
const SEARCH_FROM = 7
const SKELETON_CARDS = 6

// The newest semester's relevé, as « Mes notes » reads it (getGrades: its
// cache, else the server): its report and its absences (the teachers'
// addresses). → { status: 'ok', report, absences } or { status: 'error', error }.
async function loadGrades(force) {
  try {
    const data = await getGrades({ force })
    if (!data?.authenticated || data.error || !data.grades) return { status: 'error', error: describeLoadError(data, null) }
    const report = buildGradesReport(data.grades['relevé'] ?? null, { config: data.grades.config ?? null })
    return { status: 'ok', report, absences: data.grades.absences ?? null }
  } catch (error) {
    return { status: 'error', error: describeLoadError(null, error) }
  }
}

// One grade as a « Dernières notes » card: its subject (icon, name, day),
// the evaluation, the grade in its pill, under the wash of its UEs.
function GradeCard({ entry, icon, wash, onPick }) {
  const { module, evaluation } = entry
  const day = formatGradeDay(evaluation.date)
  const title = evaluation.description || module.title
  const isNumber = evaluation.grade.kind === 'number'
  const value = isNumber ? formatScore(evaluation.grade.value) : evaluation.grade.label
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        className={`mail-grade-card ${CARD_CLASSES}`}
        aria-label={`${title}, ${module.title} : ${isNumber ? `${value} sur 20` : value}${day ? `, le ${day}` : ''}`}
        onClick={() => onPick(entry)}
      >
        <LatestGradeCardBody
          moduleTitle={module.title}
          moduleCode={module.code}
          day={day}
          title={title}
          value={value}
          scale={isNumber ? '/20' : null}
          icon={icon}
          wash={wash}
          typeLabel={evaluation.typeLabel ?? null}
        />
      </button>
    </li>
  )
}

// « Une note… » of the composer's trombone: a drawer sliding up over the
// composer's foot, the newest semester's grades in it as « Dernières notes »
// cards (newest first, a search field once they're many), laid out in as
// many columns as fit. Loaded as it opens (from « Mes notes »' cache when
// it's fresh), card skeletons meanwhile, « Réessayer » on a failure.
// `onPick({ module, evaluation, report, absences })`: the composer puts it
// in the mail (and closes the drawer). Escape closes the drawer only (the
// composer skips an event handled); the arrow keys move through the cards,
// from the search field too.
function MailGradePicker({ onPick, onClose }) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const dialogRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    void loadGrades(attempt > 0).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => { cancelled = true }
  }, [attempt])
  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  const report = state.status === 'ok' ? state.report : null
  const grades = useMemo(() => listRecentGrades(report), [report])
  const shown = useMemo(() => filterRecentGrades(grades, query), [grades, query])
  const paintUe = useUeColor()
  const ueColors = useMemo(() => Object.fromEntries((report?.ues ?? []).map((ue) => [ue.code, paintUe(ue.color)])), [report, paintUe])
  // The icons « Mes notes » gives its subjects (assigned by code, the same).
  const subjectIcon = useMemo(() => {
    const titles = [...(report?.resources ?? []), ...(report?.saes ?? [])]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((module) => module.title)
    return assignSubjectIcons(titles, universityConfig.appIconStyle)
  }, [report])
  const hasSearch = grades.length >= SEARCH_FROM
  const semester = report?.semester?.number ? `Semestre ${report.semester.number}` : null
  const subtitle = state.status === 'ok' && grades.length
    ? [semester, `${grades.length} note${grades.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')
    : null

  // Focus in (the search field once there, else the drawer), back on close
  // to what opened it.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (hasSearch) searchRef.current?.focus({ preventScroll: true })
  }, [hasSearch])

  const pick = useCallback((entry) => {
    onPick({ module: entry.module, evaluation: entry.evaluation, report, absences: state.absences ?? null })
  }, [onPick, report, state.absences])

  // Its own keys, kept from the composer (marked handled, and not let up
  // the tree: Escape there would close the mail). The arrows move through
  // the grid (up and down by a row: as many cards as share the first's
  // line); Tab goes round the drawer.
  const handleKeyDown = (event) => {
    const focusable = [...dialogRef.current.querySelectorAll('input, button:not(:disabled)')].filter((element) => element.getClientRects().length > 0)
    const cards = [...dialogRef.current.querySelectorAll('.mail-grade-card')]
    const index = cards.indexOf(document.activeElement)
    const columns = Math.max(1, cards.filter((card) => card.offsetTop === cards[0]?.offsetTop).length)
    const focusCard = (next) => cards[Math.max(0, Math.min(next, cards.length - 1))]?.focus()
    let handled = true
    if (event.key === 'Escape') {
      // The search field's own Escape (emptying it) first.
      if (!event.defaultPrevented) onClose()
    } else if (event.key === 'ArrowDown') {
      focusCard(index < 0 ? 0 : index + columns)
    } else if (event.key === 'ArrowUp') {
      if (index >= columns) focusCard(index - columns)
      else if (index >= 0) searchRef.current?.focus()
    } else if (event.key === 'ArrowRight' && index >= 0) {
      focusCard(index + 1)
    } else if (event.key === 'ArrowLeft' && index >= 0) {
      focusCard(index - 1)
    } else if (event.key === 'Enter' && event.target === searchRef.current) {
      if (shown[0]) pick(shown[0])
    } else if (event.key === 'Tab' && focusable.length) {
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) last.focus()
      else if (!event.shiftKey && document.activeElement === last) first.focus()
      else handled = false
    } else {
      handled = false
    }
    if (handled) event.preventDefault()
    event.stopPropagation()
  }

  const grid = 'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3 p-0 max-sm:grid-cols-2 max-sm:gap-2'
  let body
  if (state.status === 'loading') {
    body = (
      <ul className={grid} aria-label="Chargement des notes" aria-busy="true">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <li key={index} className={`${CARD_CLASSES} cursor-default`}>
            <span className={`h-3 w-[70%] rounded-full ${SHIMMER_CLASSES}`} />
            <span className={`mt-1 h-3.5 ${index % 2 ? 'w-[55%]' : 'w-[80%]'} rounded-full ${SHIMMER_CLASSES}`} />
            <span className={`mt-3 h-[34px] w-[72px] rounded-full ${SHIMMER_CLASSES}`} />
          </li>
        ))}
      </ul>
    )
  } else if (state.status === 'error') {
    body = (
      <div className="grid justify-items-center gap-3 px-2 py-8 text-center" role="alert">
        <p className="m-0 max-w-[340px] font-body text-[14px] font-medium leading-[1.4] text-text-secondary">{state.error}</p>
        <button type="button" className="material inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2" onClick={retry}>
          <Icon icon="carbon:renew" className="size-4" aria-hidden="true" />
          <span className="font-body text-[14px] font-semibold text-text">Réessayer</span>
        </button>
      </div>
    )
  } else if (!grades.length) {
    body = (
      <p className="m-0 px-2 py-8 text-center font-body text-[14px] font-medium leading-[1.4] text-text-secondary">
        {report?.status === 'unpublished' ? report.message : 'Aucune note ce semestre'}
      </p>
    )
  } else if (!shown.length) {
    body = <p className="m-0 px-2 py-8 text-center font-body text-[14px] font-medium leading-[1.4] text-text-secondary">Aucune note trouvée</p>
  } else {
    body = (
      <ul className={grid} aria-label="Notes">
        {shown.map((entry) => (
          <GradeCard
            key={entry.key}
            entry={entry}
            icon={subjectIcon(entry.module.title)}
            wash={buildUeWash(entry.evaluation.weights, ueColors)}
            onPick={pick}
          />
        ))}
      </ul>
    )
  }

  // Inside the composer's window (its frame clips it), from its foot. Of a
  // set height: a search narrowing the cards doesn't move it.
  return (
    <div className="absolute inset-0 z-40 flex items-end" role="presentation">
      <div className="absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="mail-grade-drawer planning-sheet relative flex h-[min(640px,calc(100%-56px))] w-full flex-col overflow-hidden rounded-t-[24px] border-t border-border bg-bg text-text shadow-[0_-12px_48px_var(--color-shadow)] outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-grade-picker-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <span className="mx-auto mt-2 h-[4px] w-9 shrink-0 rounded-full bg-text-30" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pt-3 pb-4 max-sm:px-4">
          <div className="grid min-w-0 flex-1 gap-[5px]">
            <h2 id="mail-grade-picker-title" className="m-0 text-[19px] font-bold leading-[1.1]">Joindre une note</h2>
            {subtitle ? <p className="m-0 font-body text-[13px] font-medium leading-none text-text-muted">{subtitle}</p> : null}
          </div>
          {hasSearch ? (
            <MailSearchField
              value={query}
              onChange={setQuery}
              placeholder="Rechercher une note"
              inputRef={searchRef}
              className="order-last w-full sm:order-none sm:w-[260px]"
            />
          ) : null}
          <CloseButton onClick={onClose} />
        </div>
        {/* Room around the cards for their shadow, inside the scroll box. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5 max-sm:px-4 max-sm:pb-[max(16px,env(safe-area-inset-bottom))]">
          {body}
        </div>
      </section>
    </div>
  )
}

export default MailGradePicker
