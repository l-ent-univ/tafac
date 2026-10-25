import { useId, useState } from 'react'
import { Icon } from '@iconify/react'
import { BUCKET_COUNT, countLabel, describeBucket, summarizeDistribution } from '../gradeDetail'

const BUCKETS = Array.from({ length: BUCKET_COUNT }, (_, index) => index)
const TICKS = new Set([0, 5, 10, 15, 20])
// The plot's height (px) and the room kept above the tallest bar for its
// count.
const BAR_ZONE = 104
const LABEL_ZONE = 20
// A soft bell for the loading bars: the shape of a histogram, not data.
const SKELETON = BUCKETS.map((index) => 0.14 + 0.78 * Math.exp(-((index - 12) ** 2) / 22))

function Frame({ children, className = '' }) {
  return (
    <div className={`relative ${className}`} style={{ height: BAR_ZONE + LABEL_ZONE }}>
      {children}
    </div>
  )
}

// Ticks every 5 under the bars; the student's bar gets its own, as a pill
// (the ticks too close to it step aside).
function Axis({ studentBucket = null }) {
  const isShown = (index) => TICKS.has(index) && (studentBucket == null || Math.abs(index - studentBucket) >= 2)
  return (
    <div className="gh-axis mt-[6px] grid h-[18px] items-center gap-[2px]" style={{ gridTemplateColumns: `repeat(${BUCKET_COUNT}, minmax(0, 1fr))` }} aria-hidden="true">
      {BUCKETS.map((index) => (
        <span key={index} className="flex min-w-0 justify-center">
          {index === studentBucket ? (
            <span className="gh-axis-you shrink-0 rounded-full bg-brand px-[6px] py-[3px] font-body text-[11px] font-bold leading-none tabular-nums text-bg">{index}</span>
          ) : isShown(index) ? (
            <span className="font-body text-[11px] font-medium leading-none tabular-nums text-text-muted">{index}</span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

// While the promo's grades load: the bars' place, breathing.
function HistogramSkeleton() {
  return (
    <Frame>
      <div className="absolute inset-x-0 bottom-0 grid items-end gap-[2px]" style={{ gridTemplateColumns: `repeat(${BUCKET_COUNT}, minmax(0, 1fr))`, height: BAR_ZONE }}>
        {SKELETON.map((ratio, index) => (
          <span key={index} className="gh-skeleton-bar block rounded-t-[4px]" style={{ height: `${ratio * 100}%`, '--i': index }} />
        ))}
      </div>
      <span className="gh-baseline absolute inset-x-0 bottom-0 h-px" />
    </Frame>
  )
}

function HistogramUnavailable({ status, reason, isPending, onRetry }) {
  const isError = status === 'error'
  // A grade still to come: the promo's usually is too.
  const notYet = isPending && !isError
  const tooFew = reason === 'too-few'
  return (
    <Frame className="grid place-items-center corners-[14px] border border-dashed border-border-input">
      <div className="grid max-w-[260px] justify-items-center gap-[6px] px-4 text-center">
        <Icon icon="carbon:chart-histogram" className="size-5 text-text-muted" aria-hidden="true" />
        <p className="m-0 font-body text-[14px] font-semibold leading-[1.3] text-text">{notYet ? 'Pas encore de répartition' : tooFew ? 'Pas assez de notes' : 'Répartition indisponible'}</p>
        <p className="m-0 font-body text-[13px] font-medium leading-[1.35] text-text-muted">
          {isError
            ? 'ScoDoc n’a pas répondu. Réessaie dans un instant.'
            : notYet
              ? 'Elle s’affichera une fois les notes saisies.'
              : tooFew
              ? 'Pas assez de notes pour afficher la répartition sans dévoiler celles des autres.'
              : 'ScoDoc ne partage pas la répartition des notes de cette évaluation.'}
        </p>
        {isError && onRetry ? (
          <button type="button" onClick={onRetry} className="gh-retry mt-1 inline-flex items-center gap-[5px] rounded-full border border-border bg-transparent px-3 py-[6px] text-text cursor-pointer">
            <Icon icon="carbon:renew" className="size-[14px]" aria-hidden="true" />
            <span className="font-body text-[13px] font-semibold leading-none">Réessayer</span>
          </button>
        ) : null}
      </div>
    </Frame>
  )
}

// The promo's grades for one evaluation as ScoDoc's passerelle draws them,
// one bar per point (0 to 20, the last bar 20 alone), recalmed: thin bars on
// a hairline, the student's bar in the ink colour (its tick a pill), counts
// over the bars, ticks every 5. Hover or keyboard (← →, from the student's
// bar) shows a bar's count and range; a hidden table says it all for screen
// readers. States: loading (skeleton), unavailable / error (a quiet notice,
// a retry for errors).
function GradeHistogram({ state, studentBucket = null, isPending = false, onRetry = null }) {
  const id = useId()
  const [active, setActive] = useState(null)
  const [fromKeyboard, setFromKeyboard] = useState(false)

  if (state.status === 'loading') return <HistogramSkeleton />
  if (state.status !== 'ok') return <HistogramUnavailable status={state.status} reason={state.reason} isPending={isPending} onRetry={onRetry} />

  const { counts, total } = state
  const max = Math.max(...counts)
  const summary = summarizeDistribution(counts, studentBucket)
  const hasStudent = summary.same != null

  const describe = (index) => {
    const range = describeBucket(index)
    const own = index === studentBucket ? ', dont toi' : ''
    return `${range.long} : ${countLabel(counts[index])}${own}`
  }

  const handlePointer = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const index = Math.floor(((event.clientX - box.left) / box.width) * BUCKET_COUNT)
    setFromKeyboard(false)
    setActive(Math.min(BUCKET_COUNT - 1, Math.max(0, index)))
  }

  const handleKeyDown = (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -BUCKET_COUNT, End: BUCKET_COUNT }
    if (!(event.key in moves)) return
    event.preventDefault()
    setFromKeyboard(true)
    setActive((current) => Math.min(BUCKET_COUNT - 1, Math.max(0, (current ?? studentBucket ?? summary.mode) + moves[event.key])))
  }

  const spokenSummary = [
    `${countLabel(total)} notés.`,
    `La tranche la plus fréquente : ${describeBucket(summary.mode).spoken}, ${countLabel(counts[summary.mode])}.`,
    hasStudent ? `Ta note est dans la tranche ${describeBucket(studentBucket).spoken}, avec ${countLabel(summary.same)} toi compris ; ${summary.below} en dessous, ${summary.above} au-dessus.` : null,
  ].filter(Boolean).join(' ')

  return (
    <div className="grid gap-3">
      <div>
        {/* The plot: one tab stop, the arrows walk the bars. */}
        <div
          className="gh-plot relative corners-[10px] outline-none"
          role="group"
          tabIndex={0}
          aria-label="Histogramme des notes de la promo. Flèches gauche et droite pour parcourir les tranches."
          aria-describedby={`${id}-summary`}
          onPointerMove={handlePointer}
          onPointerLeave={() => setActive(null)}
          onFocus={() => {
            setFromKeyboard(true)
            setActive(studentBucket ?? summary.mode)
          }}
          onBlur={() => setActive(null)}
          onKeyDown={handleKeyDown}
        >
          <Frame>
            <div className="absolute inset-x-0 bottom-0 grid h-full items-end gap-[2px]" style={{ gridTemplateColumns: `repeat(${BUCKET_COUNT}, minmax(0, 1fr))` }} aria-hidden="true">
              {BUCKETS.map((index) => {
                const count = counts[index]
                const isStudent = index === studentBucket
                const height = count ? Math.max(3, (count / max) * BAR_ZONE) : 0
                return (
                  <div key={index} className={`gh-col relative flex h-full min-w-0 flex-col items-center justify-end ${active === index ? 'is-active' : ''}`} style={{ '--i': index }}>
                    {count ? (
                      <span className={`gh-count mb-[3px] font-body text-[10.5px] leading-none tabular-nums ${isStudent ? 'font-bold text-text' : 'font-semibold text-text-muted'}`}>{count}</span>
                    ) : null}
                    <span className={`gh-bar block w-full max-w-[24px] rounded-t-[4px] ${isStudent ? 'gh-bar--you' : ''}`} style={{ height }} />
                  </div>
                )
              })}
            </div>
            <span className="gh-baseline absolute inset-x-0 bottom-0 h-px" aria-hidden="true" />
            {active != null ? (
              <div
                className="gh-tooltip pointer-events-none absolute z-10 grid gap-[3px] whitespace-nowrap corners-[10px] px-[10px] py-[7px]"
                style={{
                  left: `clamp(64px, ${((active + 0.5) / BUCKET_COUNT) * 100}%, calc(100% - 64px))`,
                  bottom: (counts[active] / max) * BAR_ZONE + 22,
                }}
                aria-hidden="true"
              >
                <span className="font-display text-[14px] font-bold leading-none">{countLabel(counts[active])}{active === studentBucket ? ', dont toi' : ''}</span>
                <span className="font-body text-[12px] font-medium leading-none opacity-75">{describeBucket(active).long}</span>
              </div>
            ) : null}
          </Frame>
          <Axis studentBucket={hasStudent ? studentBucket : null} />
        </div>
        <p className="sr-only" aria-live="polite">{fromKeyboard && active != null ? describe(active) : ''}</p>
      </div>
      {/* Exact, from whole bars: how many sit under, with and over the student. */}
      {hasStudent ? (
        <div className="grid grid-cols-3 divide-x divide-border" aria-hidden="true">
          {[
            [summary.below, 'en dessous'],
            [summary.same, 'dans ta tranche'],
            [summary.above, 'au-dessus'],
          ].map(([count, label]) => (
            <span key={label} className="grid justify-items-center gap-[5px] px-1 text-center">
              <span className="font-display text-[16px] font-bold leading-none tabular-nums text-text">{count}</span>
              <span className="font-body text-[12px] font-medium leading-none text-text-muted">{label}</span>
            </span>
          ))}
        </div>
      ) : null}
      <p id={`${id}-summary`} className="sr-only">{spokenSummary}</p>
      <table className="sr-only">
        <caption>Nombre d’étudiants par tranche de notes</caption>
        <thead>
          <tr><th scope="col">Notes</th><th scope="col">Étudiants</th></tr>
        </thead>
        <tbody>
          {BUCKETS.filter((index) => counts[index] > 0).map((index) => (
            <tr key={index}>
              <th scope="row">{describeBucket(index).long}{index === studentBucket ? ' (ta note)' : ''}</th>
              <td>{counts[index]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default GradeHistogram
