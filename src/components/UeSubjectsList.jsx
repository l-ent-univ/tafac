import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Icon } from '@iconify/react'
import { trackGradesAction } from '../analytics'
import { formatRank, formatScore, formatSignedPoints, listUeGroups } from '../gradesSubjects'
import { EvaluationRow, NewBadge, ScoreText } from './SubjectsList'
import CardInfoTip from './CardInfoTip'
import { readHistoryNav, writeHistoryNav } from '../appHistory'
import UeBadge from './UeBadge'
import UeLink from './UeLink'
import { useUeColor } from '../useUeColor'

// UE tiles side by side, as many ≥320px as fit a row (one on a phone), in
// UE order, a row's tiles at one height. Wrapping boxes, not grid columns:
// a shorter last row (5 UEs: 3 + 2) shares the full width too. A tile never
// grows downward: it opens into the full-page view.
const COLUMNS_CLASSES = 'flex flex-wrap gap-3 max-md:gap-2'
const CARD_CLASSES = '@container isolate relative overflow-hidden widget-card widget-card-visible shadow-md border border-white card-corners bg-widget-bg text-text p-2 min-w-0'

const STATE_LABELS = {
  validated: 'Validée',
  below: 'Sous 10',
  pending: 'Pas encore de note',
}

// A UE validated otherwise than by its own average (describeUeValidation):
// a quiet chip beside its credits, why in a tip on the full view, and in
// words for screen readers (`spoken`, the card's description).
const VALIDATION_TAGS = {
  capitalization: {
    label: 'Capitalisée',
    spoken: 'Capitalisée : déjà validée lors d’un semestre précédent, elle reste acquise avec ses crédits',
    tip: 'UE capitalisée : tu l’as déjà validée lors d’un semestre précédent (un semestre redoublé, par ex.). Elle reste acquise avec ses crédits, et ScoDoc garde ta meilleure moyenne.',
  },
  compensation: {
    label: 'Compensée',
    spoken: 'Validée par compensation : moyenne sous 10, mais ses crédits sont acquis',
    tip: 'Moyenne sous 10, mais l’UE est validée par compensation : en BUT, avec l’UE du même niveau de l’autre semestre de l’année. Ses crédits te sont acquis.',
  },
  jury: {
    label: 'Validée par le jury',
    spoken: 'Validée par le jury : moyenne sous 10, mais ses crédits sont acquis',
    tip: 'Moyenne sous 10, mais le jury a validé cette UE. Ses crédits te sont acquis.',
  },
}

// Phosphor's coin, drawn here so its two parts take two colours: the whole
// coin (face and edge) filled with the UE's colour, the outline in the
// text's grey.
const COIN_OUTLINE = 'M207.58 63.84C186.85 53.48 159.33 48 128 48s-58.85 5.48-79.58 15.84S16 88.78 16 104v48c0 15.22 11.82 29.85 32.42 40.16S96.67 208 128 208s58.85-5.48 79.58-15.84S240 167.22 240 152v-48c0-15.22-11.82-29.85-32.42-40.16M128 64c62.64 0 96 23.23 96 40s-33.36 40-96 40s-96-23.23-96-40s33.36-40 96-40m-8 95.86v32c-19-.62-35-3.42-48-7.49v-31.32a203.4 203.4 0 0 0 48 6.81m16 0a203.4 203.4 0 0 0 48-6.81v31.31c-13 4.07-29 6.87-48 7.49ZM32 152v-18.47a83 83 0 0 0 16.42 10.63c2.43 1.21 5 2.35 7.58 3.43V178c-15.83-7.84-24-17.71-24-26m168 26v-30.41c2.61-1.08 5.15-2.22 7.58-3.43A83 83 0 0 0 224 133.53V152c0 8.29-8.17 18.16-24 26'
const COIN_SILHOUETTE = 'M24 104C24 80 64 56 128 56S232 80 232 104V152C232 176 192 200 128 200S24 176 24 152Z'

function CoinIcon({ color }) {
  return (
    <svg viewBox="0 0 256 256" className="size-[14px] shrink-0" aria-hidden="true">
      <path d={COIN_SILHOUETTE} fill={color} />
      <path d={COIN_OUTLINE} fill="currentColor" />
    </svg>
  )
}

// The tile and its full-screen view share view-transition names, so the
// browser morphs one into the other (ribbon, title and average glide on
// their own). Names are idents: "UE5.1" → "UE5_1".
function morph(part, code) {
  return { viewTransitionName: `ue-${part}-${String(code).replace(/[^a-zA-Z0-9-]/g, '_')}` }
}

// Runs a state change as a view transition where the browser has them and
// motion is welcome, plainly otherwise. `after` runs on the updated DOM
// before the new state is captured (to set the scroll it should land on).
function withViewTransition(update, after = () => {}) {
  const apply = () => {
    flushSync(update)
    after()
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduceMotion) {
    apply()
    return Promise.resolve()
  }
  return document.startViewTransition(apply).updateCallbackDone.catch(() => {})
}

// Scrolls whatever scrolls the page (the window or a scrolling ancestor) so
// `element`'s top lands `top` px from the top of the window.
function scrollElementTo(element, top) {
  if (!element) return
  const delta = element.getBoundingClientRect().top - top
  let scroller = element.parentElement
  while (scroller && scroller !== document.body) {
    const { overflowY } = getComputedStyle(scroller)
    if (/(auto|scroll)/.test(overflowY) && scroller.scrollHeight > scroller.clientHeight) break
    scroller = scroller.parentElement
  }
  if (scroller && scroller !== document.body) scroller.scrollTop += delta
  else window.scrollBy(0, delta)
}

// The under-10 warning before the jury: the UE can still be validated by
// compensation.
const BELOW_TEN_NOTE = 'Moyenne sous 10 : cette UE n’est pas validée pour l’instant. En BUT, elle peut encore l’être par compensation, si sa moyenne avec l’UE du même niveau de l’autre semestre de l’année atteint 10.'

// Once the jury has ruled without validating the UE, its code takes the
// warning's place, in red, and says what it means (ScoDoc's CODES_EXPL, put
// for a student). An unknown code still shows, with a general note.
const UE_DECISIONS = {
  AJ: {
    title: 'Ajournée',
    note: 'Le jury n’a pas validé cette UE : sa moyenne n’atteint pas 10. Ses crédits ne te sont pas acquis ; vois avec ton département pour la suite (rattrapage, redoublement…).',
  },
  RAT: {
    title: 'En attente d’un rattrapage',
    note: 'Tu as une ou plusieurs épreuves de rattrapage à passer. Le jury statuera sur cette UE après le rattrapage ; d’ici là, ses crédits ne te sont pas acquis.',
  },
  ATT: {
    title: 'Décision en attente',
    note: 'Le jury attend un autre semestre pour statuer, faute d’atteindre la moyenne. L’UE peut encore être validée, par compensation avec l’UE du même niveau de l’autre semestre de l’année.',
  },
  ATJ: {
    title: 'En attente pour assiduité',
    note: 'Le jury attend un autre semestre pour statuer, ton assiduité ayant été jugée insuffisante. Vois avec ton département ce qu’il te faut fournir ou rattraper.',
  },
  ATB: {
    title: 'Décision en attente',
    note: 'Le jury attend un autre semestre pour statuer, au moins une UE étant sous la barre.',
  },
  DEF: {
    title: 'Défaillant',
    note: 'Pas ou trop peu de notes pour évaluer cette UE (arrêt de la formation ou manque d’assiduité). Elle n’est pas validée.',
  },
  ABAN: {
    title: 'Non évaluée',
    note: 'Tes notes n’ont pas été présentées au jury, pour manque d’assiduité. L’UE n’est pas validée.',
  },
  DEM: {
    title: 'Démission',
    note: 'Tu as démissionné : l’UE n’est pas validée.',
  },
  UEBSL: {
    title: 'UE blanchie',
    note: 'Cette UE a été blanchie par le jury : elle ne compte pas.',
  },
}

function describeDecision(code) {
  return UE_DECISIONS[code] ?? {
    title: `Code ${code}`,
    note: 'Décision du jury pour cette UE : elle n’est pas validée. Vois avec ton département ce que ce code veut dire pour toi.',
  }
}

// Beside the UE average: under 10, the amber warning; once the jury has
// ruled without validating it, its code in red, with what it means.
function BelowTenMark({ decision }) {
  if (!decision) {
    return (
      <CardInfoTip label="Moyenne sous 10 : qu’est-ce que ça veut dire ?" icon="carbon:warning-alt-filled" iconClassName="ue-below-warning">
        {BELOW_TEN_NOTE}
      </CardInfoTip>
    )
  }
  const { title, note } = describeDecision(decision)
  return (
    <CardInfoTip
      label={`Décision du jury : ${decision}, ${title.toLowerCase()}. Qu’est-ce que ça veut dire ?`}
      icon="carbon:warning-filled"
      iconClassName="ue-jury-decision"
      text={decision}
    >
      <span className="block font-semibold">{decision} · {title}</span>
      <span className="mt-[3px] block">{note}</span>
    </CardInfoTip>
  )
}

// The UE average as the page's other big numbers (no pill), bigger in the
// full-screen view; a mark beside it only under 10 (BelowTenMark).
function UeAverage({ ue, large = false, stateId, style }) {
  const state = VALIDATION_TAGS[ue.validatedBy]?.spoken
    ?? (ue.state === 'below' && ue.decision ? `Non validée par le jury : ${ue.decision}, ${describeDecision(ue.decision).title.toLowerCase()}` : STATE_LABELS[ue.state])
  return (
    <div className="ue-vt flex items-center gap-[6px]" style={style}>
      {ue.state === 'below' ? <BelowTenMark decision={ue.decision} /> : null}
      <div className="flex items-end gap-[3px] leading-[1.06]">
        {ue.average != null ? (
          <>
            <span className={`font-display font-bold leading-none ${large ? 'text-[44px] max-md:text-[36px]' : 'text-[30px] max-md:text-[26px]'}`}>{formatScore(ue.average)}</span>
            {/* "/20" keeps one ratio to the number at both sizes, so the two
                scale into each other without doubling mid-morph. */}
            <span className={`font-body font-medium leading-none text-text-muted ${large ? 'pb-[3px] text-[23px] max-md:text-[21px]' : 'pb-[2px] text-[16px] max-md:text-[15px]'}`}>/20</span>
          </>
        ) : (
          <span className={`font-display font-bold leading-none text-text-muted ${large ? 'text-[36px]' : 'text-[26px]'}`}>—</span>
        )}
        {/* The state stays for screen readers; the warning, the
            validation chip and the "UE validées" ring show it. */}
        <span id={stateId} className="sr-only">{state}</span>
      </div>
    </div>
  )
}

// The UE's credits: a coin filled with the UE's colour, outline and text neutral.
function UeCredits({ ue, color }) {
  if (!ue.ects?.total) return null
  return (
    <span className="inline-flex items-center gap-[4px] whitespace-nowrap font-body text-[12px] font-medium leading-none text-text-muted">
      <CoinIcon color={color} />
      {formatScore(ue.ects.total)} ECTS
    </span>
  )
}

// What ScoDoc already added to (bonus) or took from (malus) the UE average,
// as a chip: it explains the number, never changes it. The full view says
// why in a tip; the tile, short on room, only shows the chip.
const ADJUSTMENTS = [
  {
    key: 'bonus',
    label: 'Bonus',
    sign: 1,
    tip: (points) => `Bonus de ${points} point, déjà inclus dans la moyenne de l’UE affichée. Ton département l’accorde, par ex. pour une activité sportive ou culturelle.`,
  },
  {
    key: 'malus',
    label: 'Malus',
    sign: -1,
    tip: (points) => `Malus de ${points} point, déjà déduit de la moyenne de l’UE affichée. Ton département l’applique, par ex. pour des absences injustifiées.`,
  },
]

// How the UE was validated when it isn't its average (VALIDATION_TAGS), as
// a chip like the bonus's. Its words are already in the card's description:
// hidden from screen readers, but for the tip's button.
function UeValidationTag({ ue, withTip = false }) {
  const tag = VALIDATION_TAGS[ue.validatedBy]
  if (!tag) return null
  return (
    <span className="ue-validation-tag inline-flex items-center gap-[4px] whitespace-nowrap rounded-full bg-bg-subtle px-[7px] py-[3px] font-body dark:bg-white/[0.08] text-[12px] font-semibold leading-none text-text-secondary has-[button]:py-[1px] has-[button]:pr-[2px]">
      <Icon icon="carbon:checkmark" className="size-[12px] shrink-0" aria-hidden="true" />
      <span aria-hidden="true">{tag.label}</span>
      {withTip ? <CardInfoTip label={`${tag.label} : qu’est-ce que ça veut dire ?`}>{tag.tip}</CardInfoTip> : null}
    </span>
  )
}

function UeAdjustments({ ue, withTips = false }) {
  return ADJUSTMENTS.filter(({ key }) => ue[key] != null).map(({ key, label, sign, tip }) => {
    const points = formatSignedPoints(sign * ue[key])
    return (
      <span key={key} className="inline-flex items-center gap-[3px] whitespace-nowrap rounded-full bg-bg-subtle px-[7px] py-[3px] font-body dark:bg-white/[0.08] text-[12px] font-semibold leading-none text-text-secondary has-[button]:py-[1px] has-[button]:pr-[2px]">
        {label} {points}{withTips ? ' inclus' : ''}
        {withTips ? <CardInfoTip label={`${label} ${points} : qu’est-ce que c’est ?`}>{tip(points)}</CardInfoTip> : null}
      </span>
    )
  })
}

// Under the full view's title: credits, the UE's rank when the department
// shows ranks, and its bonus or malus.
function UeFullMeta({ ue, color }) {
  const rank = formatRank(ue.rank)
  if (!ue.ects?.total && !rank && ue.bonus == null && ue.malus == null && !VALIDATION_TAGS[ue.validatedBy]) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <UeCredits ue={ue} color={color} />
      <UeValidationTag ue={ue} withTip />
      {rank ? (
        <span className="whitespace-nowrap font-body text-[12px] font-medium leading-none text-text-muted">
          <span aria-hidden="true">{rank.text}</span>
          <span className="sr-only">{rank.spoken} dans cette UE</span>
        </span>
      ) : null}
      <UeAdjustments ue={ue} withTips />
    </div>
  )
}

function UeModuleRow({ rowId, ueCode, module, isOpen, onToggle, icon, showPromoStats, newEvaluationIds, alsoIn, onJump }) {
  const id = useId()
  const buttonId = `${id}-button`
  const panelId = `${id}-panel`
  // No evaluation yet in this UE: nothing to open, a plain row (no chevron).
  const isEmpty = module.evaluations.length === 0
  const meta = [
    module.code,
    module.coef != null ? `coef ${formatScore(module.coef)}` : null,
    module.pendingCount ? `${module.pendingCount} en attente` : null,
    isEmpty ? 'pas encore d’évaluation' : null,
  ].filter(Boolean).join(' · ')
  const hasNewGrade = module.evaluations.some(({ evaluation }) => newEvaluationIds.has(String(evaluation.id)))
  const Header = isEmpty ? 'div' : 'button'
  const spoken = `${hasNewGrade ? 'Nouvelle note, ' : ''}${module.title}, ${module.code}, coefficient ${module.coef ?? '—'} dans ${ueCode}${module.average != null ? `, moyenne ${formatScore(module.average)} sur 20 dans cette UE` : ''}`

  return (
    <li id={rowId} className={`subject-row scroll-mt-24 corners-[16px] ${isOpen ? 'subject-row--open' : ''}`}>
      <Header
        id={buttonId}
        {...(isEmpty
          ? { 'aria-label': `${spoken}, pas encore d’évaluation` }
          : { type: 'button', 'aria-expanded': isOpen, 'aria-controls': panelId, 'aria-label': spoken, onClick: onToggle })}
        className={`${isEmpty ? '' : 'subject-row-toggle cursor-pointer '}flex w-full min-w-0 items-center gap-3 corners-[16px] border-0 bg-transparent px-2 py-2 text-left text-text max-md:gap-[10px]`}
      >
        {/* Neutral: the card already carries the UE's colour. Outlined so the
            tile still reads on the card's tinted top. */}
        <span className="inline-flex size-9 shrink-0 items-center justify-center corners-[11px] border border-border bg-bg-subtle" aria-hidden="true">
          {icon ? <Icon icon={icon} className="size-[18px] text-text-secondary" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-[3px]">
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="truncate font-body text-[15px] font-semibold leading-[1.3]" title={module.title}>{module.title}</span>
            {hasNewGrade ? <NewBadge /> : null}
          </span>
          <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">{meta}</span>
        </span>
        {module.average != null
          ? <ScoreText value={module.average} />
          : <span className="shrink-0 font-body text-[13px] font-semibold text-text-muted">—</span>}
        {isEmpty ? <span className="size-4 shrink-0" aria-hidden="true" /> : <Icon icon="carbon:chevron-down" className="subject-row-chevron size-4 shrink-0 text-text-muted" aria-hidden="true" />}
      </Header>
      {isEmpty ? null : (
      <div id={panelId} role="region" aria-labelledby={buttonId} className="subject-panel">
        <div className="subject-panel-inner">
          {/* The evaluation cards run the panel's full width. */}
          <div className="px-2 pb-2">
            {module.evaluations.length ? (
              <ol className="m-0 grid list-none gap-[6px] p-0">
                {module.evaluations.map(({ evaluation, weight }) => (
                  <EvaluationRow key={evaluation.id} evaluation={evaluation} moduleCode={module.code} weight={weight} showPromoStats={showPromoStats} isNew={newEvaluationIds.has(String(evaluation.id))} compact openFrom="ue_view" />
                ))}
              </ol>
            ) : (
              <p className="m-0 py-[6px] font-body text-[14px] font-medium leading-[1.4] text-text-muted">Pas encore d’évaluation pour cette UE.</p>
            )}
            {/* The same subject in the other UEs it feeds, with its average
                there: a click opens it in that UE. Under the cards, no rule,
                lined up with their text. */}
            {alsoIn.length ? (
              <div className="mt-[10px] flex flex-wrap items-center gap-[6px] pl-[13px]">
                <span className="font-body text-[13px] font-medium leading-none text-text-muted">Compte aussi dans</span>
                {alsoIn.map((other) => (
                  <UeLink
                    key={other.code}
                    code={other.code}
                    color={other.color}
                    onClick={() => onJump(other.code)}
                    label={`Voir ${module.title} dans ${other.code}${other.average != null ? `, moyenne ${formatScore(other.average)} sur 20` : ''}`}
                  >
                    {other.average != null ? (
                      <span className="inline-flex items-baseline gap-[1px]">
                        <span className="font-display text-[13px] font-bold leading-none">{formatScore(other.average)}</span>
                        <span className="font-body text-[11px] font-medium leading-none text-text-muted">/20</span>
                      </span>
                    ) : null}
                  </UeLink>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      )}
    </li>
  )
}

// "Matières", by UE: one tile per UE in its ScoDoc colour (ribbon, title,
// credits, average with a warning under 10). A tile opens into a full-screen
// view, morphing into it: the subjects that feed the UE, biggest coefficient
// first, each with its average in this UE and opening onto the evaluations
// that count for it. A subject feeding two UEs is in both, with each UE's
// numbers, and links from one to the other.
// - A UE with unread grades is tinted with its colour and its tile says how
//   many and in which subjects; that line opens the view on the first one.
// - One subject open at a time. Opening it reads its new grades: they're
//   marked read (onReadEvaluations) and their badges go when it closes.
function UeSubjectsList({ report, subjectIcon = () => null, newEvaluationIds = new Set(), onReadEvaluations = () => {}, onFocusChange = () => {}, openRequest = null }) {
  const groups = useMemo(() => listUeGroups(report), [report])
  const paintUe = useUeColor()
  const [expandedCode, setExpandedCode] = useState(null)
  // The one UE whose tile carries the morph names: named, the other tiles
  // would become layers of their own, fading over the growing card.
  const [morphCode, setMorphCode] = useState(null)
  // The open subject ("UE:module") and the new ids it showed.
  const [openSubject, setOpenSubject] = useState(null)
  const [readIds, setReadIds] = useState(() => new Set())
  const [pendingFocus, setPendingFocus] = useState(null)
  const backButtonRef = useRef(null)
  // Where the tile sat in the window, to land back on it when the view closes.
  const tileTopRef = useRef(0)
  const headingId = useId()
  const showPromoStats = Boolean(report?.showPromoStats)
  const rowId = (key) => `${headingId}-row-${key}`
  const expanded = groups.find((ue) => ue.code === expandedCode) ?? null

  const unreadIds = useMemo(
    () => new Set([...newEvaluationIds].filter((id) => !readIds.has(id))),
    [newEvaluationIds, readIds],
  )
  const hasUnread = (module) => module.evaluations.some(({ evaluation }) => unreadIds.has(String(evaluation.id)))

  // Module code → the UEs it feeds, with its average in each.
  const uesByModule = useMemo(() => {
    const map = new Map()
    for (const ue of groups) {
      for (const module of ue.modules) {
        if (!map.has(module.code)) map.set(module.code, [])
        map.get(module.code).push({ code: ue.code, color: ue.color, average: module.average, module })
      }
    }
    return map
  }, [groups])

  // A subject to bring into view in the full view (opened from a tile's
  // news, a jump from another UE or a "Dernières notes" card), the keyboard
  // focus on it; for a card, its evaluation, flashed once the subject's
  // panel has opened.
  useEffect(() => {
    if (!pendingFocus) return
    const { key, evaluationId } = pendingFocus
    const row = document.getElementById(rowId(key))
    if (!row) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior = reduceMotion ? 'auto' : 'smooth'
    row.querySelector('button')?.focus({ preventScroll: true })
    setPendingFocus(null)
    const evaluationRow = evaluationId != null
      ? row.querySelector(`[data-evaluation-id="${CSS.escape(String(evaluationId))}"]`)
      : null
    if (!evaluationRow) {
      row.scrollIntoView({ block: 'center', behavior })
      return
    }
    // Not cleared on re-render: the effect re-runs at once (pendingFocus
    // goes back to null) and the scroll must still happen.
    window.setTimeout(() => {
      evaluationRow.scrollIntoView({ block: 'center', behavior })
      evaluationRow.classList.remove('is-flashing')
      void evaluationRow.offsetWidth
      evaluationRow.classList.add('is-flashing')
      evaluationRow.addEventListener('animationend', () => evaluationRow.classList.remove('is-flashing'), { once: true })
    }, reduceMotion ? 0 : 320)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus])

  // The open view takes the page (GradesPage hides the rest) and the focus
  // starts on its back button, unless a subject asks for it. The page gets
  // its sections back if the UE goes (another semester) or the list does.
  const isExpanded = Boolean(expanded)
  useEffect(() => {
    onFocusChange(isExpanded)
    if (isExpanded && !document.activeElement?.closest('.ue-full-view')) backButtonRef.current?.focus({ preventScroll: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onFocusChange(false), [])

  // Closing a subject turns the grades it showed into read ones.
  const closeSubject = () => {
    if (!openSubject) return
    const { ids } = openSubject
    if (ids.length) setReadIds((current) => new Set([...current, ...ids]))
    setOpenSubject(null)
  }

  const openSubjectRow = (key, module) => {
    const wasOpen = openSubject?.key === key
    closeSubject()
    if (wasOpen) return
    const ids = module.evaluations.map(({ evaluation }) => String(evaluation.id)).filter((id) => unreadIds.has(id))
    if (ids.length) onReadEvaluations(ids)
    setOpenSubject({ key, ids })
  }

  const tileOf = (code) => document.querySelector(`[data-ue-open="${CSS.escape(String(code))}"]`)?.closest('article')
  const viewId = `${headingId}-view`

  // Opens a UE over the whole page, on one of its subjects (and one of its
  // evaluations) if given; the view lands at the top of the window. A new
  // history entry, unless it comes from one (back / forward).
  const expand = (code, module = null, evaluationId = null, { push = true } = {}) => {
    if (!expandedCode) tileTopRef.current = tileOf(code)?.getBoundingClientRect().top ?? 0
    if (push) writeHistoryNav({ page: 'grades', ue: code })
    flushSync(() => setMorphCode(code))
    withViewTransition(() => {
      setExpandedCode(code)
      onFocusChange(true)
      if (module) {
        const key = `${code}:${module.code}`
        if (openSubject?.key !== key) openSubjectRow(key, module)
        setPendingFocus({ key, evaluationId })
      }
    }, () => scrollElementTo(document.getElementById(viewId), 12))
  }

  // A subject asked for from elsewhere on the page: a "Dernières notes"
  // grade (in the UE where it weighs most) or a "Compte pour" link of the
  // subjects list (in that UE).
  useEffect(() => {
    if (!openRequest) return
    const { evaluationId = null, moduleCode, ueCode = null } = openRequest
    const entries = uesByModule.get(moduleCode) ?? []
    const weightIn = (entry) => entry.module.evaluations
      .find(({ evaluation }) => String(evaluation.id) === String(evaluationId))?.weight ?? -1
    const target = ueCode
      ? entries.find((entry) => entry.code === ueCode)
      : [...entries].sort((left, right) => weightIn(right) - weightIn(left))[0]
    // Out of the effect: the view transition flushes React synchronously.
    if (target) queueMicrotask(() => expand(target.code, target.module, evaluationId))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest])

  // Back to the tiles, where they were in the window, the focus on the tile
  // it came from.
  const collapse = () => {
    const code = expandedCode
    withViewTransition(() => {
      closeSubject()
      setExpandedCode(null)
      onFocusChange(false)
    }, () => scrollElementTo(tileOf(code), tileTopRef.current)).then(() => {
      tileOf(code)?.querySelector('[data-ue-open]')?.focus({ preventScroll: true })
    })
  }

  // The same subject in another UE: that UE's view, on that subject (the
  // one shrinks back into its tile while the other grows).
  const jumpTo = (ueCode, moduleCode) => {
    const target = uesByModule.get(moduleCode)?.find((entry) => entry.code === ueCode)
    if (target) expand(ueCode, target.module)
  }

  // A tile opened by the student (its header or its news): the anonymous
  // analytics' ue_view_opened. Not the views opened by history, a jump from
  // another UE or a link elsewhere on the page.
  const openFromTile = (code, module = null) => {
    trackGradesAction('ue_view_opened')
    expand(code, module)
  }

  // "Toutes les UE" and Escape: a step back in history when the view has
  // its entry (so forward reopens it); popstate then closes it.
  const requestCollapse = () => {
    if (readHistoryNav().ue === expandedCode) window.history.back()
    else collapse()
  }

  // Back and forward on the grades page: the entry's UE, or the tiles. Read
  // through a ref so the listener sees the current view and subject.
  const handlePopStateRef = useRef(null)
  useEffect(() => {
    handlePopStateRef.current = (event) => {
      const { page, ue } = readHistoryNav(event.state)
      if (page !== 'grades' || ue === expandedCode) return
      if (ue && groups.some((group) => group.code === ue)) expand(ue, null, null, { push: false })
      else if (!ue && expandedCode) collapse()
    }
  })
  useEffect(() => {
    const handlePopState = (event) => handlePopStateRef.current?.(event)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Arriving on an entry with a UE open (reload, or back from another page):
  // that UE, straight away, once the relevé is there.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !groups.length) return
    restoredRef.current = true
    const { ue } = readHistoryNav()
    if (!ue || !groups.some((group) => group.code === ue)) return
    setMorphCode(ue)
    setExpandedCode(ue)
    onFocusChange(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // Escape inside the view closes it (a tooltip's Escape stays its own). On
  // the view, so the handler sees the current subject.
  const handleViewKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    requestCollapse()
  }

  if (expanded) {
    return (
      <UeFullView
        id={viewId}
        ue={expanded}
        headingId={headingId}
        backButtonRef={backButtonRef}
        onClose={requestCollapse}
        onKeyDown={handleViewKeyDown}
        hasNews={expanded.modules.some(hasUnread)}
      >
        {expanded.modules.map((module) => {
          const key = `${expanded.code}:${module.code}`
          return (
            <UeModuleRow
              key={key}
              rowId={rowId(key)}
              ueCode={expanded.code}
              module={module}
              isOpen={openSubject?.key === key}
              onToggle={() => openSubjectRow(key, module)}
              icon={subjectIcon(module.title)}
              showPromoStats={showPromoStats}
              newEvaluationIds={unreadIds}
              alsoIn={(uesByModule.get(module.code) ?? []).filter((entry) => entry.code !== expanded.code)}
              onJump={(otherUe) => jumpTo(otherUe, module.code)}
            />
          )
        })}
      </UeFullView>
    )
  }

  return (
    <div className="@container">
      <div className={COLUMNS_CLASSES}>
        {groups.map((ue) => {
          const color = paintUe(ue.color ?? '#341200')
          const newsModules = ue.modules.filter(hasUnread)
          const newsCount = new Set(newsModules.flatMap((module) => module.evaluations
            .map(({ evaluation }) => String(evaluation.id))
            .filter((id) => unreadIds.has(id)))).size
          return (
            <article
              key={ue.code}
              className={`${CARD_CLASSES} ue-vt-card flex flex-[1_1_320px] flex-col`}
              style={ue.code === morphCode ? morph('card', ue.code) : undefined}
              aria-labelledby={`${headingId}-${ue.code}`}
              aria-describedby={`${headingId}-${ue.code}-state`}
            >
              {/* News only: while the UE has grades marked "Nouveau", its colour
                  washes the top of the card (the "Dernières notes" wash, a
                  fixed height here); read, the card is plain again. */}
              {newsCount ? <span className="latest-grade-wash" style={{ background: color, height: '160px' }} aria-hidden="true" /> : null}
              {/* The whole header opens the view (the button is the keyboard's
                  way in; the warning keeps its own click). */}
              <header
                className="ue-card-header grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-[10px] corners-[16px] p-2 max-md:gap-x-[10px]"
                onClick={() => openFromTile(ue.code)}
              >
                {/* Figma's skeuomorphic UE ribbon (UeBadge); ribbon and average
                    on top, the title under them. */}
                <span className="ue-vt ue-ribbon-box col-start-1 row-start-1" style={ue.code === morphCode ? morph('ribbon', ue.code) : undefined}>
                  <UeBadge code={ue.code} color={color} />
                </span>
                <div className="col-span-4 row-start-2 grid min-w-0 gap-[5px]">
                  {/* Capped (~60 characters a line) and balanced, so a long title breaks
                      into two even lines instead of a full one and an orphan. */}
                  <h3 id={`${headingId}-${ue.code}`} className="ue-vt m-0 line-clamp-2 w-fit max-w-[34rem] text-balance font-body text-[16px] font-semibold leading-[1.25] text-text max-md:text-[15px]" style={ue.code === morphCode ? morph('title', ue.code) : undefined} title={ue.title}>{ue.title}</h3>
                  {ue.bonus != null || ue.malus != null || VALIDATION_TAGS[ue.validatedBy] ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-[6px]">
                      <UeCredits ue={ue} color={color} />
                      <UeValidationTag ue={ue} />
                      <UeAdjustments ue={ue} />
                    </div>
                  ) : <UeCredits ue={ue} color={color} />}
                </div>
                <UeAverage ue={ue} stateId={`${headingId}-${ue.code}-state`} style={{ ...(ue.code === morphCode ? morph('average', ue.code) : null), gridColumnStart: 3, gridRowStart: 1, justifySelf: 'end' }} />
                <button
                  type="button"
                  data-ue-open={ue.code}
                  aria-label={`Ouvrir ${ue.code} : ses matières et ses notes`}
                  className="ue-card-chevron col-start-4 row-start-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer"
                >
                  <Icon icon="carbon:maximize" className="size-4" aria-hidden="true" />
                </button>
              </header>
              {/* News: how many new grades and where, at the tile's foot; it opens
                  the view on the first subject with one. */}
              {newsCount ? (
                <div className="mt-auto">
                  <div className="mx-2 mb-1 h-px bg-border/70" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => openFromTile(ue.code, newsModules[0])}
                    className="ue-card-news flex w-full min-w-0 items-center gap-2 corners-[14px] border-0 bg-transparent px-2 py-[8px] text-left text-text-muted cursor-pointer"
                  >
                    <span className="shrink-0 rounded-full bg-brand px-[7px] py-[3px] font-body text-[11px] font-semibold leading-none text-bg">
                      {newsCount} {newsCount > 1 ? 'nouvelles notes' : 'nouvelle note'}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-body text-[13px] font-medium leading-none">{newsModules.map((module) => module.title).join(', ')}</span>
                    <Icon icon="carbon:arrow-right" className="size-[14px] shrink-0" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

// A UE over the whole page (its container: the sidebar stays), at least a
// window tall: its header, bigger, then its subjects in a reading-width
// column. The card is the tile's morph target.
function UeFullView({ id, ue, headingId, backButtonRef, onClose, onKeyDown, hasNews, children }) {
  const color = useUeColor()(ue.color ?? '#341200')
  const titleId = `${headingId}-${ue.code}-full`
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      aria-describedby={`${headingId}-${ue.code}-full-state`}
      onKeyDown={onKeyDown}
      className="ue-full-view ue-vt-card relative isolate min-h-[calc(100dvh-24px)] scroll-mt-3 overflow-clip corners-[28px] border border-white bg-widget-bg dark:border-white/[0.08] text-text shadow-md max-md:corners-[22px]"
      style={morph('card', ue.code)}
    >
      {hasNews ? <span className="latest-grade-wash" style={{ background: color, height: '240px' }} aria-hidden="true" /> : null}
      <div className="mx-auto w-full max-w-[820px] px-6 pb-10 pt-4 max-md:px-3 max-md:pt-3">
        {/* Stays in reach while the subjects scroll (the card clips with
            overflow: clip, not hidden, which would trap the sticky). */}
        <div className="pointer-events-none sticky top-3 z-20 -ml-1">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onClose}
            className="ue-full-close pointer-events-auto inline-flex items-center gap-[6px] rounded-full border border-border bg-widget-bg/85 py-[7px] pr-[13px] pl-[10px] text-text shadow-[0_6px_18px_-8px_rgb(52_18_0/0.25)] backdrop-blur-md cursor-pointer"
          >
            <Icon icon="carbon:arrow-left" className="size-4" aria-hidden="true" />
            <span className="font-body text-[13px] font-semibold leading-none">Toutes les UE</span>
          </button>
        </div>
        <header className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-2">
          <span className="ue-vt ue-ribbon-box col-start-1 row-start-1" style={morph('ribbon', ue.code)}>
            <UeBadge code={ue.code} color={color} />
          </span>
          <UeAverage ue={ue} large stateId={`${headingId}-${ue.code}-full-state`} style={{ ...morph('average', ue.code), gridColumnStart: 3, gridRowStart: 1, justifySelf: 'end' }} />
          <div className="col-span-3 row-start-2 grid min-w-0 gap-2">
            <h3 id={titleId} className="ue-vt m-0 w-fit max-w-[40rem] text-balance font-display text-[24px] font-semibold leading-[1.2] text-text max-md:text-[20px]" style={morph('title', ue.code)}>{ue.title}</h3>
            <UeFullMeta ue={ue} color={color} />
          </div>
        </header>
        {/* A hairline between the UE and its subjects, the sidebar's. */}
        <div className="mx-2 mt-5 mb-2 h-px bg-border/70" aria-hidden="true" />
        <ul className="@container m-0 grid list-none gap-[2px] p-0">
          {children}
        </ul>
      </div>
    </section>
  )
}

export default UeSubjectsList
