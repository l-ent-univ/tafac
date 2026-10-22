import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { CROUS_MEAL_PRICE, describeClosures, fetchCrous, getStoredCrousRestaurant, pickMenuDay } from '../crousApi'

// « Menu du RU » card: the hot dishes of the student's RU today (or its next
// day with a menu), the meal's price; the whole card opens the page.

const CARD_CLASSES = 'crous-card-widget widget-card shadow-md relative flex h-[140px] w-full flex-[1_1_360px] min-w-0 flex-col gap-[6px] overflow-hidden rounded-[22px] border border-white bg-widget-bg p-4 text-left text-text cursor-pointer transition-colors duration-150 hover:bg-row-hover max-2xl:flex-[1_1_calc(50%-6px)] max-md:h-[124px] max-md:rounded-[20px] max-md:p-3 max-xs:flex-[1_1_100%]'

function formatDay(date) {
  const label = new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default function WidgetCrous({ visible = true, establishment = null }) {
  const [state, setState] = useState({ status: 'loading', data: null })

  useEffect(() => {
    let cancelled = false
    fetchCrous(getStoredCrousRestaurant(establishment))
      .then((data) => { if (!cancelled) setState({ status: 'ok', data }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', data: null }) })
    return () => { cancelled = true }
  }, [establishment])

  const restaurant = state.data?.restaurants.find((resto) => resto.id === state.data.restaurantId) ?? null
  const { day, isToday } = pickMenuDay(state.data?.days ?? [])
  const meal = day?.meals.find((entry) => entry.sections.length) ?? null
  // The hot dishes ("Plats chauds"), else the first section.
  const section = meal?.sections.find((entry) => /plat|chaud/i.test(entry.title)) ?? meal?.sections[0] ?? null

  let content
  if (state.status === 'loading') {
    content = <p className="m-0 font-body text-[14px] font-medium text-text-muted">Chargement du menu…</p>
  } else if (state.status === 'error' || !restaurant) {
    content = <p className="m-0 font-body text-[14px] font-medium text-text-muted">Choisis ton RU pour voir son menu.</p>
  } else if (!section) {
    const closure = describeClosures(state.data?.days ?? [])[0] ?? null
    content = (
      <>
        <p className="m-0 font-body text-[15px] font-semibold leading-snug text-text">Menu pas encore publié</p>
        <p className="m-0 line-clamp-2 font-body text-[13px] font-medium leading-snug text-text-muted">
          {closure ?? 'Le CROUS ne l’a pas mis en ligne pour les prochains jours.'}
        </p>
      </>
    )
  } else {
    content = (
      <>
        <p className="m-0 font-body text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          {isToday ? section.title : `${formatDay(day.date)} · ${section.title}`}
        </p>
        <ul className="m-0 grid list-none gap-1 p-0">
          {section.items.slice(0, 2).map((item, index) => (
            <li key={`${item}-${index}`} className="truncate font-body text-[15px] font-semibold leading-snug text-text">{item}</li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navigateTo('ru')}
      className={`${CARD_CLASSES} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Menu du RU${restaurant ? ` : ${restaurant.title}` : ''}, ouvrir le menu`}
    >
      <span className="flex min-w-0 items-center gap-[5px] text-text-muted">
        <Icon icon="carbon:restaurant" className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-body text-base font-medium leading-[1.06] max-md:text-[14px]">
          {restaurant ? restaurant.title : 'Menu du RU'}
        </span>
        {CROUS_MEAL_PRICE ? (
          <span className="ml-auto shrink-0 rounded-full bg-accent-bg px-2 py-0.5 font-body text-[12px] font-semibold text-accent-text">{CROUS_MEAL_PRICE}</span>
        ) : null}
      </span>
      <div className="mt-auto grid gap-1.5">{content}</div>
    </button>
  )
}
