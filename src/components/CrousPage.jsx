import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { CROUS_MEAL_PRICE, describeClosures, fetchCrous, getStoredCrousRestaurant, hasMenu, pickMenuDay, readOpeningHours, sectionIcon, setStoredCrousRestaurant, todayKey } from '../crousApi'
import { findLunchBreak, formatDuration, formatMinutes, parseServiceWindow, serviceStatus } from '../crousPause'
import { accentColor, accentStyle } from '../eventAccents'
import { APP_NAME } from '../seo'
import { useMinuteClock } from '../useDayBuses'
import { useUpcomingClasses } from '../useUpcomingClasses'
import { AppPage, INLINE_BUTTON, PAGE_CARD, PageButton, PageSection, StatCard, StatRow } from './AppPage'
import Dropdown from './Dropdown'
import { GradesNotice } from './GradesNotice'
import LoadingDots from './LoadingDots'
import ProgressRing from './ProgressRing'
import { StatusMessage } from './ScodocUi'

// « Menu du RU »: the CROUS's menus for the coming days, in the frame of
// « Mes notes ». The restaurant is picked next to the title and remembered
// (by default the establishment's). On top, the service live (open, opening
// at, over) along its hours, with the student's lunch break that day, read
// from the timetable, laid over it; then the days as cards (their hot dish
// as preview), and the menu, filterable to the vegetarian dishes.

function formatDay(date, { long = false } = {}) {
  const day = new Date(`${date}T12:00:00`)
  const label = day.toLocaleDateString('fr-FR', long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1).replace('.', '')
}

function dayChipLabel(date) {
  return date === todayKey() ? 'Aujourd’hui' : formatDay(date)
}

// A section's colour (eventAccents), as a UE's on Mes notes: green for the
// starters, orange for the mains, pink for the desserts.
function sectionAccent(title) {
  const text = String(title ?? '').toLowerCase()
  if (/entr|hors/.test(text)) return 6
  if (/dessert|fromage/.test(text)) return 7
  if (/pizza|grill|snack|sandwich|burger/.test(text)) return 1
  if (/accomp|légume|legume|féculent|feculent/.test(text)) return 4
  if (/plat/.test(text)) return 8
  return 0
}

// "Tartine aux légumes VG": the dish, and a « Végé » badge.
function readDish(item) {
  const match = String(item).match(/^(.*?)\s+(?:VG|végé|vegan|végétarien)\.?\s*$/i)
  return match ? { name: match[1], veggie: true } : { name: item, veggie: false }
}

// The day's hot dish (its "Plats" section, else the first), for previews.
function mainSection(day) {
  const meal = day?.meals.find((entry) => entry.sections.length) ?? null
  return meal?.sections.find((entry) => /plat|chaud/i.test(entry.title)) ?? meal?.sections[0] ?? null
}

// A course's icon on a tile tinted with its colour, as the subjects'
// icons on Mes notes.
function MenuTile({ title }) {
  return (
    <span className="menu-tile inline-flex size-8 shrink-0 items-center justify-center rounded-[10px]" style={accentStyle(sectionAccent(title))} aria-hidden="true">
      <Icon icon={sectionIcon(title)} className="size-[17px]" />
    </span>
  )
}

function DishName({ item, className = '' }) {
  const dish = readDish(item)
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 [overflow-wrap:anywhere] ${className}`}>
      <span>{dish.name}</span>
      {dish.veggie ? <Icon icon="ph:leaf-fill" className="size-[0.9em] shrink-0 translate-y-[0.1em] text-[#3CB53A]" aria-label="Végé" title="Végétarien" /> : null}
    </span>
  )
}

// One meal as a single card, like a restaurant's menu: the hot dishes on
// top, the first one set big, then the other courses side by side (one
// under the other on a phone), parted by hairlines.
function MealCard({ meal }) {
  const main = meal.sections.find((section) => /plat|chaud/i.test(section.title)) ?? meal.sections[0]
  const others = meal.sections.filter((section) => section !== main)
  return (
    <article className={`${PAGE_CARD} overflow-hidden`}>
      <div className="grid gap-3 p-5 max-md:p-4">
        <h3 className="m-0 flex items-center gap-2.5 font-body text-[13px] font-semibold uppercase tracking-[0.05em] text-text-muted">
          <MenuTile title={main.title} />
          {main.title}
        </h3>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {main.items.map((item, index) => (
            <li key={`${item}-${index}`} className="min-w-0">
              <DishName
                item={item}
                className={index === 0
                  ? 'font-display text-[26px] font-bold leading-[1.15] tracking-[-0.01em] text-text max-md:text-[22px]'
                  : 'font-body text-[16px] font-semibold leading-snug text-text-secondary'}
              />
            </li>
          ))}
        </ul>
      </div>
      {others.length ? (
        <div className="flex border-t border-border max-md:flex-col">
          {others.map((section) => (
            <section key={section.title} className="grid min-w-0 flex-1 content-start gap-2.5 p-5 md:border-l md:border-border md:first:border-l-0 max-md:border-t max-md:border-border max-md:p-4 max-md:first:border-t-0">
              <h4 className="m-0 flex items-center gap-2.5 font-body text-[13px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                <MenuTile title={section.title} />
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
              </h4>
              <ul className="m-0 grid list-none gap-1 p-0">
                {section.items.map((item, index) => (
                  <li key={`${item}-${index}`} className="min-w-0 font-body text-[15px] font-medium leading-snug text-text">
                    <DishName item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </article>
  )
}

const HERO_CLASSES = 'widget-card widget-card-visible shadow-md relative isolate flex w-full max-w-[443px] min-h-[188px] min-w-0 flex-col gap-2 overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-text dark:border-border max-md:max-w-none max-md:min-h-[160px] max-md:flex-[1_0_clamp(260px,78%,360px)] max-md:snap-start max-md:p-3 max-md:rounded-[20px]'
const SQUARE_CLASSES = 'widget-card widget-card-visible shadow-md relative flex size-[188px] shrink-0 flex-col gap-[6px] overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-text dark:border-border max-md:h-auto max-md:min-h-[160px] max-md:w-auto max-md:flex-[1_0_clamp(136px,40%,170px)] max-md:snap-start max-md:p-3 max-md:rounded-[20px]'
const OPEN_GREEN = '#3CB53A'

// The service on a bar from opening to closing: the student's break laid
// over it (hatched, in the brand colour) and, today, a cursor at the time.
function ServiceBar({ window, lunch, nowMinute }) {
  const span = window.close - window.open
  const at = (minute) => `${Math.min(100, Math.max(0, ((minute - window.open) / span) * 100))}%`
  const showNow = nowMinute != null && nowMinute >= window.open - 30 && nowMinute <= window.close + 30
  return (
    <div className="grid gap-1.5">
      <div className="relative h-[30px] overflow-hidden rounded-[9px] bg-[#e3f5e1] dark:bg-[#183a17]" role="img" aria-label={`Service de ${formatMinutes(window.open)} à ${formatMinutes(window.close)}${lunch ? `, ta pause de ${formatMinutes(lunch.start)} à ${formatMinutes(lunch.end)}` : ''}`}>
        {lunch ? (
          <span className="ru-lunch-band absolute inset-y-0 flex items-center justify-center overflow-hidden font-body text-[12px] font-bold text-bg" style={{ left: at(lunch.start), right: `calc(100% - ${at(lunch.end)})` }}>
            <span className="truncate px-1">{lunch.start <= window.open && lunch.end >= window.close ? 'Libre tout le service' : 'Ta pause'}</span>
          </span>
        ) : null}
        {showNow ? <span className="absolute inset-y-[-2px] w-[3px] -translate-x-1/2 rounded-full bg-text shadow-[0_0_0_2px_var(--color-widget-bg)]" style={{ left: at(nowMinute) }} aria-hidden="true" /> : null}
      </div>
      <div className="flex justify-between font-body text-[12px] font-semibold tabular-nums text-text-muted">
        <span>{formatMinutes(window.open)}</span>
        {lunch ? <span className="text-text">{formatMinutes(lunch.start)}–{formatMinutes(lunch.end)}</span> : null}
        <span>{formatMinutes(window.close)}</span>
      </div>
    </div>
  )
}

// The live card: open now / opens at / over / closed, the hours as a bar,
// the student's break on it, the price in the corner.
function RuLiveCard({ restaurant, window, status, lunch, isToday, dayLabel, nowMinute }) {
  const tone = status.state === 'open' ? OPEN_GREEN : status.state === 'soon' ? '#F2A600' : null
  let headline
  if (!isToday) headline = dayLabel
  else if (status.state === 'open') headline = `Ouvert · ferme dans ${formatDuration(status.minutesLeft)}`
  else if (status.state === 'soon') headline = `Ouvre dans ${formatDuration(status.minutesLeft)}`
  else if (status.state === 'over') headline = 'Service terminé pour aujourd’hui'
  else headline = 'Fermé aujourd’hui'

  return (
    <article className={HERO_CLASSES}>
      {tone && isToday ? <span className="latest-grade-wash" style={{ background: tone }} aria-hidden="true" /> : null}
      <span className="flex min-w-0 items-center gap-[6px] font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">
        {isToday ? <span className={`size-2 shrink-0 rounded-full ${status.state === 'open' ? 'transit-live-dot' : ''}`} style={{ background: tone ?? 'var(--color-text-muted)' }} aria-hidden="true" /> : <Icon icon="carbon:calendar" className="size-4 shrink-0" aria-hidden="true" />}
        <span className="truncate">{headline}</span>
        {CROUS_MEAL_PRICE ? <span className="ml-auto shrink-0 rounded-full bg-accent-bg px-2 py-0.5 font-body text-[12px] font-semibold text-accent-text">{CROUS_MEAL_PRICE}</span> : null}
      </span>
      <p className="m-0 mt-auto font-display text-[40px] font-bold leading-none tracking-[-0.02em] max-md:text-[32px]">
        {formatMinutes(window.open)}<span className="mx-1.5 align-middle font-body text-[24px] font-medium text-text-muted max-md:text-[20px]">à</span>{formatMinutes(window.close)}
      </p>
      <p className="m-0 truncate font-body text-[14px] font-medium text-text-secondary">{restaurant.title}{restaurant.zone ? ` · ${restaurant.zone}` : ''}</p>
      <ServiceBar window={window} lunch={lunch} nowMinute={isToday ? nowMinute : null} />
    </article>
  )
}

// The break as a ring: how much of the service it covers, its length in
// the middle.
function LunchRingCard({ window, lunch }) {
  const length = lunch.end - lunch.start
  const enough = length >= 30
  const whole = lunch.start <= window.open && lunch.end >= window.close
  return (
    <article className={SQUARE_CLASSES} aria-label={`Pause midi de ${formatDuration(length)}, de ${formatMinutes(lunch.start)} à ${formatMinutes(lunch.end)}`}>
      <span className="font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Pause midi</span>
      <div className="flex flex-1 items-center justify-center">
        <ProgressRing value={length / (window.close - window.open)} color={enough ? OPEN_GREEN : '#F2A600'} label="" className="size-[120px] max-md:size-[104px]">
          <span className="font-display text-[30px] font-bold leading-none max-md:text-[26px]">{whole ? 'Libre' : formatDuration(length)}</span>
          <span className="mt-1 text-[12px] font-semibold leading-none text-text-muted">{whole ? 'tout le service' : enough ? 'pour manger' : 'un peu juste'}</span>
        </ProgressRing>
      </div>
    </article>
  )
}

// The days with a menu as cards: the day, its hot dish, a leaf when there
// is a vegetarian dish; the picked one outlined.
function MenuDayCards({ days, selectedDate, onSelect }) {
  return (
    <ul className="m-0 -mx-6 -mt-2 -mb-7 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-6 pt-2 pb-7 scroll-px-6 favorites-scroll-hide max-md:-mx-3 max-md:gap-2 max-md:px-3 max-md:scroll-px-3">
      {days.map((day) => {
        const section = mainSection(day)
        const dish = section ? readDish(section.items[0]) : null
        const veggie = day.meals.some((meal) => meal.sections.some((entry) => entry.items.some((item) => readDish(item).veggie)))
        const selected = day.date === selectedDate
        return (
          <li key={day.date} className="flex w-[210px] shrink-0 snap-start max-md:w-[180px]">
            <button
              type="button"
              onClick={() => onSelect(day.date)}
              aria-pressed={selected}
              className={`widget-card widget-card-visible shadow-md relative isolate flex w-full min-w-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-[22px] border bg-widget-bg p-4 text-left text-text transition-transform duration-150 active:scale-[0.98] max-md:rounded-[20px] max-md:p-3 ${selected ? 'border-text ring-1 ring-text' : 'border-white dark:border-border'}`}
            >
              <span className="latest-grade-wash" style={{ background: accentColor(sectionAccent(section?.title)) }} aria-hidden="true" />
              <span className="flex items-center gap-[6px]">
                <span className="truncate font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]">{dayChipLabel(day.date)}</span>
                {veggie ? <Icon icon="ph:leaf-fill" className="ml-auto size-4 shrink-0 text-[#3CB53A]" aria-label="Plat végé ce jour-là" /> : null}
              </span>
              <span className="line-clamp-2 h-[38px] font-body text-[15px] font-semibold leading-[1.25] text-text">{dish?.name ?? 'Menu publié'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function CrousPage({ establishment = null, selection = null, sessionUser = '' }) {
  const [restaurantId, setRestaurantId] = useState(() => getStoredCrousRestaurant(establishment))
  const [state, setState] = useState({ status: 'loading', data: null })
  const [selectedDate, setSelectedDate] = useState(null)
  const [veggieOnly, setVeggieOnly] = useState(false)
  const events = useUpcomingClasses({ selection, sessionUser, enabled: Boolean(sessionUser) })
  const now = useMinuteClock()

  useEffect(() => {
    const previousTitle = document.title
    document.title = `Menu du RU · ${APP_NAME}`
    return () => { document.title = previousTitle }
  }, [])

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ status: 'loading', data: current.data }))
    fetchCrous(restaurantId)
      .then((data) => { if (!cancelled) setState({ status: 'ok', data }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', data: null }) })
    return () => { cancelled = true }
  }, [restaurantId])

  const data = state.data
  const restaurant = data?.restaurants.find((resto) => resto.id === restaurantId) ?? null
  const days = useMemo(() => (data?.days ?? []).filter((day) => day.date >= todayKey()), [data])
  const firstPick = useMemo(() => pickMenuDay(days), [days])
  const day = days.find((entry) => entry.date === selectedDate) ?? firstPick.day

  const handleRestaurantChange = (id) => {
    setRestaurantId(id)
    setStoredCrousRestaurant(id)
    setSelectedDate(null)
  }

  const restaurantOptions = useMemo(() => (data?.restaurants ?? [])
    .slice()
    .sort((left, right) => (left.zone ?? '').localeCompare(right.zone ?? '', 'fr') || left.title.localeCompare(right.title, 'fr'))
    .map((resto) => ({ value: resto.id, label: resto.zone ? `${resto.title} · ${resto.zone}` : resto.title })), [data])

  // RUs of the same town (then others) that put a menu online.
  const otherRestaurants = useMemo(() => (data?.restaurants ?? [])
    .filter((resto) => resto.hasMenu && resto.id !== restaurantId)
    .sort((left, right) => Number(right.zone === restaurant?.zone) - Number(left.zone === restaurant?.zone))
    .slice(0, 3), [data, restaurant, restaurantId])

  let body
  if (state.status === 'loading' && !data) {
    body = <LoadingDots label="Chargement du menu" className="justify-self-start py-2 text-text-muted" />
  } else if (state.status === 'error') {
    body = (
      <StatusMessage
        icon="carbon:cloud-offline"
        title="Menu indisponible"
        detail="Le CROUS ne répond pas pour le moment. Réessaie dans quelques minutes."
      />
    )
  } else if (!restaurant) {
    body = <StatusMessage icon="carbon:restaurant" title="Choisis ton restaurant" detail="Sélectionne ton RU à côté du titre pour voir son menu." />
  } else if (!day) {
    // The RU puts no menu online (many don't): say so, and offer the RUs
    // that do as cards, those of its town first.
    body = (
      <div className="grid gap-4">
        <StatusMessage
          icon="carbon:document-unknown"
          title="Menu pas encore publié"
          detail={`${restaurant.title} n’a pas mis son menu en ligne pour les prochains jours. Le CROUS le publie souvent la veille, parfois pas du tout.`}
        />
        {otherRestaurants.length ? (
          <PageSection id="crous-others" icon="carbon:restaurant" title="Avec un menu en ligne">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 max-md:grid-cols-1 max-md:gap-2">
              {otherRestaurants.map((resto) => (
                <button
                  key={resto.id}
                  type="button"
                  onClick={() => handleRestaurantChange(resto.id)}
                  className={`${PAGE_CARD} relative isolate flex cursor-pointer flex-col gap-1.5 overflow-hidden p-4 text-left transition-transform duration-150 active:scale-[0.98] max-md:p-3`}
                >
                  <span className="latest-grade-wash" style={{ background: accentColor(8) }} aria-hidden="true" />
                  <span className="flex items-center gap-2 font-body text-[13px] font-semibold text-text-muted">
                    <Icon icon="carbon:location" className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{resto.zone ?? 'CROUS'}</span>
                    {resto.zone === restaurant.zone ? <span className="ml-auto shrink-0 rounded-full bg-accent-bg px-2 py-0.5 text-[11px] text-accent-text">Même ville</span> : null}
                  </span>
                  <span className="font-body text-[16px] font-semibold leading-tight text-text">{resto.title}</span>
                  <span className="flex items-center gap-1 font-body text-[13px] font-semibold text-text-secondary">Voir le menu <Icon icon="carbon:arrow-right" className="size-3.5" aria-hidden="true" /></span>
                </button>
              ))}
            </div>
          </PageSection>
        ) : null}
      </div>
    )
  } else if (!hasMenu(day)) {
    const notice = day.meals.map((meal) => meal.notice).filter(Boolean).join(' ')
    body = <StatusMessage icon="carbon:locked" title="Pas de service ce jour-là" detail={notice || 'Le restaurant est fermé ce jour-là.'} />
  } else {
    const meals = day.meals
      .map((meal) => ({
        ...meal,
        sections: meal.sections
          .map((section) => ({ ...section, items: veggieOnly ? section.items.filter((item) => readDish(item).veggie) : section.items }))
          .filter((section) => section.items.length),
      }))
      .filter((meal) => meal.sections.length)
    body = (
      <div key={`${restaurantId}-${day.date}-${veggieOnly}`} className="semester-fade grid gap-8 max-md:gap-6">
        {meals.length ? meals.map((meal, index) => (
          <PageSection
            key={meal.name}
            id={`crous-meal-${meal.name}`}
            icon={/soir/i.test(meal.name) ? 'carbon:moon' : 'carbon:sun'}
            title={meal.name.charAt(0).toUpperCase() + meal.name.slice(1)}
            aside={index === 0 ? <VeggieToggle on={veggieOnly} onChange={setVeggieOnly} /> : null}
          >
            <MealCard meal={meal} />
          </PageSection>
        )) : (
          <StatusMessage
            icon="ph:leaf"
            title="Pas de plat végé annoncé ce jour-là"
            detail="Le CROUS marque ses plats végétariens « VG » : aucun ce jour-là."
            action={<VeggieToggle on={veggieOnly} onChange={setVeggieOnly} />}
          />
        )}
      </div>
    )
  }

  const dayOptions = days.filter((entry) => hasMenu(entry)).slice(0, 7)
  const closures = useMemo(() => describeClosures(days), [days])
  const openingHours = readOpeningHours(restaurant?.hours)
  const serviceWindow = parseServiceWindow(openingHours?.time)
  const showsAnotherDay = hasMenu(day) && !selectedDate && !firstPick.isToday && day.date !== todayKey()

  // The day the live card is about: the one shown, else today.
  const cardDate = day?.date ?? todayKey()
  const isToday = cardDate === todayKey()
  const todayEntry = days.find((entry) => entry.date === todayKey())
  const nowDate = new Date(now)
  const weekday = nowDate.getDay() >= 1 && nowDate.getDay() <= 5
  const servesToday = todayEntry ? hasMenu(todayEntry) : weekday && !restaurant?.closed
  const status = serviceStatus(serviceWindow, nowDate, servesToday)
  const lunch = serviceWindow && events ? findLunchBreak(events, cardDate, serviceWindow) : null

  const overview = restaurant ? (
    <div className="grid gap-4 max-md:gap-3">
      <StatRow>
        {serviceWindow ? (
          <RuLiveCard
            restaurant={restaurant}
            window={serviceWindow}
            status={status}
            lunch={lunch}
            isToday={isToday}
            dayLabel={`${formatDay(cardDate, { long: true })}`}
            nowMinute={nowDate.getHours() * 60 + nowDate.getMinutes()}
          />
        ) : null}
        {serviceWindow && lunch ? <LunchRingCard window={serviceWindow} lunch={lunch} /> : null}
        {!serviceWindow && CROUS_MEAL_PRICE ? <StatCard label="Repas étudiant" icon="carbon:wallet" value={CROUS_MEAL_PRICE} detail="Pour tous les étudiants" /> : null}
        {!serviceWindow && openingHours?.time ? <StatCard label="Horaires" icon="carbon:time" value={openingHours.time} detail={openingHours.detail} className="[&_.font-display]:text-[26px]" /> : null}
      </StatRow>
      {restaurant.closed ? (
        <GradesNotice icon="carbon:locked" label="Restaurant fermé" title="Restaurant fermé pour le moment">
          Le CROUS indique que ce restaurant est fermé : vérifie un autre RU proche.
        </GradesNotice>
      ) : null}
      {closures.map((closure) => (
        <GradesNotice key={closure} icon="carbon:locked" label="Fermeture annoncée" title={closure} />
      ))}
      {showsAnotherDay ? (
        <GradesNotice icon="carbon:calendar" label="Jour affiché" title={`Pas de service aujourd’hui : voici le menu de ${formatDay(day.date, { long: true }).toLowerCase()}`} />
      ) : null}
    </div>
  ) : null

  return (
    <AppPage
      titleId="crous-page-title"
      title="Menu du RU"
      controls={restaurantOptions.length ? (
        <span className="inline-flex max-md:min-w-0 max-md:max-w-full">
          <Dropdown
            label="Restaurant"
            options={restaurantOptions}
            value={restaurantId}
            onChange={handleRestaurantChange}
            placeholder="Choisir un RU"
            triggerLabel={restaurant ? restaurant.title : null}
            triggerClassName="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-body text-[15px] font-semibold leading-none text-text-secondary cursor-pointer transition-colors duration-150 hover:text-text focus-visible:text-text focus-visible:outline-none focus-visible:underline underline-offset-4 max-md:min-h-10 max-md:max-w-full max-md:truncate max-md:rounded-full max-md:border max-md:border-border max-md:bg-widget-bg max-md:px-3.5 max-md:text-text max-md:shadow-xs"
          />
        </span>
      ) : null}
      actions={restaurant?.lat != null ? (
        <PageButton
          icon="carbon:map"
          label="Itinéraire"
          href={`https://www.openstreetmap.org/directions?to=${restaurant.lat},${restaurant.lon}`}
        />
      ) : null}
      overview={overview}
      footer={data?.offline ? 'Hors ligne : dernier menu enregistré' : data ? 'Menus publiés par le CROUS, sous réserve de modification' : null}
    >
      <div className="grid gap-6 max-md:gap-5">
        {dayOptions.length > 1 ? <MenuDayCards days={dayOptions} selectedDate={day?.date} onSelect={setSelectedDate} /> : null}
        {body}
      </div>
    </AppPage>
  )
}

function VeggieToggle({ on, onChange }) {
  return (
    <button type="button" className={`${INLINE_BUTTON} ${on ? 'border-[#3CB53A]! bg-[#e3f5e1]! text-[#2f7a2b]! dark:bg-[#183a17]! dark:text-[#8fd88a]!' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <Icon icon={on ? 'ph:leaf-fill' : 'ph:leaf'} className="size-3.5" aria-hidden="true" />
      Végé
    </button>
  )
}

export default CrousPage
