import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { pickInkOn, shadeHex } from '../colorContrast'
import {
  buildUeShareRing,
  computeEvaluationShares,
  describeGapToMean,
  formatShare,
  gradeBucket,
} from '../gradeDetail'
import { loadEvaluationDistribution } from '../gradeDistributionClient'
import { buildUeWash, formatScore, formatUeCode } from '../gradesSubjects'
import GradeHistogram from './GradeHistogram'
import UeShareRing from './UeShareRing'
import { useUeColor } from '../useUeColor'
import { NewBadge } from './SubjectsList'
import CloseButton from './CloseButton'
import { SECONDARY_BUTTON } from '../scodocPageUtils'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const CARD = 'gd-card gd-rise grid gap-4 modal-inner-corners border border-border bg-widget-bg p-4 max-sm:p-[14px]'

// What a grade that isn't a number means for the averages.
const STATE_NOTES = {
  absent: { icon: 'carbon:misuse-outline', text: 'Une absence non justifiée compte 0 dans tes moyennes.' },
  excused: { icon: 'carbon:checkmark-outline', text: 'Absence justifiée : cette évaluation est neutralisée, elle ne compte pas dans tes moyennes.' },
  pending: { icon: 'carbon:hourglass', text: 'La note n’est pas encore saisie sur ScoDoc.' },
}

// What a rattrapage, a session 2 or a bonus does, in place of a weight share.
const TYPE_NOTES = {
  Rattrapage: 'Une note de rattrapage remplace ta moyenne de la matière si elle est meilleure.',
  'Session 2': 'La note de session 2 remplace ta moyenne de la matière.',
  Bonus: 'Une évaluation bonus ajoute (ou retire) des points à ta moyenne de la matière.',
}

const KIND_LABELS = { resource: 'Ressource', sae: 'SAÉ' }

function formatDate(date) {
  const time = Date.parse(date)
  if (!Number.isFinite(time)) return null
  const label = DATE_FORMAT.format(time)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function SectionTitle({ icon, children, aside = null, id }) {
  return (
    <div className="flex min-w-0 items-center gap-[6px]">
      <Icon icon={icon} className="size-[15px] shrink-0 text-text-muted" aria-hidden="true" />
      <h3 id={id} className="m-0 font-body text-[14px] font-semibold leading-none text-text-secondary">{children}</h3>
      {aside ? <span className="ml-auto shrink-0 font-body text-[12.5px] font-medium leading-none text-text-muted">{aside}</span> : null}
    </div>
  )
}

// The grade, big; or what stands in its place (Absent, Excusé, En attente)
// with what it means. Its gap to the promo's mean as a quiet chip.
function Hero({ evaluation, gap, summaryId }) {
  const { grade } = evaluation
  if (grade.kind === 'number') {
    return (
      <div className="gd-rise flex flex-wrap items-end justify-between gap-x-4 gap-y-3" style={{ '--d': '40ms' }}>
        <p id={summaryId} className="m-0 flex items-end gap-[4px] leading-none">
          <span className="gd-grade font-display text-[64px] font-bold leading-[0.8] tracking-[-0.02em] text-text max-sm:text-[56px]" aria-hidden="true">{formatScore(grade.value)}</span>
          <span className="font-body text-[24px] font-medium leading-[0.8] text-text-muted max-sm:text-[21px]" aria-hidden="true">/20</span>
          <span className="sr-only">Ta note : {formatScore(grade.value)} sur 20{gap ? `, ${gap.spoken}` : ''}.</span>
        </p>
        {gap ? (
          <span className="mb-[2px] inline-flex items-center gap-[5px] rounded-full border border-border bg-widget-bg/70 py-[6px] pr-[11px] pl-[8px] text-text-secondary" aria-hidden="true">
            <Icon icon={gap.gap > 0 ? 'carbon:arrow-up-right' : gap.gap < 0 ? 'carbon:arrow-down-right' : 'carbon:subtract-alt'} className="size-[14px]" />
            <span className="font-body text-[13px] font-semibold leading-none">{gap.text}</span>
          </span>
        ) : null}
      </div>
    )
  }
  const note = STATE_NOTES[grade.kind]
  return (
    <div className="gd-rise grid gap-[10px]" style={{ '--d': '40ms' }}>
      <p id={summaryId} className="m-0 flex items-center gap-[10px] leading-none">
        <span className={`gd-state inline-flex size-11 items-center justify-center rounded-full border ${grade.kind === 'pending' ? 'border-dashed border-border-input' : 'border-border'} bg-widget-bg/70`} aria-hidden="true">
          <Icon icon={note?.icon ?? 'carbon:information'} className="size-[22px] text-text-secondary" />
        </span>
        <span className="font-display text-[34px] font-bold leading-none text-text max-sm:text-[30px]">{grade.label}</span>
        {note ? <span className="sr-only">. {note.text}</span> : null}
      </p>
      {note ? <p className="m-0 max-w-[40ch] font-body text-[14px] font-medium leading-[1.4] text-text-secondary" aria-hidden="true">{note.text}</p> : null}
    </div>
  )
}

// The promo's spread on a 0–20 rule: the band from lowest to highest, a tick
// at the mean, the student's dot tagged with their grade. Min, mean and max
// written under it.
function PromoScale({ evaluation }) {
  const { min, moy, max } = evaluation.promo
  const value = evaluation.grade.kind === 'number' ? evaluation.grade.value : null
  const at = (score) => `${(Math.min(20, Math.max(0, score)) / 20) * 100}%`
  const hasBand = min != null && max != null && max >= min
  // The rule's top: room above it for the student's tag when there's one.
  const top = value != null ? 30 : 8
  const stats = [
    { label: 'Min.', value: min, spoken: 'note la plus basse' },
    { label: 'Moyenne', value: moy, spoken: 'moyenne de la promo' },
    { label: 'Max.', value: max, spoken: 'note la plus haute' },
  ].filter((stat) => stat.value != null)

  return (
    <div className="grid gap-4">
      {hasBand || moy != null ? (
        <div className="gd-scale relative mx-[6px]" style={{ height: top + 28 }} aria-hidden="true">
          <span className="absolute inset-x-0 h-[6px] rounded-full bg-brand-subtle" style={{ top }} />
          {hasBand ? <span className="gd-scale-band absolute h-[6px] rounded-full" style={{ top, left: at(min), width: `calc(${at(max)} - ${at(min)})` }} /> : null}
          {moy != null ? (
            <>
              <span className="absolute h-4 w-[2px] -translate-x-1/2 rounded-full bg-text-muted" style={{ top: top - 5, left: at(moy) }} />
              <span className="absolute -translate-x-1/2 whitespace-nowrap font-body text-[11px] font-semibold leading-none text-text-muted" style={{ top: top + 16, left: at(moy) }}>moy.</span>
            </>
          ) : null}
          {value != null ? (
            <span className="gd-scale-you absolute" style={{ top: top + 3, '--x': at(value) }}>
              <span className="absolute bottom-[10px] left-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand px-[7px] py-[4px] font-display text-[12px] font-bold leading-none text-bg">
                {formatScore(value)}
              </span>
              <span className="gd-scale-dot absolute top-0 left-0 size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" />
            </span>
          ) : null}
        </div>
      ) : null}
      <dl className="m-0 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="grid justify-items-center gap-[6px] corners-[14px] bg-bg-subtle px-2 py-[10px] text-center dark:bg-white/[0.04]">
            <dt className="font-body text-[12px] font-medium leading-none text-text-muted">
              <span aria-hidden="true">{stat.label}</span>
              <span className="sr-only">{stat.spoken}</span>
            </dt>
            <dd className="m-0 font-display text-[19px] font-bold leading-none tabular-nums text-text">
              {formatScore(stat.value)}
              <span className="sr-only"> sur 20</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// The UE as on the UE view's links (UeLink): its colour, lit like a ribbon.
// `size="sm"`: a size down, for the simulation sheet's rows.
export function UeTag({ code, color, size = 'md' }) {
  const paintUe = useUeColor()
  const fill = paintUe(color ?? '#341200')
  return (
    <span className={`ue-also-tag shrink-0 rounded-full font-display font-semibold leading-none tracking-[0.2px] ${size === 'sm' ? 'px-[7px] py-[4px] text-[11px]' : 'px-[9px] py-[5px] text-[12px]'}`} style={{ background: fill, color: pickInkOn(fill), '--ue-shade': shadeHex(fill, 0.55) }}>
      {formatUeCode(code)}
    </span>
  )
}

// What the evaluation weighs: its coefficient in the subject, then its
// weight in each UE it counts for, with its share of that UE's average.
function WeightCard({ report, module, evaluation, titleId }) {
  const shares = computeEvaluationShares(report, module, evaluation)
  const ring = buildUeShareRing(report, module, evaluation)
  const typeNote = evaluation.typeLabel ? TYPE_NOTES[evaluation.typeLabel] : null
  // The UE picked on the ring or its rows (an index in ring.ues).
  const [active, setActive] = useState(null)
  const [isKeyboard, setIsKeyboard] = useState(false)
  const ringIndex = (code) => ring?.ues.findIndex((entry) => entry.ue === code) ?? -1

  const rows = shares.length ? (
    <ul className="m-0 grid min-w-0 list-none gap-[2px] p-0">
      {shares.map((entry) => {
        const shareLabel = formatShare(entry.share)
        const index = ringIndex(entry.ue)
        return (
          <li
            key={entry.ue}
            className={`gd-share-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 corners-[12px] px-2 py-[7px] ${ring && active === index ? 'is-active' : ''}`}
            onPointerEnter={ring && index >= 0 ? () => {
              setIsKeyboard(false)
              setActive(index)
            } : undefined}
            onPointerLeave={ring ? () => setActive(null) : undefined}
          >
            <UeTag code={entry.ue} color={entry.color} />
            <span className="grid min-w-0 gap-[4px]">
              <span className="truncate font-body text-[13.5px] font-semibold leading-[1.2] text-text" title={entry.title}>{entry.title}</span>
              <span className="font-body text-[12.5px] font-medium leading-none text-text-muted">poids {formatScore(entry.weight)}</span>
            </span>
            {shareLabel ? (
              <span className="grid justify-items-end gap-[3px] text-right">
                <span className="font-display text-[17px] font-bold leading-none tabular-nums text-text"><span className="sr-only">environ </span>{shareLabel.startsWith('<') ? shareLabel : `≈\u202f${shareLabel}`}</span>
                <span className="font-body text-[11.5px] font-medium leading-none text-text-muted">de l’UE</span>
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  ) : (
    <p className="m-0 font-body text-[13.5px] font-medium leading-[1.4] text-text-secondary">Cette évaluation n’a de poids dans aucune UE.</p>
  )

  return (
    <section className={CARD} style={{ '--d': '200ms' }} aria-labelledby={titleId}>
      <SectionTitle id={titleId} icon="carbon:scales">Poids</SectionTitle>
      {evaluation.coef != null ? (
        <div className="flex items-center justify-between gap-3">
          <span className="grid gap-[4px]">
            <span className="font-body text-[14px] font-semibold leading-none text-text">Coefficient</span>
            <span className="font-body text-[12.5px] font-medium leading-[1.3] text-text-muted">dans {module.title}</span>
          </span>
          <span className="font-display text-[24px] font-bold leading-none tabular-nums text-text">{formatScore(evaluation.coef)}</span>
        </div>
      ) : null}
      {typeNote ? (
        <p className="m-0 flex items-start gap-2 corners-[14px] bg-bg-subtle px-3 py-[10px] font-body text-[13px] font-medium leading-[1.4] text-text-secondary dark:bg-white/[0.04]">
          <Icon icon="carbon:information" className="mt-[1px] size-[15px] shrink-0" aria-hidden="true" />
          {typeNote}
        </p>
      ) : null}
      {/* The ring beside its rows when there's room, above them on a phone. */}
      <div className="@container border-t border-border pt-4">
        <div className={ring ? 'grid items-center gap-x-4 gap-y-3 @min-[400px]:grid-cols-[auto_minmax(0,1fr)]' : ''}>
          {ring ? (
            <UeShareRing ring={ring} active={active} onActiveChange={setActive} isKeyboard={isKeyboard} onKeyboardChange={setIsKeyboard} />
          ) : null}
          <div className="-mx-2 min-w-0">
            {rows}
          </div>
        </div>
      </div>
    </section>
  )
}

// The promo's spread and the histogram of its grades, in one card.
function PromoCard({ evaluation, semesterId, showPromoStats, titleId }) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const value = evaluation.grade.kind === 'number' ? evaluation.grade.value : null
  const hasStats = showPromoStats && ['min', 'moy', 'max'].some((key) => evaluation.promo[key] != null)

  useEffect(() => {
    let isCurrent = true
    setState({ status: 'loading' })
    loadEvaluationDistribution({ semesterId, evaluationId: evaluation.id }).then((result) => {
      if (isCurrent) setState(result)
    })
    return () => {
      isCurrent = false
    }
  }, [semesterId, evaluation.id, attempt])

  const total = state.status === 'ok' ? state.total : null

  return (
    <section className={CARD} style={{ '--d': '120ms' }} aria-labelledby={titleId}>
      <SectionTitle id={titleId} icon="carbon:user-multiple" aside={total ? `${total} ${total > 1 ? 'notes' : 'note'}` : null}>Dans la promo</SectionTitle>
      {hasStats ? <PromoScale evaluation={evaluation} /> : null}
      <div className={`grid gap-3 ${hasStats ? 'border-t border-border pt-4' : ''}`}>
        {/* The chart's title says what the bars count; the key names the
            dark bar. */}
        <div className="flex items-center justify-between gap-3">
          <h4 className="m-0 font-body text-[13px] font-semibold leading-none text-text-secondary">Étudiants par note</h4>
          {state.status === 'ok' && value != null ? (
            <span className="inline-flex items-center gap-[6px] font-body text-[12px] font-medium leading-none text-text-muted" aria-hidden="true">
              <span className="h-[10px] w-[8px] rounded-t-[2px] bg-brand" />
              ta note
            </span>
          ) : null}
        </div>
        <GradeHistogram
          state={state}
          studentBucket={value != null ? gradeBucket(value) : null}
          isPending={evaluation.grade.kind === 'pending'}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      </div>
    </section>
  )
}

// A grade on its own sheet: what it is (subject, title, date, type), the
// grade big, where it sits in the promo (spread and histogram, when the
// department shows promo stats) and what it counts for in each UE.
// Centred card on wide screens, bottom sheet on phones; focus kept inside,
// Escape and the backdrop close it, focus goes back to the row.
// `onWrite`: « Écrire au sujet de cette note » (a mail about it, in the
// Messagerie), null without the in-app mail page.
function GradeDetailModal({ report, module, evaluation, semesterId, icon = null, isNew = false, onWrite = null, onClose }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const summaryId = useId()
  const promoTitleId = useId()
  const weightTitleId = useId()
  const paintUe = useUeColor()
  const ueColors = Object.fromEntries((report?.ues ?? []).map((ue) => [ue.code, paintUe(ue.color)]))
  const wash = buildUeWash(evaluation.weights, ueColors)
  const showPromoStats = Boolean(report?.showPromoStats)
  const gap = showPromoStats ? describeGapToMean(evaluation) : null
  const date = formatDate(evaluation.date)
  // "SAE 5.01 · SAÉ" says it twice: the kind only when the code doesn't.
  const kindLabel = /^SA[EÉ]/i.test(module.code) ? null : KIND_LABELS[module.kind]
  const scrollRef = useRef(null)
  const headerRef = useRef(null)
  const heroRef = useRef(null)
  // Content under the header (its blur shows), and the big grade gone
  // under it (the small one shows).
  const [isStuck, setIsStuck] = useState(false)
  const [isHeroGone, setIsHeroGone] = useState(false)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0
      setIsStuck(scroller.scrollTop > 2)
      setIsHeroGone((heroRef.current?.getBoundingClientRect().bottom ?? Infinity) < headerBottom)
    }
    const handleScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Focus in, page scroll locked; focus back on the opener when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.({ preventScroll: true })
    }
  }, [])

  // On the window, capturing: Escape closes the sheet before the UE view
  // (which closes on Escape too) hears it; Tab stays inside.
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const isInside = dialogRef.current.contains(document.activeElement)
    if (event.shiftKey && (!isInside || document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!isInside || document.activeElement === last)) {
      event.preventDefault()
      first.focus()
    }
  }
  const keyHandlerRef = useRef(handleKeyDown)
  useLayoutEffect(() => {
    keyHandlerRef.current = handleKeyDown
  })
  useEffect(() => {
    const listener = (event) => keyHandlerRef.current(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog relative isolate flex max-h-[min(820px,calc(100dvh-40px))] w-[min(540px,100%)] flex-col modal-corners [--modal-inset:24px] [--modal-inner-radius:20px] max-sm:[--modal-inset:16px] max-sm:[--modal-inner-radius:18px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
      >
        {/* The sheet's content, clipped to its corners by clip-path rather
            than overflow: a rounded overflow clip would make Chromium drop
            the header blur's masks (the blur would cover it evenly). */}
        <div className="gd-clip relative flex min-h-0 flex-1 flex-col">
          {/* The colours of the UEs it counts for, washing the top as on the
              "Dernières notes" cards. */}
          {wash ? <span className="latest-grade-wash gd-wash" style={{ background: wash }} aria-hidden="true" /> : null}
          <div ref={scrollRef} className="gd-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
            {/* Stays on top while the sheet scrolls; once content passes under
                it, a blur fading out downwards (.gd-header-blur) keeps it
                readable, and the grade comes into it when the big one is gone. */}
            <header ref={headerRef} className={`gd-header sticky top-0 z-20 ${isStuck ? 'is-stuck' : ''} ${isHeroGone ? 'is-hero-gone' : ''}`}>
              <span className="gd-header-blur" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </span>
              <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
              <div className="relative flex items-center gap-3 px-6 pt-5 pb-3 max-sm:px-4 max-sm:pt-[14px]">
                <span className="inline-flex size-10 shrink-0 items-center justify-center corners-[12px] border border-border bg-widget-bg/80" aria-hidden="true">
                  {icon ? <Icon icon={icon} className="size-5 text-text" /> : <Icon icon="carbon:book" className="size-5 text-text" />}
                </span>
                <span className="grid min-w-0 flex-1 gap-[4px]">
                  <span className="truncate font-body text-[14px] font-semibold leading-[1.2] text-text" title={module.title}>{module.title}</span>
                  <span className="truncate font-body text-[12.5px] font-medium leading-none text-text-muted">{[module.code, kindLabel].filter(Boolean).join(' · ')}</span>
                </span>
                {/* The grade, small, once the big one has scrolled away. */}
                <span className="gd-header-grade-slot shrink-0" aria-hidden="true">
                  <span>
                    <span className="inline-flex items-end gap-[2px] whitespace-nowrap rounded-full border border-border bg-widget-bg/80 px-[10px] py-[7px] text-text">
                      {evaluation.grade.kind === 'number' ? (
                        <>
                          <span className="font-display text-[15px] font-bold leading-none [text-box:trim-both_cap_alphabetic]">{formatScore(evaluation.grade.value)}</span>
                          <span className="font-body text-[12px] font-medium leading-none text-text-muted [text-box:trim-both_cap_alphabetic]">/20</span>
                        </>
                      ) : (
                        <span className="font-body text-[12.5px] font-semibold leading-none text-text-secondary [text-box:trim-both_cap_alphabetic]">{evaluation.grade.label}</span>
                      )}
                    </span>
                  </span>
                </span>
                <CloseButton glass onClick={onClose} />
              </div>
            </header>

            <div className="grid gap-5 px-6 pt-1 pb-6 max-sm:px-4 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">
              <div className="gd-rise grid gap-[10px]">
                <h2 id={titleId} className="m-0 text-balance font-display text-[22px] font-bold leading-[1.2] text-text max-sm:text-[20px]">{evaluation.description}</h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-[6px]">
                  {date ? (
                    <span className="inline-flex items-center gap-[5px] font-body text-[13px] font-medium leading-none text-text-muted">
                      <Icon icon="carbon:calendar" className="size-[14px]" aria-hidden="true" />
                      {date}
                    </span>
                  ) : null}
                  {evaluation.typeLabel ? (
                    <span className="rounded-full bg-brand-subtle px-[8px] py-[4px] font-body text-[11.5px] font-semibold leading-none text-text-secondary">{evaluation.typeLabel}</span>
                  ) : null}
                  {isNew ? <NewBadge /> : null}
                </div>
              </div>
              <div ref={heroRef}>
                <Hero evaluation={evaluation} gap={gap} summaryId={summaryId} />
              </div>
              {onWrite ? (
                <div className="gd-rise -mt-1" style={{ '--d': '80ms' }}>
                  <button type="button" onClick={onWrite} className={`${SECONDARY_BUTTON} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text`}>
                    <Icon icon="carbon:email" className="size-4 shrink-0" aria-hidden="true" />
                    <span className="font-body text-[14px] font-semibold leading-none text-text">Écrire au sujet de cette note</span>
                  </button>
                </div>
              ) : null}
              <div className="grid gap-3">
                <PromoCard evaluation={evaluation} semesterId={semesterId} showPromoStats={showPromoStats} titleId={promoTitleId} />
                <WeightCard report={report} module={module} evaluation={evaluation} titleId={weightTitleId} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default GradeDetailModal
