import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import AvailableApplications from './AvailableApplications'
import GradesLaunchCard from './GradesLaunchCard'
import GreetingCard from './GreetingCard'
import PlanningLaunchCard from './PlanningLaunchCard'
import ServiceNotice from './ServiceNotice'
import WidgetDeadlines from './WidgetDeadlines'
import WidgetLatestGrade from './WidgetLatestGrade'
import WidgetListStrip from './WidgetListStrip'
import WidgetNextClass from './WidgetNextClass'
import WidgetRecentMail from './WidgetRecentMail'
import { trackDashboardView } from '../analytics'
import { isWidgetAvailable } from '../dashboardWidgets'
import { useListCardOrder } from '../listCardOrder'
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
} from '../upcomingClasses'
import {
  getCurrentLocationWeather,
  getEditableLocationLabel,
  getWeatherForQuery,
} from '../weatherApi'

const WEATHER_CITY_KEY = 'l-ent:weather-city'
const WEATHER_CONFIG = universityConfig.features?.weather ?? {}
const DEFAULT_WEATHER_CITY = WEATHER_CONFIG.defaultCity || 'Paris'

const INITIAL_WEATHER_STATE = {
  summary: 'Chargement météo...',
  location: 'Localisation...',
  icon: 'carbon:cloudy',
  gradient: 'linear-gradient(180deg, #fde68a 0%, transparent 55%)',
  gradientDark: 'linear-gradient(180deg, #5c3d0e 0%, transparent 55%)',
}

function getLoadingWeatherState(previousState) {
  return {
    summary: 'Chargement météo...',
    location: previousState?.location || 'Localisation...',
    icon: previousState?.icon || 'carbon:cloudy',
    gradient: previousState?.gradient ?? INITIAL_WEATHER_STATE.gradient,
    gradientDark: previousState?.gradientDark ?? INITIAL_WEATHER_STATE.gradientDark,
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function WidgetContainer({
  userName = ' ',
  greeting,
  isSessionReady = true,
  establishment = null,
  sessionUser = null,
  selectedPlanningSelection = null,
  nextClassLookaheadDays = undefined,
  debugNextClass = false,
  canUseServerLaunch = true,
  hiddenWidgets = [],
  onDismissGreeting,
  showAppDescriptions = false,
  favoritesPortalTarget = null,
  gradesSupported = true,
  onOpenGrade = null,
  onOpenGradesPage = null,
  onOpenPlanningPage = null,
  onOpenPlanningDay = null,
}) {
  const displayName = userName?.trim() || ' '
  const [, setWeatherState] = useState(INITIAL_WEATHER_STATE)
  const [, setHasWeatherLoaded] = useState(false)
  const [areWidgetsVisible, setAreWidgetsVisible] = useState(false)
  const [isWeatherLoading, setIsWeatherLoading] = useState(true)
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationError, setLocationError] = useState('')
  const hasReportedViewRef = useRef(false)
  const showGreeting = !hiddenWidgets.includes('greeting')

  // Anonymous analytics: one dashboard_viewed per dashboard mount.
  useEffect(() => {
    if (!isSessionReady || hasReportedViewRef.current) return
    hasReportedViewRef.current = true
    trackDashboardView({ greetingShown: showGreeting })
  }, [showGreeting, isSessionReady])

  const loadCurrentWeather = useCallback(async () => {
    setIsWeatherLoading(true)
    setWeatherState((current) => getLoadingWeatherState(current))

    try {
      const nextWeather = await getCurrentLocationWeather()
      setWeatherState(nextWeather)
      const resolvedCity = getEditableLocationLabel(nextWeather.location)
      if (resolvedCity) {
        localStorage.setItem(WEATHER_CITY_KEY, resolvedCity)
      }
      return nextWeather
    } finally {
      setIsWeatherLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function hydrateWeather() {
      if (WEATHER_CONFIG.enabled === false) {
        setHasWeatherLoaded(true)
        setIsWeatherLoading(false)
        return
      }

      setIsWeatherLoading(true)

      try {
        const storedCity = localStorage.getItem(WEATHER_CITY_KEY)
        const nextWeather = storedCity
          ? await getWeatherForQuery(storedCity)
          : await getWeatherForQuery(DEFAULT_WEATHER_CITY)

        if (isMounted) {
          setWeatherState(nextWeather)
          setHasWeatherLoaded(true)
        }
      } catch {
        if (isMounted) {
          setWeatherState({
            summary: 'Météo indisponible',
            location: 'Choisir une ville',
            icon: 'carbon:cloudy',
            gradient: INITIAL_WEATHER_STATE.gradient,
          })
          setHasWeatherLoaded(true)
        }
      } finally {
        if (isMounted) {
          setIsWeatherLoading(false)
        }
      }
    }

    void hydrateWeather()

    return () => {
      isMounted = false
    }
  }, [])

  // Cards fade in once the session is ready. They no longer wait for the
  // weather: its card is hidden, and a slow Open-Meteo held them all back.
  useEffect(() => {
    if (!isSessionReady || areWidgetsVisible) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setAreWidgetsVisible(true)
    }, 140)

    return () => window.clearTimeout(timeoutId)
  }, [areWidgetsVisible, isSessionReady])

  useEffect(() => {
    if (!isLocationPickerOpen) {
      return undefined
    }

    function handleEscape(event) {
      if (event.key === 'Escape' && !isWeatherLoading) {
        setIsLocationPickerOpen(false)
        setLocationError('')
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isLocationPickerOpen, isWeatherLoading])

  const handleCloseLocationPicker = useCallback(() => {
    setIsLocationPickerOpen(false)
    setLocationError('')
  }, [])

  const handleUseCurrentPosition = useCallback(async () => {
    try {
      setLocationError('')
      await loadCurrentWeather()
      setIsLocationPickerOpen(false)
    } catch (error) {
      setLocationError(getErrorMessage(error))
    }
  }, [loadCurrentWeather])

  const handleSubmitLocation = useCallback(async (event) => {
    event.preventDefault()
    const trimmedQuery = locationQuery.trim()

    try {
      if (!trimmedQuery) {
        setLocationError('Saisis une ville/code postal ou choisis "Ma position".')
        return
      }

      setIsWeatherLoading(true)
      setLocationError('')
      const nextWeather = await getWeatherForQuery(trimmedQuery)
      setWeatherState(nextWeather)
      localStorage.setItem(WEATHER_CITY_KEY, trimmedQuery)
      setIsLocationPickerOpen(false)
    } catch (error) {
      setLocationError(getErrorMessage(error))
    } finally {
      setIsWeatherLoading(false)
    }
  }, [locationQuery])

  const isLocationActionDisabled = isWeatherLoading
  const isShown = (widgetId) => isWidgetAvailable(widgetId, establishment) && !hiddenWidgets.includes(widgetId)
  const showNextClass = debugNextClass || isShown('nextClass')
  // The grade card reads BUT relevés only.
  const showGradeWidgets = gradesSupported && isShown('latestGrade')
  const showMailWidget = isShown('mail')
  const showDeadlinesWidget = isShown('deadlines')
  const pairListWidgets = showMailWidget && showDeadlinesWidget
  // The busier of the two goes first (src/listCardOrder.js). Keyed, so a swap
  // moves the cards instead of remounting (and refetching) them.
  const listCardsFirst = useListCardOrder()
  const listCards = [
    { label: 'Mails récents', card: <WidgetRecentMail key="mail" visible={areWidgetsVisible} /> },
    { label: 'Échéances', card: <WidgetDeadlines key="deadlines" visible={areWidgetsVisible} /> },
  ]
  if (listCardsFirst === 'deadlines') listCards.reverse()
  // Where the greeting briefing gets classes: the shown card's loads, its
  // own load when the student hid the card, nothing without the widget.
  const briefingClassesSource = debugNextClass || !isWidgetAvailable('nextClass', establishment)
    ? null
    : hiddenWidgets.includes('nextClass') ? 'self' : 'card'
  const briefingClassesCacheKey = useMemo(() => buildNextClassCacheEntryKey(
    sessionUser,
    buildResourceIdsFromSelection(selectedPlanningSelection).join('|'),
    nextClassLookaheadDays ?? NEXT_CLASS_LOOKAHEAD_DAYS,
  ), [nextClassLookaheadDays, selectedPlanningSelection, sessionUser])

  return (
    <section className="w-full grid gap-10 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-8" aria-label="Widgets">
      {/* The page's top on a band edge to edge (.page-top-band, as on "Mes
          notes"): the greeting and the widgets, set apart from the apps. */}
      <div className="page-top-band -mx-6 -mt-4 px-6 pt-4 pb-7 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:px-3 max-md:pt-3 max-md:pb-5">
      <ServiceNotice className="mb-4 max-md:mb-3" />
      <div className="widget-row flex flex-wrap gap-3 items-stretch max-md:gap-2 overflow-visible p-2 -m-2">
        {showGreeting ? (
          <GreetingCard
            displayName={displayName}
            greeting={greeting}
            visible={areWidgetsVisible}
            onDismiss={onDismissGreeting}
            classesSource={briefingClassesSource}
            classesCacheKey={briefingClassesCacheKey}
            selection={selectedPlanningSelection}
            lookaheadDays={nextClassLookaheadDays ?? NEXT_CLASS_LOOKAHEAD_DAYS}
            expectDeadlines={showDeadlinesWidget}
          />
        ) : null}

        {showNextClass ? (
          <div id="sidebar-section-planning" className="contents">
            <WidgetNextClass
              visible={areWidgetsVisible}
              debug={debugNextClass}
              selection={selectedPlanningSelection}
              sessionUser={sessionUser}
              lookaheadDays={nextClassLookaheadDays}
              onOpenPlanning={onOpenPlanningDay}
            />
          </div>
        ) : null}
        {showGradeWidgets || showMailWidget || showDeadlinesWidget ? (
          // Below 2xl the grade and list card share their own row; from 2xl
          // the wrapper dissolves (display: contents) into the widget row.
          // empty:hidden covers the list card rendering nothing (no session).
          // With both mail and deadlines, the wrappers always dissolve and the
          // layout follows the row width instead ("Widget row layout with
          // paired list cards" in overrides.css). On phones it dissolves too,
          // so the grade shares its row with the next class; the two list
          // cards become a swipeable strip there (WidgetListStrip).
          <div
            id={showGradeWidgets ? 'sidebar-section-grades' : undefined}
            className={pairListWidgets ? 'contents' : 'flex-[1_1_100%] min-w-0 flex flex-wrap items-stretch gap-3 max-md:gap-2 empty:hidden 2xl:contents max-xs:contents'}
          >
            {/* Bloc « Moyenne Générale » masqué pour l'instant — réimporter
                WidgetAverageGrade et le rendre ici pour le réactiver. */}
            {showGradeWidgets ? <WidgetLatestGrade visible={areWidgetsVisible} user={sessionUser} onOpenGrade={onOpenGrade} /> : null}
            {pairListWidgets ? (
              <WidgetListStrip labels={listCards.map(({ label }) => label)} visible={areWidgetsVisible}>
                {listCards.map(({ card }) => card)}
              </WidgetListStrip>
            ) : (
              <>
                {showMailWidget ? <WidgetRecentMail visible={areWidgetsVisible} /> : null}
                {showDeadlinesWidget ? <WidgetDeadlines visible={areWidgetsVisible} /> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      </div>

      <div>
        {/* A page just launched (the Planning, « Mes notes »): a compact
            card under the widgets, out of the band, until it's seen. One at
            a time, the newest first: the others render nothing
            (LaunchCard). */}
        <PlanningLaunchCard onOpen={onOpenPlanningPage} />
        <GradesLaunchCard onOpen={onOpenGradesPage} />
        <div id="sidebar-section-applications">
          <AvailableApplications
            establishment={establishment}
            canUseServerLaunch={canUseServerLaunch}
            favoritesPortalTarget={favoritesPortalTarget}
            showDescriptions={showAppDescriptions}
            onOpenGradesPage={onOpenGradesPage}
            onOpenPlanningPage={onOpenPlanningPage}
          />
        </div>
      </div>

      {isLocationPickerOpen ? (
        <div
          className="weather-modal-backdrop fixed inset-0 z-40 bg-backdrop flex items-center justify-center p-5 animate-modal-backdrop-in max-md:p-[14px]"
          onClick={isLocationActionDisabled ? undefined : handleCloseLocationPicker}
          role="presentation"
        >
          <div
            className="weather-modal-card w-[min(440px,100%)] border border-border rounded-[22px] bg-bg shadow-none p-5 text-text animate-modal-card-in max-md:rounded-[20px] max-md:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Choisir le lieu de la météo"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-[14px]">
              <h3 className="m-0 text-[28px] font-bold leading-[0.95] tracking-[-0.01em] max-md:text-2xl">Choisir le lieu météo</h3>
              <button
                type="button"
                className="ml-auto w-[38px] h-[38px] p-0 border border-border-input rounded-full bg-bg-input text-text inline-flex items-center justify-center transition-[background-color,opacity] duration-[120ms] ease-in-out hover:not-disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait"
                onClick={handleCloseLocationPicker}
                disabled={isLocationActionDisabled}
                aria-label="Fermer la modale de lieu météo"
              >
                <Icon icon="carbon:close" className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form className="flex flex-col gap-[14px]" onSubmit={(event) => void handleSubmitLocation(event)}>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold leading-none text-text font-body">Ville ou code postal</span>
                <input
                  type="text"
                  className="w-full min-h-[48px] border border-border-input rounded-[53px] bg-bg-input text-text font-inherit text-base leading-none py-[13px] px-4 box-border placeholder:text-text-muted focus-visible:border-brand focus-visible:outline-none font-body"
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  placeholder={`Ex: ${DEFAULT_WEATHER_CITY} ou 35000`}
                  disabled={isLocationActionDisabled}
                />
              </label>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="submit"
                  className="min-h-[42px] px-[18px] border-0 rounded-[53px] bg-brand text-bg font-inherit text-[15px] font-semibold leading-none transition-[background-color,opacity] duration-[120ms] ease-in-out hover:not-disabled:bg-brand-hover disabled:opacity-60 disabled:cursor-wait"
                  disabled={isLocationActionDisabled}
                >
                  Appliquer
                </button>
                <button
                  type="button"
                  className="min-h-[42px] px-[18px] border border-border-input rounded-[53px] bg-bg-input text-text font-inherit text-[15px] font-semibold leading-none transition-[background-color,opacity] duration-[120ms] ease-in-out hover:not-disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait"
                  onClick={() => void handleUseCurrentPosition()}
                  disabled={isLocationActionDisabled}
                >
                  Ma position
                </button>
              </div>

              {locationError ? <p className="m-0 text-[13px] font-semibold leading-[1.15] text-error font-body">{locationError}</p> : null}
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default WidgetContainer
