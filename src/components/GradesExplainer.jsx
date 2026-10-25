import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { trackGradesAction } from '../analytics'
import { formatScore, formatUeCode } from '../gradesSubjects'
import { NewBadge, ScorePill, ScoreText } from './SubjectsList'
import UeBadge from './UeBadge'
import { useUeColor } from '../useUeColor'
import CloseButton from './CloseButton'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const PASS_MARK = 10

// Without a relevé to borrow from (or UEs without a ScoDoc colour), the
// schemas run on BUT-looking example UEs.
const FALLBACK_UES = [
  { code: 'UE1.1', title: 'Comprendre', color: '#b80004', ects: { total: 10 } },
  { code: 'UE1.2', title: 'Concevoir', color: '#f97b3d', ects: { total: 10 } },
  { code: 'UE1.3', title: 'Développer', color: '#feb40b', ects: { total: 10 } },
]

// The student's own UEs (codes, colours, titles, credits) when there are at
// least two with a colour: the schemas then look like their page. Grades in
// the schemas stay examples.
function pickUes(ues) {
  const usable = (ues ?? []).filter((ue) => ue?.code && ue.color)
  return usable.length >= 2 ? usable : FALLBACK_UES
}

// "UE5.2" → 5: the semester the subjects' codes follow (R5.01…).
function readSemesterNumber(code) {
  const match = /^UE\s*(\d+)\.(\d+)/i.exec(String(code))
  return match ? Number(match[1]) : null
}

// The UE of the same level in the year's other semester: UE5.2 ↔ UE6.2.
// Null when the code doesn't follow BUT's numbering.
function siblingUeCode(code) {
  const match = /^UE\s*(\d+)\.(\d+)$/i.exec(String(code))
  if (!match) return null
  const semester = Number(match[1])
  return `UE${semester % 2 ? semester + 1 : semester - 1}.${match[2]}`
}

function weightedAverage(links) {
  const weight = links.reduce((sum, link) => sum + link.coef, 0)
  return links.reduce((sum, link) => sum + link.grade * link.coef, 0) / weight
}

// The example every schema shares: three subjects feeding two UEs, one of
// them counting in both. The second UE lands under 10 (8.5), the one the
// compensation step picks up.
function buildExample(ues) {
  const semester = readSemesterNumber(ues[0].code) ?? 1
  const subjects = [
    { code: `R${semester}.01`, kind: 'Ressource', grade: 14, links: [{ ue: 0, coef: 3 }] },
    { code: `R${semester}.02`, kind: 'Ressource', grade: 8, links: [{ ue: 0, coef: 1 }, { ue: 1, coef: 2 }] },
    { code: `SAÉ ${semester}.01`, kind: 'SAÉ', grade: 9, links: [{ ue: 1, coef: 2 }] },
  ]
  const averages = [0, 1].map((index) => weightedAverage(subjects.flatMap((subject) => subject.links
    .filter((link) => link.ue === index)
    .map((link) => ({ grade: subject.grade, coef: link.coef })))))
  return { subjects, averages }
}

// ── Step 1: the UEs ────────────────────────────────────────────────────────

function UesFigure({ ues }) {
  const shown = ues.slice(0, 6)
  return (
    <div className="flex w-[340px] flex-col items-center gap-4">
      <ul className="m-0 grid w-full list-none grid-cols-3 gap-x-2 gap-y-4 p-0">
        {shown.map((ue, index) => (
          <li key={ue.code} className="flex min-w-0 flex-col items-center gap-[6px] text-center">
            <span className="gx-drop" style={{ '--d': `${index * 110}ms` }}>
              <UeBadge code={ue.code} color={ue.color} className="h-auto w-[92px]" />
            </span>
            <span className="gx-rise line-clamp-2 font-body text-[12px] font-semibold leading-[1.25] text-text" style={{ '--d': `${250 + index * 110}ms` }}>{ue.title}</span>
            {ue.ects?.total != null ? (
              <span className="gx-rise inline-flex items-center gap-[5px] font-body text-[11px] font-medium leading-none text-text-muted" style={{ '--d': `${330 + index * 110}ms` }}>
                <span className="gx-coin" style={{ background: ue.color }} />
                {ue.ects.total} ECTS
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <span className="gx-pop inline-flex items-center gap-[6px] rounded-full bg-widget-bg py-[7px] pr-3 pl-[9px] shadow-sm gx-card" style={{ '--d': `${450 + shown.length * 110}ms` }}>
        <Icon icon="carbon:checkmark-filled" className="gx-success size-4" aria-hidden="true" />
        <span className="font-body text-[13px] font-semibold leading-none text-text">Validée dès 10/20</span>
      </span>
    </div>
  )
}

function describeUes(ues) {
  return `Tes UE : ${ues.slice(0, 6).map((ue) => `${formatUeCode(ue.code)}, ${ue.title}${ue.ects?.total != null ? `, ${ue.ects.total} ECTS` : ''}`).join(' ; ')}. Chacune est validée dès 10 sur 20.`
}

// ── Step 2: subjects feed UEs ──────────────────────────────────────────────

// Fixed geometry (px), so the lines meet the chips and the UE cards.
const FLOW = {
  width: 340,
  height: 236,
  chipRight: 134,
  chipTops: [14, 94, 174],
  chipHeight: 48,
  ueLeft: 222,
  ueTops: [10, 136],
  ueEntry: [56, 182],
}

function Gauge({ value, color, delay }) {
  return (
    <span className="relative block h-[6px] w-full rounded-full bg-bg-muted">
      <span className="gx-fill-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${(value / 20) * 100}%`, background: color, '--d': `${delay}ms` }} />
      {/* The 10/20 line the average has to reach. */}
      <span className="absolute -top-[4px] -bottom-[4px] left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-text" />
    </span>
  )
}

function FlowFigure({ ues, example }) {
  const { subjects, averages } = example
  // Each UE's incoming lines spread a little apart on its card's edge.
  const incoming = [0, 1].map((index) => subjects.flatMap((subject, row) => subject.links.filter((link) => link.ue === index).map(() => row)))
  const links = subjects.flatMap((subject, row) => subject.links.map((link) => {
    const rows = incoming[link.ue]
    const spread = rows.length > 1 ? (rows.indexOf(row) - (rows.length - 1) / 2) * 20 : 0
    const y1 = FLOW.chipTops[row] + FLOW.chipHeight / 2
    const y2 = FLOW.ueEntry[link.ue] + spread
    const mid = (FLOW.chipRight + FLOW.ueLeft) / 2
    return { key: `${row}-${link.ue}`, ue: link.ue, coef: link.coef, y1, y2, mid, d: `M${FLOW.chipRight} ${y1}C${mid} ${y1} ${mid} ${y2} ${FLOW.ueLeft} ${y2}` }
  }))

  return (
    <div className="relative" style={{ width: FLOW.width, height: FLOW.height }}>
      <svg className="absolute inset-0 overflow-visible" width={FLOW.width} height={FLOW.height} aria-hidden="true">
        {links.map((link, index) => (
          <g key={link.key}>
            <path className="gx-draw" d={link.d} pathLength="1" fill="none" stroke={ues[link.ue].color} strokeOpacity="0.72" strokeWidth={link.coef * 2.2} strokeLinecap="round" style={{ '--d': `${450 + index * 130}ms` }} />
            <path className="gx-flow" d={link.d} pathLength="1" fill="none" strokeWidth={Math.max(link.coef * 2.2 - 2.4, 1.6)} strokeLinecap="round" style={{ '--d': `${1300 + index * 200}ms` }} />
          </g>
        ))}
      </svg>
      {links.map((link, index) => (
        <span
          key={link.key}
          className="gx-pop gx-card absolute inline-flex h-[18px] -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-widget-bg px-[6px] font-body text-[11px] font-semibold leading-none text-text shadow-sm"
          style={{ left: link.mid, top: (link.y1 + link.y2) / 2, '--d': `${950 + index * 130}ms` }}
        >
          coef {link.coef}
        </span>
      ))}
      {subjects.map((subject, row) => (
        <div
          key={subject.code}
          className="gx-rise gx-card absolute left-0 flex items-center justify-between gap-2 corners-[14px] bg-widget-bg py-[6px] pr-[6px] pl-[10px] shadow-sm"
          style={{ top: FLOW.chipTops[row], width: FLOW.chipRight, height: FLOW.chipHeight, '--d': `${row * 90}ms` }}
        >
          <span className="grid min-w-0 gap-[2px]">
            <span className="truncate font-body text-[13px] font-semibold leading-[1.2] text-text">{subject.code}</span>
            <span className="truncate font-body text-[11px] font-medium leading-[1.2] text-text-muted">{subject.kind}</span>
          </span>
          <ScorePill value={subject.grade} size="sm" />
        </div>
      ))}
      {[0, 1].map((index) => {
        const average = averages[index]
        return (
          <div
            key={ues[index].code}
            className="gx-rise gx-card absolute grid gap-[6px] corners-[16px] bg-widget-bg px-[10px] pt-[8px] pb-[11px] shadow-sm"
            style={{ left: FLOW.ueLeft, top: FLOW.ueTops[index], width: FLOW.width - FLOW.ueLeft, '--d': `${200 + index * 90}ms` }}
          >
            <UeBadge code={ues[index].code} color={ues[index].color} className="-ml-[6px] h-auto w-[78px]" />
            <span className="flex items-end gap-[3px]">
              <span className="gx-fade font-display text-[22px] font-bold leading-none text-text" style={{ '--d': '1900ms' }}>{formatScore(average)}</span>
              <span className="gx-fade pb-[1px] font-body text-[12px] font-medium leading-none text-text-muted" style={{ '--d': '1900ms' }}>/20</span>
              {average < PASS_MARK ? <Icon icon="carbon:warning-alt-filled" className="gx-pop ue-below-warning mb-[2px] ml-[2px] size-[15px]" style={{ '--d': '2500ms' }} aria-hidden="true" /> : null}
            </span>
            <Gauge value={average} color={ues[index].color} delay={1500 + index * 150} />
          </div>
        )
      })}
    </div>
  )
}

function describeFlow(ues, example) {
  const { subjects, averages } = example
  const parts = subjects.map((subject) => `${subject.code} (${formatScore(subject.grade)}/20) compte dans ${subject.links.map((link) => `${formatUeCode(ues[link.ue].code)} avec un coefficient ${link.coef}`).join(' et ')}`)
  return `Exemple : ${parts.join(' ; ')}. Moyenne de ${formatUeCode(ues[0].code)} : ${formatScore(averages[0])}/20, validée. Moyenne de ${formatUeCode(ues[1].code)} : ${formatScore(averages[1])}/20, sous 10.`
}

// ── Step 3: under 10, compensation ─────────────────────────────────────────

// Rows on a 0–20 track, the 10 line across them: the same reading as the
// UE cards' gauges in the previous step.
const TRACK = { left: 84, width: 180, rowTops: [26, 76, 138], rowHeight: 34 }

function CompensationFigure({ ue, average }) {
  const sibling = siblingUeCode(ue.code)
  const semester = readSemesterNumber(ue.code)
  const other = 12
  const year = (average + other) / 2
  // The odd semester first, as in the year.
  const pair = [
    { label: semester != null ? `S${semester}` : 'Ce semestre', code: formatUeCode(ue.code), value: average },
    { label: semester != null ? `S${semester % 2 ? semester + 1 : semester - 1}` : 'Autre semestre', code: sibling ? formatUeCode(sibling) : 'même niveau', value: other },
  ]
  if (semester != null && semester % 2 === 0) pair.reverse()
  const rows = [...pair, { label: 'L’année', code: 'moyenne', value: year, isYear: true }]
  const delays = [200, 1000, 2100]
  const lineX = TRACK.left + TRACK.width / 2
  const bottom = TRACK.rowTops[2] + TRACK.rowHeight

  return (
    <div className="relative" style={{ width: 340, height: 214 }}>
      {rows.map((row, index) => {
        const top = TRACK.rowTops[index]
        return (
          <div key={row.label} className="gx-rise absolute inset-x-0" style={{ top, height: TRACK.rowHeight, '--d': `${delays[index] - 150}ms` }}>
            <span className="absolute left-0 grid gap-[4px]" style={{ top: 2 }}>
              <span className="font-body text-[13px] font-semibold leading-none text-text">{row.label}</span>
              <span className="inline-flex items-center gap-[4px] font-body text-[11px] font-medium leading-none text-text-muted">
                {!row.isYear ? <span className="size-[7px] rounded-full" style={{ background: ue.color }} /> : null}
                {row.code}
              </span>
            </span>
            <span className="absolute h-[14px] overflow-hidden rounded-full bg-bg-muted" style={{ left: TRACK.left, width: TRACK.width, top: 9 }}>
              <span
                className="gx-fill-x absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(row.value / 20) * 100}%`, background: ue.color, opacity: row.isYear ? 1 : 0.6, '--d': `${delays[index]}ms`, '--dur': row.isYear ? '1100ms' : '800ms' }}
              />
            </span>
            <span className="gx-fade absolute right-0 inline-flex items-center gap-[3px]" style={{ top: 8, '--d': `${delays[index] + (row.isYear ? 900 : 600)}ms` }}>
              <span className={`font-display font-bold leading-none text-text ${row.isYear ? 'text-[18px]' : 'text-[16px]'}`}>{formatScore(row.value)}</span>
              {row.value < PASS_MARK ? <Icon icon="carbon:warning-alt-filled" className="gx-pop ue-below-warning size-[14px]" style={{ '--d': `${delays[index] + 800}ms` }} aria-hidden="true" /> : null}
              {row.isYear ? <Icon icon="carbon:checkmark-filled" className="gx-pop gx-success size-[15px]" style={{ '--d': '3300ms' }} aria-hidden="true" /> : null}
            </span>
          </div>
        )
      })}
      {/* The year's row under a rule: what the two above make together. */}
      <span className="absolute h-px bg-border" style={{ left: 0, right: 0, top: TRACK.rowTops[2] - 14 }} />
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width="340" height="214" aria-hidden="true">
        <line x1={lineX} x2={lineX} y1="14" y2={bottom - 4} stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
      <span className="absolute -translate-x-1/2 font-body text-[11px] font-semibold leading-none text-text" style={{ left: lineX, top: 0 }}>10</span>
      <span className="gx-rise absolute inset-x-0 bottom-0 text-center font-body text-[12px] font-medium leading-none text-text-muted" style={{ '--d': '3400ms' }}>
        ({formatScore(pair[0].value)} + {formatScore(pair[1].value)}) ÷ 2 = <span className="font-semibold text-text">{formatScore(year)}</span> : validée par compensation
      </span>
    </div>
  )
}

function describeCompensation(ue, average) {
  const sibling = siblingUeCode(ue.code)
  return `Exemple : ${formatUeCode(ue.code)} à ${formatScore(average)}/20, sous 10. ${sibling ? formatUeCode(sibling) : 'L’UE du même niveau'}, à l’autre semestre de l’année, à 12/20. Leur moyenne, ${formatScore((average + 12) / 2)}/20, atteint 10 : l’UE est validée par compensation.`
}

// ── Step 4: credits ────────────────────────────────────────────────────────

const ECTS_EXAMPLE = [12.5, 8.5, 14]

function EctsFigure({ ues }) {
  const rows = ues.slice(0, 3).map((ue, index) => ({ ue, average: ECTS_EXAMPLE[index] }))
  const hasCredits = rows.every((row) => row.ue.ects?.total != null)
  const creditsOf = (row) => (hasCredits ? row.ue.ects.total : 1)
  const total = rows.reduce((sum, row) => sum + creditsOf(row), 0)
  const earned = rows.filter((row) => row.average >= PASS_MARK).reduce((sum, row) => sum + creditsOf(row), 0)
  let fillIndex = 0

  return (
    <div className="grid w-[340px] gap-[14px]">
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((row, index) => {
          const isValidated = row.average >= PASS_MARK
          return (
            <li key={row.ue.code} className="gx-rise gx-card flex items-center gap-[10px] corners-[14px] bg-widget-bg py-[8px] pr-[8px] pl-[12px] shadow-sm" style={{ '--d': `${index * 100}ms` }}>
              <span className="size-[10px] shrink-0 rounded-full" style={{ background: row.ue.color }} />
              <span className="font-body text-[13px] font-semibold leading-none text-text">{formatUeCode(row.ue.code)}</span>
              <span className="inline-flex items-end gap-[2px]">
                <span className="font-display text-[16px] font-bold leading-none text-text">{formatScore(row.average)}</span>
                <span className="font-body text-[11px] font-medium leading-none text-text-muted">/20</span>
              </span>
              {!isValidated ? <Icon icon="carbon:warning-alt-filled" className="ue-below-warning size-[14px]" aria-hidden="true" /> : null}
              <span
                className={`gx-pop ml-auto inline-flex items-center gap-[5px] rounded-full px-[8px] py-[5px] ${isValidated ? 'bg-bg-subtle' : 'border border-dashed border-border-input'}`}
                style={{ '--d': `${550 + index * 150}ms` }}
              >
                {isValidated ? <span className="gx-coin" style={{ background: row.ue.color }} /> : null}
                <span className={`font-body text-[11px] font-semibold leading-none ${isValidated ? 'text-text' : 'text-text-muted'}`}>
                  {isValidated ? (hasCredits ? `+${row.ue.ects.total} ECTS` : 'Crédits acquis') : 'Pas encore'}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="grid gap-2 px-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-body text-[12px] font-semibold leading-none text-text-muted">Crédits du semestre</span>
          {hasCredits ? (
            <span className="gx-fade inline-flex items-end gap-[3px]" style={{ '--d': '1900ms' }}>
              <span className="font-display text-[18px] font-bold leading-none text-text">{earned}</span>
              <span className="font-body text-[12px] font-medium leading-none text-text-muted">/{total} ECTS</span>
            </span>
          ) : null}
        </span>
        <span className="flex h-[12px] gap-[3px]">
          {rows.map((row) => {
            const isValidated = row.average >= PASS_MARK
            const delay = 1100 + (isValidated ? fillIndex++ : 0) * 350
            return (
              <span key={row.ue.code} className={`relative h-full overflow-hidden rounded-full ${isValidated ? 'bg-bg-muted' : 'border border-dashed border-border-input'}`} style={{ flex: creditsOf(row) }}>
                {isValidated ? <span className="gx-fill-x absolute inset-0 rounded-full" style={{ background: row.ue.color, '--d': `${delay}ms` }} /> : null}
              </span>
            )
          })}
        </span>
      </div>
    </div>
  )
}

function describeEcts(ues) {
  return `Exemple : ${ues.slice(0, 3).map((ue, index) => `${formatUeCode(ue.code)} à ${formatScore(ECTS_EXAMPLE[index])}/20, ${ECTS_EXAMPLE[index] >= PASS_MARK ? 'ses crédits sont acquis' : 'pas encore de crédits'}`).join(' ; ')}.`
}

// ── Step 5: the page ───────────────────────────────────────────────────────

// A numbered spot on the mock-up; the list under it uses the same numbers.
// The spots light up in turn (`--i`), the matching line with them.
function Spot({ index, className = '', children }) {
  return (
    <span className={`gx-spot relative inline-flex shrink-0 ${className}`} style={{ '--i': index - 1 }}>
      {children}
      <span className="gx-spot-number" aria-hidden="true">{index}</span>
    </span>
  )
}

function PageFigure({ ues, example }) {
  const [ue, otherUe] = ues
  const shared = example.subjects[1]
  const newsTitles = example.subjects.slice(0, 2).map((subject) => subject.code).join(', ')

  return (
    <div className="grid w-[340px] gap-[10px]">
      <div className="gx-card relative isolate grid gap-[6px] overflow-hidden corners-[18px] bg-widget-bg p-2 shadow-sm">
        <span className="latest-grade-wash" style={{ background: ue.color, height: '110px' }} />
        <span className="flex items-center gap-2 px-1 pt-1">
          <UeBadge code={ue.code} color={ue.color} className="h-auto w-[78px]" />
          <span className="ml-auto inline-flex items-end gap-[2px]">
            <span className="font-display text-[22px] font-bold leading-none text-text">{formatScore(example.averages[0])}</span>
            <span className="font-body text-[12px] font-medium leading-none text-text-muted">/20</span>
          </span>
          <Spot index={1} className="size-7 items-center justify-center rounded-full text-text-muted">
            <Icon icon="carbon:maximize" className="size-[15px]" aria-hidden="true" />
          </Spot>
        </span>
        <span className="truncate px-1 font-body text-[14px] font-semibold leading-[1.25] text-text">{ue.title}</span>
        <span className="mx-1 h-px bg-border" />
        <span className="flex min-w-0 items-center gap-2 px-1 pb-[2px]">
          <Spot index={2} className="mr-[8px]">
            <span className="shrink-0 rounded-full bg-brand px-[7px] py-[3px] font-body text-[11px] font-semibold leading-none text-bg">2 nouvelles notes</span>
          </Spot>
          <span className="min-w-0 flex-1 truncate font-body text-[12px] font-medium leading-none text-text-muted">{newsTitles}</span>
          <Icon icon="carbon:arrow-right" className="size-[13px] shrink-0 text-text-muted" aria-hidden="true" />
        </span>
      </div>
      <div className="gx-card grid gap-[8px] corners-[18px] bg-widget-bg p-[10px] shadow-sm">
        <span className="flex items-center gap-[10px]">
          <span className="inline-flex size-8 shrink-0 items-center justify-center corners-[10px] border border-border bg-bg-subtle">
            <Icon icon="carbon:book" className="size-4 text-text-secondary" aria-hidden="true" />
          </span>
          <span className="grid min-w-0 flex-1 gap-[3px]">
            <span className="flex items-center gap-[6px]">
              <span className="font-body text-[14px] font-semibold leading-[1.2] text-text">{shared.code}</span>
              <Spot index={3} className="mr-[8px]"><NewBadge /></Spot>
            </span>
            <span className="font-body text-[12px] font-medium leading-[1.2] text-text-muted">{shared.kind} · coef {shared.links[0].coef}</span>
          </span>
          <ScoreText value={shared.grade} />
        </span>
        <span className="flex flex-wrap items-center gap-[6px] border-t border-border pt-[8px]">
          <span className="font-body text-[12px] font-medium leading-none text-text-muted">Compte aussi dans</span>
          <Spot index={4}>
            <span className="inline-flex items-center gap-[5px] rounded-full border border-border px-[8px] py-[4px]">
              <span className="size-2 rounded-full" style={{ background: otherUe.color }} />
              <span className="font-body text-[11px] font-semibold leading-none text-text">
                {formatUeCode(otherUe.code)}
                <span className="font-medium text-text-muted"> · {formatScore(example.averages[1])}/20</span>
              </span>
            </span>
          </Spot>
        </span>
      </div>
    </div>
  )
}

const PAGE_TIPS = [
  <>Touche une UE pour l’ouvrir en grand, avec toutes ses matières.</>,
  <><strong className="font-semibold text-text">« x nouvelles notes »</strong> sur une UE : les matières qui ont du nouveau.</>,
  <><strong className="font-semibold text-text">« Nouveau »</strong> : une note que tu n’as pas encore lue. Le badge s’efface une fois la matière ouverte.</>,
  <><strong className="font-semibold text-text">« Compte aussi dans »</strong> t’emmène à la même matière dans l’autre UE.</>,
]

// ── Steps ──────────────────────────────────────────────────────────────────

function buildSteps(ues, example) {
  const [first, second] = ues
  return [
    {
      title: 'En BUT, ce sont les UE qui se valident',
      figure: <UesFigure ues={ues} />,
      label: describeUes(ues),
      isExample: false,
      body: (
        <p className="m-0">
          Une UE (unité d’enseignement), c’est une compétence de ton BUT. Chacune a sa couleur et rapporte des crédits ECTS. Elle est validée quand sa moyenne atteint 10/20.
        </p>
      ),
    },
    {
      title: 'Tes matières nourrissent tes UE',
      figure: <FlowFigure ues={ues} example={example} />,
      label: describeFlow(ues, example),
      isExample: true,
      body: (
        <>
          <p className="m-0">
            Chaque matière (ressource « R… » ou SAÉ) compte dans une ou plusieurs UE, avec un coefficient : plus le trait est épais, plus elle pèse. La moyenne d’une UE, c’est la moyenne de ses matières pondérée par ces coefficients (la valeur officielle vient de ScoDoc).
          </p>
          <p className="m-0">
            Une matière peut compter dans deux UE avec des poids différents, comme {example.subjects[1].code} ici : elle apparaît alors dans les deux.
          </p>
        </>
      ),
    },
    {
      title: 'Sous 10, rien n’est encore joué',
      figure: <CompensationFigure ue={second} average={example.averages[1]} />,
      label: describeCompensation(second, example.averages[1]),
      isExample: true,
      body: (
        <p className="m-0">
          L’icône <Icon icon="carbon:warning-alt-filled" className="ue-below-warning inline size-[15px] align-[-0.15em]" aria-label="attention" /> à côté d’une moyenne d’UE veut dire qu’elle n’est pas validée pour l’instant. Tant que le jury n’a pas statué, elle peut encore l’être par compensation : si sa moyenne avec l’UE du même niveau de l’autre semestre de l’année atteint 10. Une fois le jury passé, s’il ne l’a pas validée, son code (AJ, RAT, ATT…) s’affiche en rouge à la place : touche-le pour savoir ce qu’il veut dire.
        </p>
      ),
    },
    {
      title: 'Les crédits, UE par UE',
      figure: <EctsFigure ues={ues} />,
      label: describeEcts(ues),
      isExample: true,
      body: (
        <>
          <p className="m-0">
            Chaque UE validée te rapporte ses crédits ECTS. La moyenne générale est indicative : en BUT, ce sont les moyennes d’UE qui comptent.
          </p>
          <p className="m-0">
            Dans « Matières et SAÉ », chaque matière a sa propre moyenne (tes notes pondérées par leur coefficient) : indicative elle aussi.
          </p>
        </>
      ),
    },
    {
      title: 'Sur cette page',
      figure: <PageFigure ues={[first, second]} example={example} />,
      label: `Une UE en carte, avec sa moyenne et la mention 2 nouvelles notes, puis une matière marquée Nouveau qui compte aussi dans ${formatUeCode(second.code)}. Les numéros renvoient à la liste qui suit.`,
      isExample: true,
      body: (
        <ol className="gx-tips m-0 grid list-none gap-[2px] p-0">
          {PAGE_TIPS.map((tip, index) => (
            <li key={index} className="gx-tip flex items-start gap-[10px] corners-[12px] px-2 py-[7px]" style={{ '--i': index }}>
              <span className="gx-tip-number" aria-hidden="true">{index + 1}</span>
              <span>{tip}</span>
            </li>
          ))}
        </ol>
      ),
    },
  ]
}

// ── Dialog ─────────────────────────────────────────────────────────────────

function ExplainerDialog({ ues, onClose }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [replay, setReplay] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const dialogRef = useRef(null)
  const bodyRef = useRef(null)
  const previousRef = useRef(null)
  const nextRef = useRef(null)
  const titleId = useId()
  const stepTitleId = useId()
  // The UEs' colours as the page paints them (lifted on the dark theme).
  const paintUe = useUeColor()
  const pickedUes = pickUes(ues).map((ue) => ({ ...ue, color: paintUe(ue.color) }))
  const steps = buildSteps(pickedUes, buildExample(pickedUes))
  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  const goTo = (index) => {
    const next = Math.min(steps.length - 1, Math.max(0, index))
    if (next === stepIndex) return
    // "Précédent" disappears on the first step: focus moves on to "Suivant".
    if (next === 0 && document.activeElement === previousRef.current) nextRef.current?.focus()
    setStepIndex(next)
    setReplay(0)
    setAnnouncement(`Étape ${next + 1} sur ${steps.length} : ${steps[next].title}`)
    bodyRef.current?.scrollTo?.({ top: 0 })
  }

  // Focus in, page scroll locked; focus back on the opener when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus()
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'

    return () => {
      root.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [])

  // Escape, ←/→ and Tab kept inside, wherever focus is (on the window, as
  // the changelog sheet does). The listener reads the latest handler from a
  // ref, so it isn't re-added on every step.
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      goTo(stepIndex + (event.key === 'ArrowRight' ? 1 : -1))
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
    <div className="gx-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gx-dialog relative flex h-[min(700px,calc(100dvh-40px))] w-[min(560px,100%)] flex-col overflow-hidden corners-[22px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none animate-modal-card-in max-sm:h-[calc(100dvh-12px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-3 px-6 pt-[21px] pb-3 max-sm:px-4 max-sm:pt-[18px]">
          <div className="grid min-w-0 gap-[6px]">
            <h2 id={titleId} className="m-0 text-[22px] font-bold leading-[1.1]">Comment lire tes notes</h2>
            <p className="m-0 font-body text-[13px] font-medium leading-none text-text-muted">Étape {stepIndex + 1} sur {steps.length}</p>
          </div>
          <CloseButton onClick={onClose} />
        </header>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-5 max-sm:px-4">
          <div className="grid gap-4" aria-labelledby={stepTitleId} role="group">
            {/* The stage stays (so does focus on « Rejouer »); its figure is
                keyed by step and replay: remounting restarts the animations. */}
            <div className="gx-stage relative flex min-h-[276px] items-center justify-center overflow-hidden corners-[20px] border border-border px-2 pt-9 pb-6">
              <div key={`${stepIndex}-${replay}`} className="gx-step gx-figure" role="img" aria-label={step.label}>
                {step.figure}
              </div>
              {step.isExample ? (
                <span className="absolute top-[11px] left-3 rounded-full border border-border px-[8px] py-[4px] font-body text-[11px] font-semibold leading-none text-text-muted" aria-hidden="true">Exemple</span>
              ) : null}
              <button
                type="button"
                className="gx-replay absolute top-2 right-2 inline-flex size-[30px] items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted transition-colors duration-150 hover:bg-bg-subtle hover:text-text"
                onClick={() => setReplay((count) => count + 1)}
                aria-label="Rejouer l’animation"
              >
                <Icon icon="carbon:renew" className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div key={stepIndex} className="gx-step grid gap-2 px-1">
              <h3 id={stepTitleId} className="m-0 text-[19px] font-bold leading-[1.2]">{step.title}</h3>
              <div className="grid gap-2 font-body text-[15px] font-medium leading-[1.45] text-text-secondary">
                {step.body}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 max-sm:px-4 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            ref={previousRef}
            type="button"
            className={`inline-flex min-h-[40px] items-center gap-[6px] rounded-full border border-border bg-transparent px-[14px] text-text transition-colors duration-150 hover:bg-bg-subtle ${stepIndex === 0 ? 'invisible' : ''}`}
            onClick={() => goTo(stepIndex - 1)}
            disabled={stepIndex === 0}
          >
            <Icon icon="carbon:arrow-left" className="size-4" aria-hidden="true" />
            <span className="font-body text-[14px] font-semibold leading-none max-xs:sr-only">Précédent</span>
          </button>
          <div className="flex items-center">
            {steps.map((entry, index) => (
              <button
                key={entry.title}
                type="button"
                className="gx-dot inline-flex size-6 items-center justify-center rounded-full border-0 bg-transparent p-0"
                onClick={() => goTo(index)}
                aria-label={`Étape ${index + 1} : ${entry.title}`}
                aria-current={index === stepIndex ? 'step' : undefined}
              >
                <span className={`block h-[7px] rounded-full transition-[width,background-color] duration-200 ${index === stepIndex ? 'w-[18px] bg-text' : 'w-[7px] bg-text-30'}`} />
              </button>
            ))}
          </div>
          <button
            ref={nextRef}
            type="button"
            className="inline-flex min-h-[40px] items-center gap-[6px] rounded-full border-0 bg-brand px-4 text-bg transition-colors duration-150 hover:bg-brand-hover"
            onClick={() => (isLast ? onClose() : goTo(stepIndex + 1))}
          >
            <span className="font-body text-[14px] font-semibold leading-none">{isLast ? 'Compris' : 'Suivant'}</span>
            {!isLast ? <Icon icon="carbon:arrow-right" className="size-4" aria-hidden="true" /> : null}
          </button>
        </footer>
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </section>
    </div>,
    document.body,
  )
}

// "Comment ça marche ?" next to the UE section's title: opens a short,
// illustrated walk through how BUT grades work and how to read this page.
// `ues`: the semester's UEs (report.ues), to draw the schemas in their codes
// and colours.
function GradesExplainer({ ues = [] }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="ml-auto inline-flex shrink-0 items-center gap-[5px] rounded-full border border-border bg-transparent py-[6px] pr-[11px] pl-[8px] text-text-muted transition-colors duration-150 hover:bg-bg-subtle hover:text-text max-md:relative max-md:min-h-8 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-[7px]"
        aria-haspopup="dialog"
        onClick={() => {
          trackGradesAction('explainer_opened')
          setIsOpen(true)
        }}
      >
        <Icon icon="carbon:help" className="size-[15px]" aria-hidden="true" />
        {/* Shorter on phones, so the section title stays on one line; its
            touch area reaches 44px there (::after). */}
        <span className="font-body text-[13px] font-semibold leading-none max-xs:hidden">Comment ça marche ?</span>
        <span className="hidden font-body text-[13px] font-semibold leading-none max-xs:inline">Aide</span>
      </button>
      {isOpen ? <ExplainerDialog ues={ues} onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

export default GradesExplainer
