import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { formatClock } from '../transitClock'
import {
  TRANSIT_NAME,
  fetchDepartures,
  getTransitCampus,
  nearestPlaces,
  placeName,
  stopName,
  updateTransitSettings,
  useTransitNetwork,
  useTransitSettings,
} from '../transitApi'
import { useDayBuses } from '../useDayBuses'
import { APP_NAME } from '../seo'
import { AppPage, INLINE_BUTTON, PAGE_CARD, PRIMARY_BUTTON, PageButton, PageSection, StatCard, StatRow } from './AppPage'
import AppSheet from './AppSheet'
import { GradesNotice } from './GradesNotice'
import LoadingDots from './LoadingDots'
import { SegmentedControl, StatusMessage } from './ScodocUi'
import TransitLineDiagram from './TransitLineDiagram'
import { BusHeroCard, BusRingCard, DayCards } from './TransitOverview'
import { DepartureRow, JourneyCard, LineBadge } from './TransitUi'
import { pickNextTrip } from '../transitDay'

const TransitMap = lazy(() => import('./TransitMap'))

// « Bus »: the town's buses fitted to the timetable. The student's stop
// (picked, or the closest one), the bus to the first class of each coming
// day and the one home after the last, a warning when the last class ends
// after the last bus, live departures from their stops, the network on a
// map and as line plans. Its settings (margin, reminders) live in
// Réglages › Bus (AccountModal).

const DEPARTURES_REFRESH_MS = 30_000

function normalize(text) {
  return String(text ?? '').toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Picking a stop: a search over the network's stops, the closest first
// when the position is known.
function StopPicker({ open, onClose, network, position, onPick, title }) {
  const [query, setQuery] = useState('')
  const places = useMemo(() => {
    const list = position
      ? nearestPlaces(network, position, network.places.length).map(({ place, distance }) => ({ place, distance }))
      : network.places.slice().sort((left, right) => left.name.localeCompare(right.name, 'fr')).map((place) => ({ place, distance: null }))
    const wanted = normalize(query.trim())
    return (wanted ? list.filter(({ place }) => normalize(place.name).includes(wanted)) : list).slice(0, 60)
  }, [network, position, query])
  const routes = new Map(network.routes.map((route) => [route.id, route]))

  return (
    <AppSheet
      open={open}
      onClose={onClose}
      title={title}
      icon="carbon:bus"
      toolbar={(
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un arrêt"
          aria-label="Rechercher un arrêt"
          className="w-full rounded-full border border-border bg-widget-bg px-4 py-2.5 font-body text-[16px] font-medium text-text outline-none focus-visible:border-brand"
          autoFocus
        />
      )}
    >
      {places.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {places.map(({ place, distance }) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => { onPick(place.id); onClose() }}
                className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-[14px] border-0 bg-transparent px-3 py-2.5 text-left text-text transition-colors hover:bg-row-hover"
              >
                <Icon icon="carbon:location" className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-body text-[15px] font-semibold">{place.name}</span>
                {distance != null ? <span className="shrink-0 font-body text-[13px] font-medium text-text-muted">{distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`}</span> : null}
                <span className="flex shrink-0 gap-1">
                  {place.routeIds.slice(0, 3).map((id) => {
                    const route = routes.get(id)
                    return route ? <LineBadge key={id} line={route.shortName} color={route.color} textColor={route.textColor} size="sm" /> : null
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 py-6 text-center font-body text-[14px] font-medium text-text-muted">Aucun arrêt ne s’appelle comme ça.</p>
      )}
    </AppSheet>
  )
}

function useDepartures(placeId) {
  const [state, setState] = useState({ placeId: null, status: 'idle', departures: [] })
  useEffect(() => {
    if (!placeId) return undefined
    let cancelled = false
    const load = () => {
      if (document.visibilityState !== 'visible') return
      fetchDepartures(placeId, 8)
        .then((data) => { if (!cancelled) setState({ placeId, status: 'ok', departures: data.departures, later: data.later ?? null }) })
        .catch(() => { if (!cancelled) setState((current) => ({ placeId, status: current.placeId === placeId && current.departures.length ? 'ok' : 'error', departures: current.placeId === placeId ? current.departures : [] })) })
    }
    load()
    const interval = window.setInterval(load, DEPARTURES_REFRESH_MS)
    document.addEventListener('visibilitychange', load)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', load)
    }
  }, [placeId])
  return state.placeId === placeId ? state : { placeId, status: 'loading', departures: [] }
}

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(interval)
  }, [intervalMs])
  return now
}

function DaySection({ plan, network, campus }) {
  const to = plan.to?.[0] ?? null
  const from = plan.from?.[0] ?? null
  const firstClock = formatClock(plan.first.start)
  return (
    <div className="grid gap-3">
      {plan.lastBus && plan.from?.length === 0 ? (
        <GradesNotice icon="carbon:warning-alt" label="Dernier bus" title={`Ton dernier cours finit à ${formatClock(plan.last.end)}, après le dernier bus (${formatClock(plan.lastBus.legs[0].departAt)})`}>
          Prévois un autre moyen de rentrer, ou pars un peu avant la fin.
        </GradesNotice>
      ) : null}
      <div className="grid grid-cols-2 items-start gap-3 max-lg:grid-cols-1 max-md:gap-2">
        {to ? (
          <JourneyCard journey={to} network={network} title={`Pour ton cours de ${firstClock}`} detail={plan.first.title} endAt={plan.first.start} endLabel="Cours" />
        ) : plan.to ? (
          <StatusMessage icon="carbon:bus" title={`Pas de bus pour ton cours de ${firstClock}`} detail={`Aucun trajet n’arrive à ${campus.label} à temps depuis ton arrêt.`} />
        ) : null}
        {from ? (
          <JourneyCard journey={from} network={network} title={`Après ton cours de ${formatClock(plan.last.end)}`} detail={`Retour depuis ${stopName(network, from.legs[0].fromStopId) ?? campus.label}`} />
        ) : !plan.lastBus && plan.from ? (
          <StatusMessage icon="carbon:bus" title="Pas de bus retour ce jour-là" detail="Aucun trajet ne ramène à ton arrêt après la fin des cours." />
        ) : null}
      </div>
    </div>
  )
}

function TransitPage({ establishment = null, selection = null, sessionUser = '' }) {
  const { status: networkStatus, network } = useTransitNetwork()
  const settings = useTransitSettings()
  const buses = useDayBuses({ establishment, selection, sessionUser })
  const campus = getTransitCampus(establishment)
  const now = useNow()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [planView, setPlanView] = useState('map')
  const [routeId, setRouteId] = useState(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = `Bus · ${APP_NAME}`
    return () => { document.title = previousTitle }
  }, [])

  const campusPlaceId = useMemo(() => (network && campus ? nearestPlaces(network, campus, 1)[0]?.place.id ?? null : null), [campus, network])
  const nearbyPlaces = useMemo(() => (network && position ? nearestPlaces(network, position, 2) : []), [network, position])

  // Stops whose departures can be shown, as tabs.
  const stopTabs = useMemo(() => {
    const tabs = []
    const add = (placeId, label) => {
      if (placeId && !tabs.some((tab) => tab.value === placeId)) tabs.push({ value: placeId, label })
    }
    add(settings.homePlaceId, 'Mon arrêt')
    add(campusPlaceId, campus?.label ?? 'Campus')
    nearbyPlaces.forEach(({ place }, index) => add(place.id, index === 0 ? 'Près de moi' : place.name))
    settings.favoritePlaceIds.forEach((placeId) => add(placeId, placeName(network, placeId) ?? 'Favori'))
    return tabs
  }, [campus, campusPlaceId, nearbyPlaces, network, settings.favoritePlaceIds, settings.homePlaceId])
  const departuresPlaceId = selectedPlaceId ?? stopTabs[0]?.value ?? null
  const departures = useDepartures(departuresPlaceId)

  const plans = buses.plans
  const plan = plans.find((entry) => entry.dayKey === selectedDay) ?? plans[0] ?? null

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) { setLocateError('Ton navigateur ne donne pas ta position.'); return }
    setLocating(true)
    setLocateError(null)
    const found = (result) => {
      setLocating(false)
      setPosition({ lat: result.coords.latitude, lon: result.coords.longitude })
      setSelectedPlaceId(null)
    }
    const failed = (error) => {
      setLocating(false)
      setLocateError(error.code === error.PERMISSION_DENIED
        ? 'Position refusée : autorise-la pour ce site dans ton navigateur, ou choisis ton arrêt dans la liste.'
        : 'Position introuvable (sur ordinateur, la localisation du système est peut-être coupée). Choisis ton arrêt dans la liste.')
    }
    // GPS first; a computer without one often fails it, so once more with
    // the network's rougher position (enough to find the closest stops).
    navigator.geolocation.getCurrentPosition(found, (error) => {
      if (error.code === error.PERMISSION_DENIED) { failed(error); return }
      navigator.geolocation.getCurrentPosition(found, failed, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 })
    }, { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 })
  }, [])

  const toggleFavorite = (placeId) => {
    const favorites = settings.favoritePlaceIds.includes(placeId)
      ? settings.favoritePlaceIds.filter((id) => id !== placeId)
      : [...settings.favoritePlaceIds, placeId].slice(-6)
    updateTransitSettings({ favoritePlaceIds: favorites })
  }

  if (networkStatus === 'loading') {
    return <AppPage titleId="transit-page-title" title="Bus"><LoadingDots label="Chargement du réseau" className="justify-self-start py-2 text-text-muted" /></AppPage>
  }
  if (!network) {
    return (
      <AppPage titleId="transit-page-title" title="Bus">
        <StatusMessage icon="carbon:cloud-offline" title="Réseau indisponible" detail={`Les horaires ${TRANSIT_NAME} ne répondent pas pour le moment. Réessaie dans quelques minutes.`} />
      </AppPage>
    )
  }

  const homeName = placeName(network, settings.homePlaceId)
  const next = pickNextTrip(plans, now)

  const overview = (
    <div className="grid gap-4 max-md:gap-3">
      {settings.homePlaceId ? (
        buses.status === 'ok' ? (
          <StatRow>
            <BusHeroCard next={next} now={now} campusLabel={campus.label} />
            <BusRingCard next={next} plans={plans} now={now} />
            {next?.kind === 'to' && next.plan.from?.[0] ? (
              <StatCard
                label="Retour"
                icon="carbon:home"
                value={formatClock(next.plan.from[0].legs[0].departAt)}
                detail={`Après ton cours de ${formatClock(next.plan.last.end)}, chez toi vers ${formatClock(next.plan.from[0].arriveAt)}`}
              />
            ) : null}
          </StatRow>
        ) : buses.status === 'loading' ? (
          <LoadingDots label="Calcul de tes trajets" className="justify-self-start py-2 text-text-muted" />
        ) : null
      ) : (
        <GradesNotice icon="carbon:location" label="Ton arrêt" title="Choisis ton arrêt pour caler les bus sur ton planning">
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setPickerOpen(true)}>
              <Icon icon="carbon:search" className="size-4" aria-hidden="true" /> Choisir mon arrêt
            </button>
            <button type="button" className={INLINE_BUTTON} onClick={handleLocate} disabled={locating}>
              <Icon icon="carbon:location-current" className="size-3.5" aria-hidden="true" /> {locating ? 'Localisation…' : 'Arrêt le plus proche'}
            </button>
          </span>
        </GradesNotice>
      )}
      {!settings.homePlaceId && nearbyPlaces[0] ? (
        <GradesNotice icon="carbon:location-current" label="Près de toi" title={`${nearbyPlaces[0].place.name}, à ${Math.round(nearbyPlaces[0].distance)} m`}>
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={INLINE_BUTTON} onClick={() => updateTransitSettings({ homePlaceId: nearbyPlaces[0].place.id })}>
              <Icon icon="carbon:home" className="size-3.5" aria-hidden="true" /> En faire mon arrêt
            </button>
          </span>
        </GradesNotice>
      ) : null}
      {locateError ? <GradesNotice icon="carbon:location" label="Position" title={locateError} /> : null}
      {network.offline ? <GradesNotice icon="carbon:cloud-offline" label="Hors ligne" title="Plan du réseau enregistré : les passages et trajets reviendront avec le réseau" /> : null}
    </div>
  )

  let tripsBody = null
  if (settings.homePlaceId) {
    if (buses.status === 'loading') tripsBody = <LoadingDots label="Calcul des trajets" className="justify-self-start py-2 text-text-muted" />
    else if (buses.status === 'error') tripsBody = <StatusMessage icon="carbon:cloud-offline" title="Trajets indisponibles" detail="Le calcul n’a pas abouti. Réessaie dans un instant." />
    else if (!plans.length) tripsBody = <StatusMessage icon="carbon:calendar" title="Pas de cours dans les 7 prochains jours" detail="Les trajets apparaîtront ici dès que ton planning en aura." />
    else {
      tripsBody = (
        <div className="grid gap-3">
          {plans.length > 1 ? <DayCards plans={plans} selectedDayKey={plan.dayKey} onSelect={setSelectedDay} now={now} /> : null}
          <DaySection key={plan.dayKey} plan={plan} network={network} campus={campus} />
        </div>
      )
    }
  }

  const departuresName = placeName(network, departuresPlaceId)
  const isFavorite = departuresPlaceId && settings.favoritePlaceIds.includes(departuresPlaceId)

  return (
    <AppPage
      titleId="transit-page-title"
      title="Bus"
      controls={(
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-body text-[15px] font-semibold leading-none text-text-secondary cursor-pointer transition-colors duration-150 hover:text-text focus-visible:text-text focus-visible:outline-none focus-visible:underline underline-offset-4 max-md:min-h-10 max-md:max-w-full max-md:truncate max-md:rounded-full max-md:border max-md:border-border max-md:bg-widget-bg max-md:px-3.5 max-md:text-text max-md:shadow-xs"
          aria-label={homeName ? `Ton arrêt : ${homeName}, changer` : 'Choisir ton arrêt'}
        >
          <Icon icon="carbon:home" className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{homeName ?? 'Choisir mon arrêt'}</span>
          <Icon icon="carbon:chevron-down" className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      )}
      actions={<PageButton icon="carbon:location-current" label={locating ? 'Localisation…' : 'Autour de moi'} onClick={handleLocate} disabled={locating} />}
      overview={overview}
      footer={network.attribution ?? `Horaires ${TRANSIT_NAME}`}
    >
      <div className="grid gap-8 max-md:gap-6">
        {tripsBody ? (
          <PageSection id="transit-trips" icon="carbon:calendar" title="Ta semaine en bus" aside={buses.realtime ? <span className="font-body text-[13px] font-medium text-text-muted">Temps réel</span> : null}>
            {tripsBody}
          </PageSection>
        ) : null}

        {departuresPlaceId ? (
          <PageSection
            id="transit-departures"
            icon="carbon:time"
            title="Prochains passages"
            aside={(
              <button type="button" className={INLINE_BUTTON} onClick={() => toggleFavorite(departuresPlaceId)} aria-pressed={Boolean(isFavorite)}>
                <Icon icon={isFavorite ? 'carbon:star-filled' : 'carbon:star'} className="size-3.5" aria-hidden="true" />
                {isFavorite ? 'Favori' : 'Ajouter aux favoris'}
              </button>
            )}
          >
            {stopTabs.length > 1 ? (
              <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
                <SegmentedControl label="Arrêt" options={stopTabs.some((tab) => tab.value === departuresPlaceId) ? stopTabs : [...stopTabs, { value: departuresPlaceId, label: departuresName }]} value={departuresPlaceId} onChange={setSelectedPlaceId} />
              </div>
            ) : null}
            <div className={`${PAGE_CARD} py-1`}>
              <p className="m-0 flex items-center gap-2 px-4 pt-3 pb-1 font-body text-[13px] font-semibold text-text-muted max-md:px-3">
                <Icon icon="carbon:location" className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{departuresName}</span>
              </p>
              {departures.status === 'loading' ? (
                <LoadingDots label="Chargement des passages" className="px-4 py-3 text-text-muted" />
              ) : departures.status === 'error' ? (
                <p className="m-0 px-4 py-3 font-body text-[14px] font-medium text-text-muted">Passages indisponibles pour le moment.</p>
              ) : departures.departures.length ? (
                <ul className="m-0 grid list-none divide-y divide-border p-0">
                  {departures.departures.map((departure, index) => <DepartureRow key={`${departure.tripId}-${departure.fromStopId}`} departure={departure} now={now} first={index === 0} />)}
                </ul>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 max-md:px-3">
                  <Icon icon="carbon:moon" className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
                  <p className="m-0 font-body text-[14px] font-medium leading-snug text-text-secondary">
                    {departures.later
                      ? <>Plus de bus pour l’instant. Prochain passage <strong className="text-text">{new Date(departures.later.departAt).toDateString() === new Date(now).toDateString() ? 'à' : 'demain à'} {formatClock(departures.later.departAt)}</strong>, ligne {departures.later.line}.</>
                      : 'Aucun passage dans les prochaines 24 heures.'}
                  </p>
                </div>
              )}
            </div>
          </PageSection>
        ) : null}

        <PageSection
          id="transit-plan"
          icon="carbon:map"
          title="Plan du réseau"
          aside={<SegmentedControl label="Vue" size="sm" options={[{ value: 'map', label: 'Carte' }, { value: 'lines', label: 'Lignes' }]} value={planView} onChange={setPlanView} />}
        >
          <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Lignes">
            {planView === 'map' ? (
              <button type="button" onClick={() => setRouteId(null)} className={`${INLINE_BUTTON} ${routeId == null ? 'border-text' : ''}`} aria-pressed={routeId == null}>Toutes</button>
            ) : null}
            {network.routes.map((route) => (
              <button
                key={route.id}
                type="button"
                onClick={() => setRouteId(route.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center rounded-[10px] border-2 bg-transparent p-0.5 transition-opacity ${(routeId ?? (planView === 'lines' ? network.routes[0].id : null)) === route.id ? 'border-text' : 'border-transparent opacity-80 hover:opacity-100'}`}
                aria-pressed={routeId === route.id}
                aria-label={`Ligne ${route.shortName}`}
              >
                <LineBadge line={route.shortName} color={route.color} textColor={route.textColor} />
              </button>
            ))}
          </div>
          {planView === 'map' ? (
            <Suspense fallback={<div className="h-[420px] rounded-[22px] bg-bg-subtle max-md:h-[340px]" />}>
              <TransitMap
                network={network}
                routeId={routeId}
                homePlaceId={settings.homePlaceId}
                campus={campus}
                position={position}
                selectedPlaceId={departuresPlaceId}
                onSelectPlace={setSelectedPlaceId}
              />
            </Suspense>
          ) : (
            <TransitLineDiagram
              key={routeId ?? network.routes[0].id}
              network={network}
              routeId={routeId ?? network.routes[0].id}
              homePlaceId={settings.homePlaceId}
              campus={campus}
              selectedPlaceId={departuresPlaceId}
              onSelectPlace={(placeId) => {
                setSelectedPlaceId(placeId)
                document.getElementById('transit-departures')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            />
          )}
        </PageSection>

      </div>

      <StopPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        network={network}
        position={position}
        title="Ton arrêt"
        onPick={(placeId) => updateTransitSettings({ homePlaceId: placeId })}
      />
    </AppPage>
  )
}

export default TransitPage
