import { useCallback, useEffect, useMemo, useState } from 'react'
import universityConfig from '@university'
import { getGrades } from '../entApi'
import { buildGradesReport } from '../gradesReport'
import { buildUeWash, formatGradeDay, formatScore } from '../gradesSubjects'
import { filterRecentGrades, listRecentGrades } from '../mailGradeAttach'
import { describeLoadError } from '../scodocPageUtils'
import { assignSubjectIcons } from '../subjectIcons'
import { useUeColor } from '../useUeColor'
import MailAttachDrawer, { ATTACH_CARD_CLASS, AttachDrawerError, AttachDrawerNote } from './MailAttachDrawer'
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
        className={`mail-grade-card ${ATTACH_CARD_CLASS} ${CARD_CLASSES}`}
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
// in the mail (and closes the drawer). Its keys: MailAttachDrawer's.
function MailGradePicker({ onPick, onClose }) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')

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

  const pick = useCallback((entry) => {
    onPick({ module: entry.module, evaluation: entry.evaluation, report, absences: state.absences ?? null })
  }, [onPick, report, state.absences])

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
    body = <AttachDrawerError text={state.error} onRetry={retry} />
  } else if (!grades.length) {
    body = <AttachDrawerNote>{report?.status === 'unpublished' ? report.message : 'Aucune note ce semestre'}</AttachDrawerNote>
  } else if (!shown.length) {
    body = <AttachDrawerNote>Aucune note trouvée</AttachDrawerNote>
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

  return (
    <MailAttachDrawer
      titleId="mail-grade-picker-title"
      title="Joindre une note"
      subtitle={subtitle}
      search={hasSearch ? { value: query, onChange: setQuery, placeholder: 'Rechercher une note' } : null}
      onSubmit={() => {
        if (shown[0]) pick(shown[0])
      }}
      onClose={onClose}
    >
      {body}
    </MailAttachDrawer>
  )
}

export default MailGradePicker
