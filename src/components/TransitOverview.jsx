import { Icon } from '@iconify/react'
import { formatClock } from '../transitClock'
import ProgressRing from './ProgressRing'
import { JourneyStrip, LineBadge } from './TransitUi'

// The top of « Bus », in the frame of « Mes notes »' overview: the next
// departure as its hero card (washed in the line's colour, the journey as
// a strip down to the class), the minutes left as a ring, and the coming
// days as cards to pick from, like « Dernières notes ».

const HERO_CLASSES = 'widget-card widget-card-visible shadow-md relative isolate flex w-full max-w-[443px] min-h-[188px] min-w-0 flex-col gap-2 overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-text dark:border-border max-md:max-w-none max-md:min-h-[160px] max-md:flex-[1_0_clamp(260px,78%,360px)] max-md:snap-start max-md:p-3 max-md:rounded-[20px]'
const SQUARE_CLASSES = 'widget-card widget-card-visible shadow-md relative flex size-[188px] shrink-0 flex-col gap-[6px] overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-text dark:border-border max-md:h-auto max-md:min-h-[160px] max-md:w-auto max-md:flex-[1_0_clamp(136px,40%,170px)] max-md:snap-start max-md:p-3 max-md:rounded-[20px]'

function dayName(dayKey, now, { short = false } = {}) {
  const day = new Date(`${dayKey}T12:00:00`)
  const today = new Date(now)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (day.toDateString() === today.toDateString()) return 'Aujourd’hui'
  if (day.toDateString() === tomorrow.toDateString()) return 'Demain'
  const label = day.toLocaleDateString('fr-FR', short ? { weekday: 'short', day: 'numeric' } : { weekday: 'long', day: 'numeric' }).replace('.', '')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// `next`: pickNextTrip()'s answer (src/transitDay.js).
export function BusHeroCard({ next, now, campusLabel }) {
  if (!next) {
    return (
      <article className={HERO_CLASSES}>
        <span className="font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Prochain départ</span>
        <p className="m-0 mt-auto font-display text-[26px] font-bold leading-tight">Pas de cours en vue</p>
        <p className="m-0 font-body text-[14px] font-medium text-text-muted">Les bus apparaîtront avec ton planning.</p>
      </article>
    )
  }

  if (!next.journey) {
    const lastBus = next.plan.lastBus.legs[0]
    return (
      <article className={HERO_CLASSES}>
        <span className="latest-grade-wash bg-error" aria-hidden="true" />
        <span className="flex items-center gap-[5px] font-body text-base font-medium leading-[1.06] text-error max-md:text-[14px]">
          <Icon icon="carbon:warning-alt" className="size-4" aria-hidden="true" />
          {dayName(next.plan.dayKey, now)} · Dernier bus
        </span>
        <p className="m-0 mt-auto font-display text-[40px] font-bold leading-none tracking-[-0.02em] max-md:text-[32px]">{formatClock(lastBus.departAt)}</p>
        <p className="m-0 font-body text-[14px] font-medium leading-snug text-text-secondary">
          Ton cours finit à {formatClock(next.plan.last.end)} : le dernier bus sera déjà parti. Prévois un autre moyen de rentrer.
        </p>
      </article>
    )
  }

  const { journey, kind, plan } = next
  const leg = journey.legs[0]
  const isTo = kind === 'to'
  return (
    <article className={HERO_CLASSES}>
      <span className="latest-grade-wash" style={{ background: leg.color }} aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-[5px] font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">
        <Icon icon={isTo ? 'carbon:bus' : 'carbon:home'} className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{isTo ? 'Prochain départ' : 'Retour'} · {dayName(plan.dayKey, now)}</span>
      </span>
      <div className="mt-auto flex items-end gap-3">
        <span className="font-display text-[44px] font-bold leading-none tracking-[-0.02em] max-md:text-[36px]">{formatClock(isTo ? journey.leaveAt : leg.departAt)}</span>
        <span className="flex gap-1 pb-1">
          {journey.legs.map((entry, index) => <LineBadge key={`${entry.tripId}-${index}`} line={entry.line} color={entry.color} textColor={entry.textColor} />)}
        </span>
      </div>
      <p className="m-0 truncate font-body text-[14px] font-medium leading-snug text-text-secondary">
        {isTo
          ? `Pour ${plan.first.title || 'ton cours'} à ${formatClock(plan.first.start)}`
          : `Depuis ${campusLabel}, chez toi vers ${formatClock(journey.arriveAt)}`}
      </p>
      <JourneyStrip journey={journey} endAt={isTo ? plan.first.start : null} endLabel={isTo ? 'Cours' : null} />
    </article>
  )
}

// Within the hour before leaving, the minutes left as a ring emptying;
// otherwise the week's days with classes the buses cover both ways, as
// « UE validées » counts its UEs.
export function BusRingCard({ next, plans, now }) {
  const leg = next?.journey?.legs[0] ?? null
  const leaveAt = leg ? (next.kind === 'to' ? next.journey.leaveAt : leg.departAt) : null
  const minutes = leaveAt != null ? Math.max(0, Math.round((leaveAt - now) / 60_000)) : null

  if (minutes != null && minutes <= 60) {
    return (
      <article className={SQUARE_CLASSES} aria-label={`Pars dans ${minutes} minutes`}>
        <span className="font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Pars dans</span>
        <div className="flex flex-1 items-center justify-center">
          <ProgressRing value={minutes / 60} color={leg.color} label="" className="size-[120px] max-md:size-[104px]">
            <span className="font-display text-[37px] font-bold leading-none max-md:text-[32px]">{minutes}</span>
            <span className="text-[15px] font-medium leading-none text-text-muted">min</span>
          </ProgressRing>
        </div>
      </article>
    )
  }

  if (!plans.length) return null
  const covered = plans.filter((plan) => (plan.to === null || plan.to.length) && plan.from?.length).length
  return (
    <article className={SQUARE_CLASSES} aria-label={`${covered} jours sur ${plans.length} avec un bus à l’aller et au retour`}>
      <span className="font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Jours couverts</span>
      <div className="flex flex-1 items-center justify-center">
        <ProgressRing value={covered / plans.length} color={covered === plans.length ? '#3CB53A' : '#F2A600'} label="" className="size-[120px] max-md:size-[104px]">
          <span className="font-display text-[37px] font-bold leading-none max-md:text-[32px]">{covered}</span>
          <span className="text-[19px] font-medium leading-[1.06] max-md:text-[17px]">/{plans.length}</span>
        </ProgressRing>
      </div>
    </article>
  )
}

// The coming days with classes as cards: the morning bus, the one home,
// and a red alert when the last class ends after the last bus.
export function DayCards({ plans, selectedDayKey, onSelect, now }) {
  return (
    <ul className="m-0 -mx-6 -mt-2 -mb-7 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-6 pt-2 pb-7 scroll-px-6 favorites-scroll-hide max-md:-mx-3 max-md:gap-2 max-md:px-3 max-md:scroll-px-3">
      {plans.map((plan) => {
        const to = plan.to?.[0] ?? null
        const from = plan.from?.[0] ?? null
        const noReturn = plan.lastBus && plan.from?.length === 0
        const selected = plan.dayKey === selectedDayKey
        const wash = noReturn ? 'var(--color-error)' : (to ?? from)?.legs[0].color
        return (
          <li key={plan.dayKey} className="flex w-[210px] shrink-0 snap-start max-md:w-[188px]">
            <button
              type="button"
              onClick={() => onSelect(plan.dayKey)}
              aria-pressed={selected}
              className={`widget-card widget-card-visible shadow-md relative isolate flex w-full min-w-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-[22px] border bg-widget-bg p-4 text-left text-text transition-[box-shadow,transform] duration-150 active:scale-[0.98] max-md:rounded-[20px] max-md:p-3 ${selected ? 'border-text ring-1 ring-text' : 'border-white dark:border-border'}`}
            >
              {wash ? <span className="latest-grade-wash" style={{ background: wash }} aria-hidden="true" /> : null}
              <span className="flex items-center gap-[6px]">
                <span className="truncate font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]">{dayName(plan.dayKey, now, { short: true })}</span>
                <span className="ml-auto shrink-0 font-body text-[13px] font-medium text-text-muted">{formatClock(plan.first.start)}–{formatClock(plan.last.end)}</span>
              </span>
              <span className="grid gap-1">
                <DayRow icon="carbon:arrow-up-right" label="Aller" journey={to} time={to?.leaveAt} missing={plan.to ? 'Pas de bus' : null} />
                <DayRow
                  icon="carbon:arrow-down-left"
                  label="Retour"
                  journey={from}
                  time={from?.legs[0].departAt}
                  missing={noReturn ? `Dernier ${formatClock(plan.lastBus.legs[0].departAt)}` : plan.from ? 'Pas de bus' : null}
                  alert={noReturn}
                />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function DayRow({ icon, label, journey, time, missing, alert = false }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className={`size-4 shrink-0 ${alert ? 'text-error' : 'text-text-muted'}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      {journey ? (
        <>
          <span className="font-display text-[22px] font-bold leading-none tabular-nums">{formatClock(time)}</span>
          <span className="ml-auto flex gap-1">
            {journey.legs.map((leg, index) => <LineBadge key={`${leg.tripId}-${index}`} line={leg.line} color={leg.color} textColor={leg.textColor} size="sm" />)}
          </span>
        </>
      ) : (
        <span className={`font-body text-[14px] font-semibold ${alert ? 'text-error' : 'text-text-muted'}`}>{missing ?? '—'}</span>
      )}
    </span>
  )
}
