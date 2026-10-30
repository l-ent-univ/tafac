import { useEffect, useId, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { parseGradeNumber } from '../gradesReport'
import { formatScore, formatUeCode } from '../gradesSubjects'
import { listUeSubjects, readSimulatedGrade } from '../gradeSimulation'
import { ScoreText } from './SubjectsList'
import UeBadge from './UeBadge'

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const CARD_CLASSES = 'widget-card widget-card-visible shadow-md border border-white modal-inner-corners bg-widget-bg text-text p-2 min-w-0'

function formatDay(date) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? DAY_FORMAT.format(time) : null
}

// An average as it is ("—" without one), and how it's read out.
function Average({ value, size = 'md' }) {
  return value != null
    ? <ScoreText value={value} size={size} />
    : <span className="shrink-0 font-body text-[13px] font-medium text-text-muted" aria-hidden="true">—</span>
}

function spokenAverage(value) {
  return value != null ? `${formatScore(value)} sur 20` : 'pas de moyenne'
}

// Tells the sheet when a field holds something that isn't valid, and that
// it no longer does once the field goes away.
function useReportInvalid(key, invalid, onInvalidChange) {
  useEffect(() => {
    onInvalidChange?.(key, invalid)
    return () => onInvalidChange?.(key, false)
  }, [key, invalid, onInvalidChange])
}

// An added grade's coefficient: a number above 0 (comma fine), 1 to start.
function readCoef(text) {
  const value = parseGradeNumber(String(text ?? '').trim())
  return value != null && value > 0 && value <= 100 ? value : null
}

function CoefField({ id, label, value, onChange, onInvalidChange }) {
  const [draft, setDraft] = useState(formatScore(value))
  const invalid = readCoef(draft) == null
  useReportInvalid(`${id}-coef`, invalid, onInvalidChange)
  return (
    <label className="inline-flex items-center gap-[5px] font-body text-[13px] font-medium leading-none text-text-muted">
      coef
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={draft}
        aria-label={`Coefficient de ${label}`}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = readCoef(event.target.value)
          if (next != null) onChange(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className={`simulation-input h-7 w-[38px] corners-[8px] border px-[2px] text-center font-body text-[13px] font-semibold leading-none text-text ${invalid ? 'border-error' : 'border-border-input bg-bg-input'}`}
      />
    </label>
  )
}

// A grade added by hand to the subject: "Note ajoutée", its coefficient,
// its grade, and a way to take it back out.
function CustomRow({ custom, index, override, onOverride, onCoef, onRemove, onInvalidChange }) {
  const label = `Note ajoutée ${index + 1}`
  return (
    <li className={`subject-evaluation subject-evaluation--custom flex min-w-0 items-center gap-3 py-[8px] pr-[6px] pl-3 ${override != null ? 'subject-evaluation--simulated' : ''}`}>
      <span className="grid min-w-0 flex-1 gap-[5px]">
        <span className="truncate font-body text-[14px] font-semibold leading-[1.3] text-text">
          {label}
          {override != null ? <span className="ml-[2px] text-text-muted" aria-hidden="true">*</span> : null}
        </span>
        <CoefField id={custom.id} label={label} value={custom.coef} onChange={onCoef} onInvalidChange={onInvalidChange} />
      </span>
      <GradeField
        evaluation={{ id: custom.id, description: label, grade: { kind: 'none' } }}
        value={override}
        onChange={onOverride}
        onInvalidChange={onInvalidChange}
      />
      <button
        type="button"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer transition-colors hover:bg-bg-subtle hover:text-text"
        aria-label={`Retirer ${label}`}
        onClick={onRemove}
      >
        <Icon icon="carbon:close" className="size-4" aria-hidden="true" />
      </button>
    </li>
  )
}

// The grade field: empty means the real grade (its placeholder, "—" when
// there's none yet); a French comma is fine. What's typed stays here, only a
// valid grade reaches the overrides. Whether what's typed isn't a grade
// goes up (`onInvalidChange`), so the sheet holds "Suivant" back meanwhile.
function GradeField({ evaluation, value, onChange, onInvalidChange }) {
  const [draft, setDraft] = useState(value != null ? formatScore(value) : '')
  const invalid = readSimulatedGrade(draft).kind === 'invalid'
  const isNumber = evaluation.grade.kind === 'number'
  useReportInvalid(`${evaluation.id}`, invalid, onInvalidChange)
  return (
    <span className="flex shrink-0 items-baseline gap-[3px]">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={draft}
        placeholder={isNumber ? formatScore(evaluation.grade.value) : '—'}
        aria-invalid={invalid || undefined}
        aria-label={`Note pour ${evaluation.description}, sur 20${isNumber ? `, note réelle ${formatScore(evaluation.grade.value)}` : ''}${value != null ? ', modifiée' : ''}`}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          const next = readSimulatedGrade(text)
          if (next.kind === 'empty') onChange(null)
          else if (next.kind === 'grade') onChange(next.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className={`simulation-input h-9 w-[50px] corners-[10px] border px-[2px] text-center font-display text-[17px] font-bold leading-none text-text placeholder:font-semibold placeholder:text-text-50 ${invalid ? 'border-error' : value != null ? 'simulation-input--set' : 'border-border-input bg-bg-input'}`}
      />
      <span className="font-body text-[13px] font-medium leading-none text-text-muted" aria-hidden="true">/20</span>
    </span>
  )
}

// One evaluation: its name, what it is (date, coef, "En attente"…), and its
// grade. When a grade there moves the averages (normal evaluations) it's a
// field; otherwise (rattrapage, bonus) it's shown as it is.
function EvaluationRow({ evaluation, override, onOverride, onInvalidChange }) {
  const isNumber = evaluation.grade.kind === 'number'
  const details = [
    evaluation.typeLabel,
    !isNumber ? evaluation.grade.label : null,
    formatDay(evaluation.date),
    evaluation.coef != null ? `coef ${formatScore(evaluation.coef)}` : null,
  ].filter(Boolean)

  return (
    <li className={`subject-evaluation flex min-w-0 items-center gap-3 py-[9px] pr-[10px] pl-3 ${override != null ? 'subject-evaluation--simulated' : ''}`}>
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <span className="line-clamp-2 break-words font-body text-[14px] font-semibold leading-[1.3] text-text" title={evaluation.description}>
          {evaluation.description}
          {/* A grade typed in: a little "*" after the name. */}
          {override != null ? <span className="ml-[2px] text-text-muted" aria-hidden="true">*</span> : null}
        </span>
        {details.length ? <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">{details.join(' · ')}</span> : null}
      </span>
      {evaluation.canSimulate
        ? <GradeField evaluation={evaluation} value={override} onChange={onOverride} onInvalidChange={onInvalidChange} />
        : <span className="shrink-0 font-body text-[14px] font-semibold text-text-secondary">{isNumber ? `${formatScore(evaluation.grade.value)}/20` : evaluation.grade.label}</span>}
    </li>
  )
}

// A ressource or SAÉ of the UE: its average in the UE as it is, opening
// onto its evaluations, then the grades added by hand (`customs`) and the
// button to add one, so a grade still to come that ScoDoc doesn't list yet
// can be tried too. Every subject opens, even one without an evaluation.
function SubjectRow({ subject, icon, overrides, onOverride, customs, onAddCustom, onCustomCoef, onRemoveCustom, onInvalidChange, isOpen, onToggle }) {
  const id = useId()
  const evaluations = subject.evaluations
  const pending = evaluations.filter((evaluation) => evaluation.canSimulate && evaluation.grade.kind !== 'number').length
  const progress = [
    evaluations.length ? `${evaluations.length} évaluation${evaluations.length > 1 ? 's' : ''}` : 'Aucune évaluation',
    pending ? `${pending} à venir` : null,
    customs.length ? `${customs.length} ajoutée${customs.length > 1 ? 's' : ''}` : null,
    subject.coef != null ? `coef ${formatScore(subject.coef)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className={`subject-row modal-nested-corners ${isOpen ? 'subject-row--open' : ''}`}>
      <button
        id={`${id}-button`}
        type="button"
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        aria-label={`${subject.title}, ${progress}, moyenne dans l’UE ${spokenAverage(subject.average)}`}
        onClick={onToggle}
        className="subject-row-toggle flex w-full min-w-0 cursor-pointer items-center gap-3 modal-nested-corners border-0 bg-transparent px-2 py-2 text-left text-text max-md:gap-[10px]"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center corners-[12px] bg-brand-subtle max-md:size-9 max-md:corners-[11px]" aria-hidden="true">
          {icon ? <Icon icon={icon} className="size-5 text-text max-md:size-[18px]" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-[3px]">
          <span className="truncate font-body text-[15px] font-semibold leading-[1.3] max-md:line-clamp-2 max-md:whitespace-normal max-md:break-words" title={subject.title}>{subject.title}</span>
          <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">{subject.code} · {progress}</span>
        </span>
        <Average value={subject.average} />
        <Icon icon="carbon:chevron-down" className="subject-row-chevron size-4 shrink-0 text-text-muted" aria-hidden="true" />
      </button>
      <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} className="subject-panel">
        <div className="subject-panel-inner">
          <div className="grid gap-[6px] px-2 pb-3 pt-[2px]">
            {evaluations.length || customs.length ? (
              <ol className="m-0 grid list-none gap-[6px] p-0">
                {evaluations.map((evaluation) => (
                  <EvaluationRow
                    key={evaluation.id}
                    evaluation={evaluation}
                    override={overrides[evaluation.id] ?? null}
                    onOverride={(value) => onOverride(evaluation.id, value)}
                    onInvalidChange={onInvalidChange}
                  />
                ))}
                {customs.map((custom, index) => (
                  <CustomRow
                    key={custom.id}
                    custom={custom}
                    index={index}
                    override={overrides[custom.id] ?? null}
                    onOverride={(value) => onOverride(custom.id, value)}
                    onCoef={(coef) => onCustomCoef(custom.id, coef)}
                    onRemove={() => onRemoveCustom(custom.id)}
                    onInvalidChange={onInvalidChange}
                  />
                ))}
              </ol>
            ) : null}
            <button
              type="button"
              className="subject-add-grade inline-flex min-h-[42px] w-full items-center justify-center gap-[6px] corners-[14px] border border-dashed border-border-input bg-transparent px-3 font-body text-[14px] font-semibold text-text-secondary cursor-pointer transition-colors hover:bg-bg-subtle hover:text-text"
              onClick={onAddCustom}
            >
              <Icon icon="carbon:add" className="size-4" aria-hidden="true" />
              Ajouter une note
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

// The simulator's second step: the UE picked, its badge in the corner (where
// it lands, `badgeRef`) with its name and its average as it is; then its
// ressources and SAÉ, each opening onto its evaluations with a grade field.
// Nothing is worked out here: the grades typed in (`overrides`) and added
// (`customs`, subject code → [{ id, coef }], with `customActions`) are for
// the next step.
function GradeSimulatorUe({ ue, report, overrides, onOverride, customs, customActions, onInvalidChange, subjectIcon, badgeRef, titleRef }) {
  const subjects = useMemo(() => listUeSubjects(report, ue.code), [report, ue.code])
  const groups = [
    { kind: 'resource', label: 'Ressources', subjects: subjects.filter((subject) => subject.kind !== 'sae') },
    { kind: 'sae', label: 'SAÉ', subjects: subjects.filter((subject) => subject.kind === 'sae') },
  ].filter((group) => group.subjects.length)
  // One subject open at a time: opening another closes the one before.
  const [openCode, setOpenCode] = useState(null)
  const headingId = useId()

  const toggle = (code) => setOpenCode((current) => (current === code ? null : code))

  return (
    <div className="grid gap-4">
      {/* Stays on top as the list scrolls: the UE and its average. */}
      <div className="sticky top-0 z-10 -mx-6 flex min-w-0 items-center gap-3 bg-bg px-6 pt-3 pb-3 max-sm:-mx-4 max-sm:px-4">
        <span ref={badgeRef} className="ue-picked inline-block shrink-0">
          <UeBadge code={ue.code} color={ue.color} className="h-auto w-[76px]" />
        </span>
        <span className="grid min-w-0 flex-1 gap-[4px]">
          <h3 ref={titleRef} tabIndex={-1} className="semester-fade m-0 line-clamp-2 min-w-0 font-display text-[19px] font-bold leading-[1.2] text-text outline-none max-sm:text-[17px]">
            {ue.title || formatUeCode(ue.code)}
          </h3>
          <span className="semester-fade flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 [animation-delay:60ms]">
            <span className="font-body text-[13px] font-medium leading-none text-text-muted">Moyenne de l’UE</span>
            <Average value={ue.average} size="sm" />
            <span className="sr-only">{spokenAverage(ue.average)}</span>
          </span>
        </span>
      </div>
      <div className="semester-fade grid gap-3 [animation-delay:180ms]">
        {groups.map((group) => (
          <section key={group.kind} className={CARD_CLASSES} aria-labelledby={`${headingId}-${group.kind}`}>
            <h4 id={`${headingId}-${group.kind}`} className="m-0 px-2 pt-2 pb-[6px] font-body text-[15px] font-medium leading-[1.06] text-text-muted">
              {group.label}
            </h4>
            <ul className="m-0 grid list-none gap-[2px] p-0">
              {group.subjects.map((subject) => (
                <SubjectRow
                  key={subject.code}
                  subject={subject}
                  icon={subjectIcon(subject.title)}
                  overrides={overrides}
                  onOverride={onOverride}
                  customs={customs[subject.code] ?? []}
                  onAddCustom={() => customActions.add(subject.code)}
                  onCustomCoef={customActions.setCoef}
                  onRemoveCustom={customActions.remove}
                  onInvalidChange={onInvalidChange}
                  isOpen={openCode === subject.code}
                  onToggle={() => toggle(subject.code)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

export default GradeSimulatorUe
