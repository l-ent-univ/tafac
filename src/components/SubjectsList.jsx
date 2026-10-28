import { useId, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import {
  buildUeWash,
  describeSubjectProgress,
  formatScore,
  listSubjectGroups,
  placeInPromo,
  sortEvaluations,
} from '../gradesSubjects'
import { useGradeDetail } from '../gradeDetailContext'
import { gradeCopyText } from '../contextMenuItems'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import CardInfoTip from './CardInfoTip'
import UeLink from './UeLink'

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

// One card per group, stacked in a single column at every width (each card
// is a query container for its own rows).
const GROUPS_CLASSES = 'grid items-start gap-3 max-md:gap-2'
const CARD_CLASSES = '@container widget-card widget-card-visible shadow-md border border-white card-corners bg-widget-bg text-text p-2 min-w-0'
// The pills of the "Dernières notes" cards, a size down: neutral, the number
// and "/20" trimmed to cap height so the padding is even.
const PILL_CLASSES = 'inline-flex shrink-0 items-end gap-[2px] rounded-full border border-border bg-bg-subtle text-text'
const TRIM = '[text-box:trim-both_cap_alphabetic]'

function formatDay(date) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? DAY_FORMAT.format(time) : null
}

export function ScorePill({ value, size = 'md' }) {
  const isLarge = size === 'md'
  return (
    <span className={`${PILL_CLASSES} ${isLarge ? 'px-2 py-[8px]' : 'px-[7px] py-[7px]'}`} aria-hidden="true">
      <span className={`font-display font-bold leading-none ${TRIM} ${isLarge ? 'text-[17px]' : 'text-[15px]'}`}>{formatScore(value)}</span>
      <span className={`font-body font-medium leading-none text-text-muted ${TRIM} ${isLarge ? 'text-[13px]' : 'text-[12px]'}`}>/20</span>
    </span>
  )
}

// A subject's average, plain like the UE averages: the pill is kept for
// grades themselves.
export function ScoreText({ value, size = 'md' }) {
  const isLarge = size === 'md'
  return (
    <span className="inline-flex shrink-0 items-baseline gap-[2px] text-text" aria-hidden="true">
      <span className={`font-display font-bold leading-none ${isLarge ? 'text-[17px]' : 'text-[16px]'}`}>{formatScore(value)}</span>
      <span className={`font-body font-medium leading-none text-text-muted ${isLarge ? 'text-[13px]' : 'text-[12px]'}`}>/20</span>
    </span>
  )
}

// "Nouveau": a grade that appeared since the last visit (see seenGrades.js).
export function NewBadge() {
  return (
    <span className="mt-[1px] shrink-0 rounded-full bg-brand px-[7px] py-[3px] font-body text-[11px] font-semibold leading-none text-bg">Nouveau</span>
  )
}

// "Rattrapage", "Session 2": a grade that isn't from a normal evaluation
// (it replaces the subject's result rather than adding to it).
export function TypeBadge({ label }) {
  return (
    <span className="mt-[1px] shrink-0 rounded-full bg-brand-subtle px-[7px] py-[3px] font-body text-[11px] font-semibold leading-none text-text-secondary">{label}</span>
  )
}

// "Absent", "En attente"… where a number would be: quieter than a grade, and
// dashed while it's still to come.
function StatusPill({ grade }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-[9px] py-[6px] font-body text-[12px] font-semibold leading-none text-text-secondary ${TRIM} ${grade.kind === 'pending' ? 'border-dashed border-border-input' : 'border-border'}`}>
      {grade.label}
    </span>
  )
}

// Where the grade sits in the promo, on a 0–20 track: the promo's spread
// (lowest to highest), a tick at its mean, a dot for the student. The
// numbers are in the text beside it; this only shows the picture.
function PromoRange({ place }) {
  return (
    <span className="subject-promo-range relative hidden h-4 w-[92px] shrink-0 @md:block" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-brand-subtle" />
      <span
        className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-text-30"
        style={{ left: `${place.min}%`, width: `${Math.max(place.max - place.min, 2)}%` }}
      />
      {place.moy != null ? (
        <span className="absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-muted" style={{ left: `${place.moy}%` }} />
      ) : null}
      <span className="subject-promo-dot absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" style={{ left: `${place.value}%` }} />
    </span>
  )
}

// `weight`: the evaluation's weight in the UE being shown ("Par UE"), named
// when it isn't 1. `compact`: no promo bar, and "Absent" / "En attente" as
// plain text rather than a pill — the quieter rows of the UE cards.
// Under GradeDetailProvider (Mes notes) the row is a button opening the
// grade's detail sheet (`moduleCode` finds it in the report); elsewhere it
// stays plain. `openFrom`: which list it's in, for the anonymous analytics.
export function EvaluationRow({ evaluation, moduleCode = null, showPromoStats, weight = null, compact = false, isNew = false, openFrom = 'subjects' }) {
  const gradeDetail = useGradeDetail()
  const day = formatDay(evaluation.date)
  const isNumber = evaluation.grade.kind === 'number'
  const place = showPromoStats && !compact ? placeInPromo(evaluation) : null
  const promoMean = showPromoStats && evaluation.promo.moy != null ? formatScore(evaluation.promo.moy) : null
  const details = [
    day,
    evaluation.coef != null ? `coef ${formatScore(evaluation.coef)}` : null,
    weight != null && weight !== 1 ? `poids ${formatScore(weight)}` : null,
    promoMean ? `moy. promo ${promoMean}` : null,
  ].filter(Boolean)
  const spoken = [
    isNew ? 'nouvelle note' : null,
    evaluation.description,
    evaluation.typeLabel,
    isNumber ? `${formatScore(evaluation.grade.value)} sur 20` : evaluation.grade.label,
    ...details,
    place ? `promo de ${formatScore(evaluation.promo.min)} à ${formatScore(evaluation.promo.max)}` : null,
  ].filter(Boolean).join(', ')
  const canOpen = Boolean(gradeDetail && moduleCode != null)
  const open = () => gradeDetail.open({ moduleCode, evaluationId: evaluation.id, isNew, from: openFrom })
  // Its right-click menu (a long press): the detail sheet, the grade as
  // text.
  const menuProps = useContextMenu(() => [
    canOpen ? { id: 'open', label: 'Voir la note', icon: 'carbon:view', onSelect: open } : null,
    {
      id: 'copy',
      label: 'Copier',
      icon: 'carbon:copy',
      onSelect: () => void copyToClipboard(gradeCopyText({ title: evaluation.description, value: isNumber ? evaluation.grade.value : evaluation.grade.label })),
    },
  ])

  const content = (
    <>
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <span className="flex min-w-0 items-start gap-[6px]">
          <span className="min-w-0 line-clamp-2 break-words font-body text-[14px] font-semibold leading-[1.3] text-text" title={evaluation.description}>{evaluation.description}</span>
          {evaluation.typeLabel ? <TypeBadge label={evaluation.typeLabel} /> : null}
          {isNew ? <NewBadge /> : null}
        </span>
        {details.length ? (
          <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">{details.join(' · ')}</span>
        ) : null}
      </span>
      {place ? <PromoRange place={place} /> : null}
      {isNumber
        ? <ScorePill value={evaluation.grade.value} size="sm" />
        : compact
          ? <span className="shrink-0 font-body text-[13px] font-semibold leading-none text-text-muted">{evaluation.grade.label}</span>
          : <StatusPill grade={evaluation.grade} />}
    </>
  )

  if (!canOpen) {
    return (
      <li className="subject-evaluation flex items-center gap-3 px-3 py-[10px] min-w-0" aria-label={spoken} data-evaluation-id={evaluation.id} {...menuProps()}>
        {content}
      </li>
    )
  }

  // The whole card is the button; a chevron says it opens.
  return (
    <li className="subject-evaluation min-w-0" data-evaluation-id={evaluation.id}>
      <button
        type="button"
        className="subject-evaluation-button flex w-full min-w-0 items-center gap-3 corners-[15px] border-0 bg-transparent px-3 py-[10px] text-left text-text cursor-pointer"
        aria-haspopup="dialog"
        aria-label={`${spoken}. Voir le détail`}
        onClick={open}
        {...menuProps()}
      >
        {content}
        <Icon icon="carbon:chevron-right" className="subject-evaluation-chevron -ml-1 -mr-[2px] size-[14px] shrink-0 text-text-30" aria-hidden="true" />
      </button>
    </li>
  )
}

// The UEs the subject counts for, as UE links (UeLink, like the UE view's
// "Compte aussi dans") with its coefficient in each: what a grade here
// moves. A link opens the subject in that UE's view.
function UeLinks({ module, ueTitles, onOpenUe }) {
  return (
    <div className="flex flex-wrap items-center gap-[6px] min-w-0 pl-[13px]">
      <span className="mr-[2px] font-body text-[13px] font-medium leading-none text-text-muted">Compte pour</span>
      {module.ueCoefs.map((link) => {
        const ueTitle = ueTitles[link.ue]
        return (
          <UeLink
            key={link.ue}
            code={link.ue}
            color={link.color}
            onClick={onOpenUe ? () => onOpenUe(link.ue, module.code) : null}
            title={ueTitle ? `${link.ue} · ${ueTitle}` : link.ue}
            label={`Voir ${module.title} dans ${link.ue}${ueTitle ? ` (${ueTitle})` : ''}, coefficient ${formatScore(link.coef)}`}
          >
            <span className="font-body text-[12px] font-medium leading-none text-text-muted">
              coef <span className="font-semibold text-text">{formatScore(link.coef)}</span>
            </span>
          </UeLink>
        )
      })}
    </div>
  )
}

function SubjectRow({ module, isOpen, onToggle, icon, wash, ueTitles, showPromoStats, onOpenUe }) {
  const id = useId()
  const buttonId = `${id}-button`
  const panelId = `${id}-panel`
  const progress = describeSubjectProgress(module)
  const evaluations = useMemo(() => sortEvaluations(module.evaluations), [module.evaluations])
  const average = module.average != null
    ? `, moyenne${module.averageIsIndicative ? ' indicative' : ''} ${formatScore(module.average)} sur 20`
    : ''
  // No evaluation yet: nothing to open, a plain row (no chevron); its
  // progress already says "Aucune évaluation".
  const isEmpty = evaluations.length === 0
  const Header = isEmpty ? 'div' : 'button'
  // Its right-click menu (a long press): its evaluations shown or hidden,
  // and the subject in each UE it counts for (its « Compte pour » links).
  const menuProps = useContextMenu(() => [
    isEmpty ? null : {
      id: 'toggle',
      label: isOpen ? 'Masquer les évaluations' : 'Afficher les évaluations',
      icon: isOpen ? 'carbon:chevron-up' : 'carbon:chevron-down',
      onSelect: onToggle,
    },
    'separator',
    ...(onOpenUe ? module.ueCoefs.map((link) => ({
      id: `ue-${link.ue}`,
      label: `Voir dans ${link.ue}`,
      icon: 'carbon:arrow-right',
      hint: ueTitles[link.ue] || undefined,
      onSelect: () => onOpenUe(link.ue, module.code),
    })) : []),
  ])

  return (
    <li className={`subject-row corners-[16px] ${isOpen && !isEmpty ? 'subject-row--open' : ''}`}>
      <Header
        id={buttonId}
        {...(isEmpty
          ? { 'aria-label': `${module.title}, ${module.code}, ${progress}` }
          : { type: 'button', 'aria-expanded': isOpen, 'aria-controls': panelId, 'aria-label': `${module.title}, ${module.code}, ${progress}${average}`, onClick: onToggle })}
        {...menuProps()}
        className={`${isEmpty ? '' : 'subject-row-toggle cursor-pointer '}flex w-full min-w-0 items-center gap-3 corners-[16px] border-0 bg-transparent px-2 py-2 text-left text-text max-md:gap-[10px]`}
      >
        {/* The wash of the UEs the subject feeds, as on the grade cards. */}
        <span className="relative isolate inline-flex size-10 shrink-0 items-center justify-center overflow-hidden corners-[12px] bg-brand-subtle max-md:size-9 max-md:corners-[11px]" aria-hidden="true">
          {wash ? <span className="subject-tile-wash" style={{ background: wash }} /> : null}
          {icon ? <Icon icon={icon} className="size-5 text-text max-md:size-[18px]" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-[3px]">
          {/* On a phone a long name takes two lines rather than an ellipsis
              a third of the way in. */}
          <span className="truncate font-body text-[15px] font-semibold leading-[1.3] max-md:line-clamp-2 max-md:whitespace-normal max-md:break-words" title={module.title}>{module.title}</span>
          <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">{module.code} · {progress}</span>
        </span>
        {module.average != null ? <ScoreText value={module.average} /> : null}
        {isEmpty ? <span className="size-4 shrink-0" aria-hidden="true" /> : <Icon icon="carbon:chevron-down" className="subject-row-chevron size-4 shrink-0 text-text-muted" aria-hidden="true" />}
      </Header>
      {isEmpty ? null : (
      <div id={panelId} role="region" aria-labelledby={buttonId} className="subject-panel">
        <div className="subject-panel-inner">
          <div className="grid gap-[10px] px-2 pb-3">
            {evaluations.length ? (
              <ol className="m-0 grid list-none gap-[6px] p-0">
                {evaluations.map((evaluation) => (
                  <EvaluationRow key={evaluation.id} evaluation={evaluation} moduleCode={module.code} showPromoStats={showPromoStats} />
                ))}
              </ol>
            ) : (
              <p className="m-0 py-[6px] font-body text-[14px] font-medium leading-[1.4] text-text-muted">Pas encore d’évaluation dans cette matière.</p>
            )}
            {module.ueCoefs.length ? <UeLinks module={module} ueTitles={ueTitles} onOpenUe={onOpenUe} /> : null}
          </div>
        </div>
      </div>
      )}
    </li>
  )
}

// "Matières" of Mes notes: the semester's ressources and SAÉ, one row each
// (icon tinted by the UEs it feeds, name, code and progress, its average).
// A row opens onto its evaluations, in the order they happened, each with
// its grade and where it sits in the promo, and the UEs the subject counts
// for with its coefficients. Several rows can stay open to compare.
function SubjectsList({ report, ueColors = {}, subjectIcon = () => null, onOpenUe = null }) {
  const groups = useMemo(() => listSubjectGroups(report), [report])
  const ueTitles = useMemo(() => Object.fromEntries((report?.ues ?? []).map((ue) => [ue.code, ue.title])), [report])
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const headingId = useId()

  const toggle = (key) => setOpenKeys((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <div className="@container">
      <div className={GROUPS_CLASSES}>
        {groups.map((group) => (
          <article key={group.kind} className={CARD_CLASSES} aria-labelledby={`${headingId}-${group.kind}`}>
            <div className="flex items-center gap-[5px] px-2 pt-2 pb-[6px] min-w-0">
              <h3 id={`${headingId}-${group.kind}`} className="m-0 leading-[1.06] font-body text-base font-medium text-text-muted max-md:text-[15px]">
                {group.label}
              </h3>
              <span className="font-body text-[13px] font-medium leading-none text-text-30" aria-hidden="true">{group.modules.length}</span>
              {group.kind === 'sae' ? (
                <CardInfoTip label="Les SAÉ, c’est quoi ?">
                  Les situations d’apprentissage et d’évaluation : les projets du semestre, où tu mets en pratique les ressources. Elles comptent souvent beaucoup dans tes UE.
                </CardInfoTip>
              ) : null}
            </div>
            <ul className="m-0 grid list-none gap-[2px] p-0">
              {group.modules.map((module) => {
                const key = `${module.kind}-${module.code}`
                return (
                  <SubjectRow
                    key={key}
                    module={module}
                    isOpen={openKeys.has(key)}
                    onToggle={() => toggle(key)}
                    icon={subjectIcon(module.title)}
                    wash={buildUeWash(module.ueCoefs.map((link) => ({ ue: link.ue, weight: link.coef })), ueColors)}
                    ueTitles={ueTitles}
                    onOpenUe={onOpenUe}
                    showPromoStats={Boolean(report?.showPromoStats)}
                  />
                )
              })}
            </ul>
          </article>
        ))}
      </div>
    </div>
  )
}

export default SubjectsList
