import { Icon } from '@iconify/react'
import { pickInkOn } from '../colorContrast'
import { formatClock, formatCountdown, stopName } from '../transitApi'
import { PAGE_CARD } from './AppPage'

// Pieces of the « Bus » views: a line's badge in the network's colours, a
// journey (walk, buses, change) and a departure row.

export function LineBadge({ line, color, textColor = null, size = 'md' }) {
  const ink = textColor ?? pickInkOn(color)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[8px] font-display font-bold leading-none ${size === 'sm' ? 'h-[22px] min-w-[22px] px-1.5 text-[13px]' : 'h-7 min-w-7 px-2 text-[15px]'}`}
      style={{ backgroundColor: color, color: ink }}
      aria-label={`Ligne ${line}`}
    >
      {line}
    </span>
  )
}

// "+3 min" / "à l'heure", live.
export function DelayTag({ leg }) {
  if (!leg.realtime) return null
  const late = leg.delayMin >= 2
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-[3px] font-body text-[11px] font-semibold leading-none ${late ? 'bg-[#fdecea] text-[#b42318] dark:bg-[#3a1512] dark:text-[#ff9a8f]' : 'bg-[#e3f5e1] text-[#2f7a2b] dark:bg-[#183a17] dark:text-[#8fd88a]'}`}>
      <span className="transit-live-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
      {late ? `+${leg.delayMin} min` : 'À l’heure'}
    </span>
  )
}

// A journey as one bar along time, each part as wide as it lasts: the walk
// (dotted), each bus in its line's colour with its line and minutes, the
// wait of a change (hatched), the walk at the end, then the time to spare
// before `endAt` (the class) and the class itself in `endColor`.
export function JourneyStrip({ journey, endAt = null, endLabel = null, endColor = null }) {
  const parts = []
  const add = (kind, from, to, extra = {}) => {
    const minutes = Math.round((to - from) / 60_000)
    if (minutes > 0) parts.push({ kind, minutes, ...extra })
  }
  add('walk', journey.leaveAt, journey.legs[0].departAt)
  journey.legs.forEach((leg, index) => {
    if (index > 0) add('wait', journey.legs[index - 1].arriveAt, leg.departAt)
    add('bus', leg.departAt, leg.arriveAt, { leg })
  })
  add('walk', journey.legs.at(-1).arriveAt, journey.arriveAt)
  if (endAt != null) add('spare', journey.arriveAt, endAt)
  const end = endAt ?? journey.arriveAt
  const spare = parts.find((part) => part.kind === 'spare')

  return (
    <div className="grid gap-1.5">
      <div className="flex h-[30px] items-stretch gap-[3px]" role="img" aria-label={`Départ ${formatClock(journey.leaveAt)}, ${journey.legs.map((leg) => `bus ${leg.line} ${Math.round((leg.arriveAt - leg.departAt) / 60_000)} min`).join(', ')}${spare ? `, ${spare.minutes} min d’avance` : ''}`}>
        {parts.map((part, index) => (
          <span
            key={`${part.kind}-${index}`}
            className={`journey-strip-part is-${part.kind} flex min-w-[10px] items-center justify-center overflow-hidden rounded-[8px] font-body text-[12px] font-bold leading-none`}
            style={{
              flexGrow: Math.max(part.minutes, 2),
              flexBasis: 0,
              ...(part.leg ? { backgroundColor: part.leg.color, color: part.leg.textColor ?? pickInkOn(part.leg.color) } : {}),
            }}
            title={part.kind === 'bus' ? `Ligne ${part.leg.line} · ${part.minutes} min` : part.kind === 'walk' ? `${part.minutes} min à pied` : part.kind === 'wait' ? `${part.minutes} min de correspondance` : `${part.minutes} min d’avance`}
          >
            {part.kind === 'bus' ? <span className="truncate px-1">{part.leg.line}{part.minutes >= 6 ? <span className="font-semibold opacity-80"> · {part.minutes}′</span> : null}</span> : null}
            {part.kind === 'walk' && part.minutes >= 4 ? <Icon icon="carbon:pedestrian" className="size-3.5 opacity-70" aria-hidden="true" /> : null}
            {part.kind === 'spare' && part.minutes >= 4 ? <span className="truncate px-1">+{part.minutes}′</span> : null}
          </span>
        ))}
        {endLabel ? (
          <span className={`flex shrink-0 items-center rounded-[8px] px-2 font-body text-[12px] font-bold leading-none ${endColor ? 'text-white' : 'bg-brand text-bg'}`} style={endColor ? { background: endColor } : undefined}>
            {endLabel}
          </span>
        ) : null}
      </div>
      <div className="flex justify-between font-body text-[12px] font-semibold tabular-nums text-text-muted">
        <span>{formatClock(journey.leaveAt)}</span>
        {spare ? <span className="text-[#2f7a2b] dark:text-[#8fd88a]">{spare.minutes} min d’avance</span> : null}
        <span>{formatClock(end)}</span>
      </div>
    </div>
  )
}

// One journey: when to leave, each bus with its stops and times, the
// change, the walk at both ends.
// `endAt` / `endLabel` / `endColor`: the class the journey leads to,
// closing its strip. The first bus's colour washes the card's top.
export function JourneyCard({ journey, network, title = null, detail = null, compact = false, endAt = null, endLabel = null, endColor = null }) {
  return (
    <article className={`${PAGE_CARD} relative isolate grid gap-3 overflow-hidden p-4 max-md:p-3`}>
      <span className="latest-grade-wash" style={{ background: journey.legs[0].color }} aria-hidden="true" />
      {title ? (
        <header className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="m-0 font-body text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted">{title}</p>
            <p className="m-0 font-display text-[26px] font-bold leading-none tracking-[-0.01em] text-text">
              Pars à {formatClock(journey.leaveAt)}
            </p>
            {detail ? <p className="m-0 font-body text-[13px] font-medium leading-snug text-text-secondary">{detail}</p> : null}
          </div>
          {new Date(journey.leaveAt).toDateString() === new Date().toDateString() ? (
            <span className="shrink-0 rounded-full bg-bg-subtle px-2.5 py-1 font-body text-[12px] font-semibold text-text-muted">
              {formatCountdown(journey.leaveAt)}
            </span>
          ) : null}
        </header>
      ) : null}
      <JourneyStrip journey={journey} endAt={endAt} endLabel={endLabel} endColor={endColor} />
      <ol className="m-0 grid list-none gap-0 p-0">
        {journey.walkToStopMin > 0 && !compact ? (
          <li className="flex items-center gap-2.5 py-1.5 font-body text-[13px] font-medium text-text-muted">
            <Icon icon="carbon:pedestrian" className="size-4 shrink-0" aria-hidden="true" />
            {journey.walkToStopMin} min à pied jusqu’à {stopName(network, journey.legs[0].fromStopId)}
          </li>
        ) : null}
        {journey.legs.map((leg, index) => (
          <li key={`${leg.tripId}-${index}`} className="grid gap-1.5 py-1.5">
            {index > 0 ? (
              <p className="m-0 flex items-center gap-2.5 pb-1 font-body text-[13px] font-medium text-text-muted">
                <Icon icon="carbon:arrows-horizontal" className="size-4 shrink-0" aria-hidden="true" />
                Changement · {Math.max(0, Math.round((leg.departAt - journey.legs[index - 1].arriveAt) / 60_000))} min d’attente
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2.5">
              <LineBadge line={leg.line} color={leg.color} textColor={leg.textColor} />
              <span className="min-w-0 flex-1 truncate font-body text-[14px] font-semibold text-text">vers {leg.headsign || stopName(network, leg.toStopId)}</span>
              <DelayTag leg={leg} />
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 pl-[38px] font-body text-[13px] leading-snug">
              <span className="font-semibold tabular-nums text-text">{formatClock(leg.departAt)}</span>
              <span className="truncate font-medium text-text-secondary">{stopName(network, leg.fromStopId)}</span>
              <span className="font-semibold tabular-nums text-text">{formatClock(leg.arriveAt)}</span>
              <span className="truncate font-medium text-text-secondary">{stopName(network, leg.toStopId)} · {leg.stops} arrêt{leg.stops > 1 ? 's' : ''}</span>
            </div>
          </li>
        ))}
        {journey.walkFromStopMin > 0 && !compact ? (
          <li className="flex items-center gap-2.5 py-1.5 font-body text-[13px] font-medium text-text-muted">
            <Icon icon="carbon:pedestrian" className="size-4 shrink-0" aria-hidden="true" />
            {journey.walkFromStopMin} min à pied · arrivée {formatClock(journey.arriveAt)}
          </li>
        ) : null}
      </ol>
    </article>
  )
}

// A row of the departures board: the line, where it goes, and the minutes
// left set big as on a bus stop's screen (the time past the hour). The
// first one leads, washed in its line's colour.
export function DepartureRow({ departure, now, first = false }) {
  const minutes = Math.max(0, Math.round((departure.departAt - now) / 60_000))
  const soon = minutes < 60
  return (
    <li className={`relative isolate flex min-w-0 items-center gap-3 overflow-hidden px-4 max-md:px-3 ${first ? 'py-4' : 'py-2.5'}`}>
      {first ? <span className="latest-grade-wash" style={{ background: departure.color }} aria-hidden="true" /> : null}
      <LineBadge line={departure.line} color={departure.color} textColor={departure.textColor} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={`truncate font-body font-semibold text-text ${first ? 'text-[15px]' : 'text-[14px]'}`}>{departure.headsign}</span>
        <span className="flex items-center gap-1.5">
          <DelayTag leg={departure} />
          {soon ? <span className="font-body text-[12px] font-medium tabular-nums text-text-muted">{formatClock(departure.departAt)}</span> : null}
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1 tabular-nums" aria-label={formatCountdown(departure.departAt, now)}>
        {soon ? (
          minutes === 0 ? (
            <span className="font-display text-[20px] font-bold leading-none text-text">Imminent</span>
          ) : (
            <>
              <span className={`font-display font-bold leading-none text-text ${first ? 'text-[34px]' : 'text-[24px]'}`}>{minutes}</span>
              <span className="font-body text-[13px] font-semibold text-text-muted">min</span>
            </>
          )
        ) : (
          <span className="font-display text-[20px] font-bold leading-none text-text">{formatClock(departure.departAt)}</span>
        )}
      </span>
    </li>
  )
}
