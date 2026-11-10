import { useMemo } from 'react'
import universityConfig from '@university'
import gradesIcon from '../assets/home-icons/grades.png'
import { buildGradesReport } from '../gradesReport'
import { buildUeWash, formatGradeDay } from '../gradesSubjects'
import { readSeenEvaluationIds } from '../seenGrades'
import { assignSubjectIcons } from '../subjectIcons'
import { useUeColor } from '../useUeColor'
import { CARD_CLASSES, LatestGradeCardBody } from './LatestGradesList'
import WidgetListStatus from './WidgetListStatus'
import { SHIMMER_CLASSES } from './widgetListUtils'
import { r } from '../register.js'
import HomeIcon from './HomeIcon'

const MAX_GRADES = 6
// « Mes notes »'s grade card, its corners nested in this card's: the card's
// radius (31px, 27px on a phone) less its padding (16px, 12px): 15px.
const GRADE_CARD_CLASSES = CARD_CLASSES.replace('card-corners', 'corners-[15px]')

// « Dernières notes » (the « Accueil » page): a white card with the
// semester's latest grades (buildGradesReport's `latest`), on one row that
// scrolls sideways (snapping, no scrollbar, running to the card's edges), each
// as « Mes notes »'s grade card (LatestGradeCardBody): the subject and the
// date, the evaluation, the grade in its pill, under the UEs' wash.
// « Nouveau » while « Mes notes » hasn't shown it on this device. A grade
// opens itself in « Mes notes » (onOpenGrade). `status`, the grades'
// load: 'loading' (placeholders as the cards will stand), 'error' (a
// message and « Réessayer », `onRetry`), 'empty' (no relevé: no card, as
// without a grade).
function WidgetRecentGrades({ releve = null, config = null, semesterId = null, sessionUser = null, status = 'ok', onRetry = null, onOpenGrade = null }) {
  const report = useMemo(() => (releve ? buildGradesReport(releve, { config }) : null), [releve, config])
  const paintUe = useUeColor()
  const ueColors = useMemo(() => Object.fromEntries((report?.ues ?? []).map((ue) => [ue.code, paintUe(ue.color)])), [report, paintUe])
  // The subjects' icons as « Mes notes » assigns them (by module code).
  const subjectIcon = useMemo(() => assignSubjectIcons(
    [...(report?.resources ?? []), ...(report?.saes ?? [])]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((module) => module.title),
    universityConfig.appIconStyle,
  ), [report])
  const grades = (report?.latest ?? []).slice(0, MAX_GRADES)
  // Read on each render: coming back from « Mes notes », the badges follow.
  const seen = semesterId ? readSeenEvaluationIds(sessionUser, semesterId) : null
  const seenIds = Array.isArray(seen) ? new Set(seen.map(String)) : null

  if (status === 'empty' || (report && grades.length === 0)) return null
  const failed = !report && status === 'error'

  return (
    <article
      className="recent-grades-widget widget-card widget-card-visible flex min-w-0 overflow-hidden flex-[0_1_520px] flex-col gap-2 border border-white bg-widget-bg p-4 text-text shadow-md card-corners max-md:flex-[1_1_100%] max-md:p-3"
      aria-label="Dernières notes"
    >
      <div className="flex min-w-0 items-center gap-2">
        <HomeIcon src={gradesIcon} className="size-[22px] shrink-0 select-none" />
        <h2 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]">Dernières notes</h2>
      </div>
      {failed ? (
        <WidgetListStatus
          icon="ph:warning"
          title="Notes indisponibles"
          body={r('Impossible de charger tes notes', 'Impossible de charger vos notes')}
          action={onRetry ? { label: 'Réessayer', onClick: onRetry } : null}
        />
      ) : !report ? (
        <div className="-mx-4 flex gap-2 overflow-hidden px-4 pt-1 max-md:-mx-3 max-md:px-3" aria-hidden="true">
          {[0, 1, 2].map((index) => <div key={index} className={`h-[124px] w-[220px] shrink-0 corners-[15px] ${SHIMMER_CLASSES}`} />)}
        </div>
      ) : (
        <ul className="favorites-scroll-hide m-0 -mx-4 -mb-4 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pt-1 pb-4 max-md:-mx-3 max-md:-mb-3 max-md:scroll-px-3 max-md:px-3 max-md:pb-3">
          {grades.map((grade) => {
            const value = String(parseFloat(grade.grade.value.toFixed(2)))
            const title = grade.description || grade.moduleTitle
            const day = formatGradeDay(grade.date)
            const isNew = Boolean(seenIds && grade.id != null && !seenIds.has(String(grade.id)))
            const body = (
              <LatestGradeCardBody
                moduleTitle={grade.moduleTitle}
                moduleCode={grade.moduleCode}
                day={day}
                title={title}
                value={value}
                icon={subjectIcon(grade.moduleTitle)}
                wash={buildUeWash(grade.weights, ueColors)}
                typeLabel={grade.typeLabel}
                isNew={isNew}
              />
            )
            return (
              <li key={`${grade.moduleCode}-${grade.id}`} className="flex w-[220px] shrink-0 snap-start min-w-0">
                {onOpenGrade ? (
                  <button
                    type="button"
                    className={GRADE_CARD_CLASSES}
                    onClick={() => onOpenGrade({ id: grade.id, resource: grade.moduleCode })}
                    aria-label={`${title}${grade.typeLabel ? `, ${grade.typeLabel.toLowerCase()}` : ''} : ${value} sur 20${day ? `, le ${day}` : ''} (${grade.moduleTitle}). Voir la note`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={GRADE_CARD_CLASSES.replace('cursor-pointer', '')}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}

export default WidgetRecentGrades
