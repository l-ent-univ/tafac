import { useEffect } from 'react'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { publishBriefingSource } from '../briefingSources'
import { formatClock, formatCountdown } from '../transitClock'
import { TRANSIT_NAME } from '../transitApi'
import { pickNextTrip } from '../transitDay'
import { useDayBuses, useMinuteClock } from '../useDayBuses'
import { LineBadge } from './TransitUi'

// « Bus » card: the next bus that matters, to the next class or home after
// the last one, with its line and when to leave; the whole card opens the
// page. Also hands that bus to the greeting briefing (briefingSources.bus).

const CARD_CLASSES = 'transit-card-widget widget-card shadow-md relative flex h-[140px] w-full flex-[1_1_360px] min-w-0 flex-col gap-[6px] overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-left text-text cursor-pointer transition-colors duration-150 hover:bg-row-hover max-2xl:flex-[1_1_calc(50%-6px)] max-md:h-[124px] max-md:rounded-[20px] max-md:p-3 max-xs:flex-[1_1_100%]'

function dayLabel(dayKey) {
  const day = new Date(`${dayKey}T12:00:00`)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (day.toDateString() === today.toDateString()) return ''
  if (day.toDateString() === tomorrow.toDateString()) return 'Demain · '
  const label = day.toLocaleDateString('fr-FR', { weekday: 'long' })
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} · `
}

export default function WidgetTransit({ visible = true, establishment = null, selection = null, sessionUser = '' }) {
  const buses = useDayBuses({ establishment, selection, sessionUser })
  const now = useMinuteClock()
  const next = buses.status === 'ok' ? pickNextTrip(buses.plans, now) : null

  useEffect(() => {
    publishBriefingSource('bus', next?.journey ? { kind: next.kind, dayKey: next.plan.dayKey, leaveAt: next.journey.leaveAt, departAt: next.journey.legs[0].departAt, line: next.journey.legs[0].line } : null)
  }, [next?.journey, next?.kind, next?.plan.dayKey])
  useEffect(() => () => publishBriefingSource('bus', null), [])

  let content
  if (buses.status === 'no-home') {
    content = (
      <>
        <p className="m-0 font-body text-[15px] font-semibold leading-snug text-text">Choisis ton arrêt</p>
        <p className="m-0 line-clamp-2 font-body text-[13px] font-medium leading-snug text-text-muted">Pour savoir quel bus prendre avant chaque cours.</p>
      </>
    )
  } else if (buses.status === 'loading') {
    content = <p className="m-0 font-body text-[14px] font-medium text-text-muted">Calcul des trajets…</p>
  } else if (buses.status === 'error') {
    content = <p className="m-0 font-body text-[14px] font-medium text-text-muted">Trajets indisponibles pour le moment.</p>
  } else if (!next) {
    content = <p className="m-0 font-body text-[14px] font-medium text-text-muted">Pas de cours dans les prochains jours.</p>
  } else if (!next.journey) {
    content = (
      <>
        <p className="m-0 font-body text-[12px] font-semibold uppercase tracking-[0.04em] text-error">{dayLabel(next.plan.dayKey)}Dernier bus</p>
        <p className="m-0 line-clamp-2 font-body text-[15px] font-semibold leading-snug text-text">
          Cours jusqu’à {formatClock(next.plan.last.end)}, dernier bus à {formatClock(next.plan.lastBus.legs[0].departAt)}
        </p>
      </>
    )
  } else {
    const leg = next.journey.legs[0]
    content = (
      <>
        <p className="m-0 font-body text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          {dayLabel(next.plan.dayKey)}{next.kind === 'to' ? `Cours à ${formatClock(next.plan.first.start)}` : 'Retour'}
        </p>
        <p className="m-0 flex min-w-0 items-center gap-2 font-body text-[15px] font-semibold leading-snug text-text">
          <LineBadge line={leg.line} color={leg.color} textColor={leg.textColor} size="sm" />
          {next.journey.legs[1] ? <LineBadge line={next.journey.legs[1].line} color={next.journey.legs[1].color} textColor={next.journey.legs[1].textColor} size="sm" /> : null}
          <span className="truncate">
            {next.kind === 'to' ? `Pars à ${formatClock(next.journey.leaveAt)}` : `Bus à ${formatClock(leg.departAt)}`}
          </span>
          {dayLabel(next.plan.dayKey) ? null : (
            <span className="ml-auto shrink-0 font-body text-[13px] font-medium text-text-muted">{formatCountdown(next.kind === 'to' ? next.journey.leaveAt : leg.departAt, now)}</span>
          )}
        </p>
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navigateTo('bus')}
      className={`${CARD_CLASSES} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Bus ${TRANSIT_NAME}, ouvrir les trajets`}
    >
      <span className="flex min-w-0 items-center gap-[5px] text-text-muted">
        <Icon icon="carbon:bus" className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-body text-base font-medium leading-[1.06] max-md:text-[14px]">Bus {TRANSIT_NAME}</span>
        {buses.realtime ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 font-body text-[12px] font-semibold text-accent-text">
            <span className="transit-live-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
            En direct
          </span>
        ) : null}
      </span>
      <div className="mt-auto grid gap-1.5">{content}</div>
    </button>
  )
}
