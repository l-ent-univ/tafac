import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import appsIcon from '../assets/home-icons/apps.png'
import averageIcon from '../assets/home-icons/average.png'
import calendarIcon from '../assets/home-icons/calendar.png'
import gradesIcon from '../assets/home-icons/grades.png'
import homeworkIcon from '../assets/home-icons/homework.png'
import mailIcon from '../assets/home-icons/mail.png'
import menuIcon from '../assets/home-icons/menu.png'
import { trackDashboardReturn, trackDashboardView } from '../analytics'
import { isWidgetAvailable } from '../dashboardWidgets'
import { getGrades, peekGrades } from '../entApi'
import { listGradesSemesters } from '../gradesReport'
import { buildGreeting } from '../greeting'
import { layoutHomeCards } from '../homeCardsLayout'
import { isInHiddenPage } from '../keptPages'
import { usePageReturn, usePageVisit } from '../pageVisit'
import { NEXT_CLASS_LOOKAHEAD_DAYS, buildNextClassCacheEntryKey, buildResourceIdsFromSelection } from '../upcomingClasses'
import useDailyBriefing from '../useDailyBriefing'
import GradesLaunchCard from './GradesLaunchCard'
import MailLaunchCard from './MailLaunchCard'
import PlanningLaunchCard from './PlanningLaunchCard'
import ServiceNotice from './ServiceNotice'
import WidgetAssiduity from './WidgetAssiduity'
import WidgetAverageGrade, { AverageGradeValues } from './WidgetAverageGrade'
import WidgetDeadlines from './WidgetDeadlines'
import WidgetNextClasses from './WidgetNextClasses'
import WidgetRecentGrades from './WidgetRecentGrades'
import WidgetRecentMail from './WidgetRecentMail'
import { Skeleton } from 'skullet/react'
import { useSkeletonsForced } from '../skeletonSamples'
import { r } from '../register.js'
import HomePhoneHeader from './HomePhoneHeader'
import { homeIconActions } from '../homeIconActions'
import { usePhoneViewport } from '../usePhoneViewport'
import SmoothSurface from './SmoothSurface'

// The row above the greeting, in place of the card's wave: each icon
// tilted its own way, on one line.
// `id`: what the icon stands for (src/homeIconActions.js: on a phone each is
// a way in, and the ones without a page aren't shown).
const GREETING_ICONS = [
  { id: 'apps', src: appsIcon, rotate: -9 },
  { id: 'calendar', src: calendarIcon, rotate: 7 },
  { id: 'grades', src: gradesIcon, rotate: -4 },
  { id: 'homework', src: homeworkIcon, rotate: 10 },
  { id: 'mail', src: mailIcon, rotate: -7 },
  { id: 'menu', src: menuIcon, rotate: 6 },
]

// The newest semester (the first-connection answer holds its relevé), for
// « Moyenne générale » and « Dernières notes »: the shared grades cache
// first, then its refresh. { releve, config, semesterId, status }, status
// 'loading', 'ok', 'empty' (signed in, no relevé) or 'error' (the request
// failed: « Dernières notes » says so, with « Réessayer »).
function readNewestGrades(payload, status = payload?.['relevé'] ? 'ok' : 'loading') {
  return {
    // The whole answer: « Assiduité » reads its `absences`.
    payload: payload ?? null,
    releve: payload?.['relevé'] ?? null,
    config: payload?.config ?? null,
    semesterId: listGradesSemesters(payload?.semestres)[0]?.id ?? null,
    status,
  }
}

// [grades, retry]: `retry()` asks again, past the cache. Back on the page
// where it is kept mounted (the iOS app, src/pageVisit.js), asked as a
// mount would: the cache while fresh, behind the cards shown.
function useNewestGrades(enabled) {
  const [grades, setGrades] = useState(() => readNewestGrades(enabled ? peekGrades()?.grades : null))
  const [attempt, setAttempt] = useState(0)
  const visit = usePageVisit()
  const askedVisitRef = useRef(visit)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    const returned = askedVisitRef.current !== visit
    askedVisitRef.current = visit
    getGrades({ force: attempt > 0 && !returned })
      .then((data) => {
        if (!active) return
        if (data?.grades?.['relevé']) setGrades(readNewestGrades(data.grades))
        else if (data?.authenticated && !data.error && !data.disabled) setGrades((current) => (current.releve ? current : readNewestGrades(null, 'empty')))
        else setGrades((current) => (current.releve ? current : readNewestGrades(null, 'error')))
      })
      .catch(() => {
        if (active) setGrades((current) => (current.releve ? current : readNewestGrades(null, 'error')))
      })
    return () => {
      active = false
    }
  }, [attempt, enabled, visit])
  const retry = useCallback(() => {
    setGrades(readNewestGrades(null, 'loading'))
    setAttempt((current) => current + 1)
  }, [])
  return [grades, retry]
}

// A cell of the cards' grid: its card fills it (whatever width or height the
// card had on the dashboard), gone when the card renders nothing.
const CELL_CLASSES = 'flex min-w-0 empty:hidden [&>*]:min-w-0 [&>*]:flex-1 [&>*]:max-w-none'
// Each card's place (layoutHomeCards), from 600px of page width: below, one
// column. 'tall' runs two rows; its cell doesn't size them (contain: size),
// the cards beside it do, at least two classes high.
const PLACE_CLASSES = {
  tall: '@min-[600px]:row-span-2 @min-[600px]:[contain:size] @min-[600px]:min-h-[264px]',
  half: '',
  full: 'col-span-full',
}
// Past this width the cards (and the favourites over them) stop growing,
// on the left as the other pages' cards: a class's block, a mail's row
// stay readable at a glance on a wide screen.
const CONTENT_MAX_CLASSES = 'max-w-[1320px]'

// The cards drawn, in the grid's order: a card can render nothing
// (« Moyenne » without an average, a mailbox switched off, a semester
// without grades), its cell empty; the grid is laid out over the others.
// Read after each render, and when a card comes or goes in its cell.
function useDrawnCards(gridRef) {
  const [drawn, setDrawn] = useState([])
  useLayoutEffect(() => {
    const grid = gridRef.current
    const read = () => {
      const ids = grid ? [...grid.children].filter((cell) => cell.childElementCount > 0).map((cell) => cell.dataset.card) : []
      setDrawn((current) => (current.join() === ids.join() ? current : ids))
    }
    read()
    if (!grid) return undefined
    const observer = new MutationObserver(read)
    for (const cell of grid.children) observer.observe(cell, { childList: true })
    return () => observer.disconnect()
  })
  return drawn
}

// Whether the element is at least `minWidth` wide (the grid's two columns);
// `mounted`: the element is there (watched again when it comes back).
function useMinWidth(minWidth, mounted) {
  const ref = useRef(null)
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    setWide(element.clientWidth >= minWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (!isInHiddenPage(element)) setWide(entry.contentRect.width >= minWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [minWidth, mounted])
  return [ref, wide]
}

// « Moyenne générale » while the grades load: its place kept, so the grid
// doesn't move when the average comes in.
function AveragePlaceholder() {
  return (
    <article
      className="widget-card widget-card-visible flex min-h-[188px] flex-col gap-[6px] border border-white bg-widget-bg p-4 text-text shadow-md card-corners max-md:min-h-[160px] max-md:p-3"
      aria-label="Moyenne générale, chargement"
      aria-busy="true"
    >
      <div className="flex min-w-0 items-center gap-[5px]">
        <img src={averageIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
        <span className="min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Moyenne générale</span>
      </div>
      {/* The figures' skeleton (skullet), measured from sample ones. */}
      <Skeleton loading label="Chargement de la moyenne" className="mt-auto flex">
        <AverageGradeValues avgDisplay="14.5" promoDisplay="12.44" />
      </Skeleton>
    </article>
  )
}

// A line whose characters come into focus one after the other
// (.blur-in-char: opacity and blur, composited, a few ms apart, once).
// Read out whole: the characters are hidden from screen readers, the
// line carries the text. Keyed by its text, a new sentence plays again.
const BLUR_IN_STEP_MS = 12
const BLUR_IN_MAX_DELAY_MS = 600
function BlurInText({ text }) {
  return (
    <p className="relative isolate m-0 text-[15px] font-medium leading-[1.35] text-text-secondary" aria-label={text}>
      {Array.from(text, (character, index) => (
        <span
          key={index}
          className="blur-in-char"
          style={{ '--delay': `${Math.min(index * BLUR_IN_STEP_MS, BLUR_IN_MAX_DELAY_MS)}ms` }}
          aria-hidden="true"
        >
          {character}
        </span>
      ))}
    </p>
  )
}

// « Accueil » (sidebar, below « Toutes les applications »): a canvas for a
// new home screen. For now its tinted top band (Mes notes' page-top-band)
// with the dashboard greeting inline: a row of icons, « Bonjour … » (or
// « Bonsoir », src/greeting.js) and the
// day's briefing, read from the same sources as the greeting card (the
// dashboard stays mounted behind, its cards publish them), the wallpaper
// (when on) on the band's right. Below the band, the
// « Prochains cours » card (WidgetNextClasses) and, where « Mes notes »
// exists, its « Moyenne générale » card and « Dernières notes »
// (WidgetRecentGrades), the dashboard's « Échéances » and « Mails récents ». Above
// them, « Applications » (the favourites). With every card hidden, the way
// back to them: Réglages › Accueil (`onOpenCardsSettings`).
function HomeDraftPage({
  userName = '',
  sessionUser = null,
  establishment = null,
  selection = null,
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
  hiddenWidgets = [],
  debugNextClass = false,
  wallpaper = null,
  onOpenPlanningDay = null,
  showAverage = false,
  onOpenGrade = null,
  onOpenGrades = null,
  onOpenMail = null,
  onOpenCardsSettings = null,
  onOpenGradesPage = null,
  onOpenPlanningPage = null,
  onOpenMailPage = null,
  // « Assiduité »'s card, where the page exists (with « Mes notes »): the
  // card opens it.
  showAssiduity = false,
  onOpenAssiduity = null,
  // « Justifier » from the card's marks: where the page can (the Messagerie
  // writes the mail).
  assiduityJustifies = false,
  appsSlotRef = null,
  // The header on a phone (HomePhoneHeader): the logos as the student set
  // them, their photo and Mon compte, and what its icons open besides the
  // pages above (« Toutes les applications », Moodle).
  showUniversityLogo = true,
  logoSource = 'establishment',
  profilePhotoSrc = null,
  onOpenAccount = null,
  onOpenAllApps = null,
  onOpenMoodle = null,
}) {
  const skeletonsForced = useSkeletonsForced()
  const displayName = userName?.trim() || ''
  // Anonymous analytics: one dashboard_viewed each time « Accueil » shows
  // (the ref outlives StrictMode's second effect run).
  const hasReportedViewRef = useRef(false)
  useEffect(() => {
    if (hasReportedViewRef.current) return
    hasReportedViewRef.current = true
    trackDashboardView()
  }, [])
  usePageReturn(trackDashboardReturn)
  const isShown = (widgetId) => isWidgetAvailable(widgetId, establishment) && !hiddenWidgets.includes(widgetId)
  // As the dashboard's greeting: classes from the shown card's loads, its own
  // load when the student hid the card, none without the widget.
  const classesSource = debugNextClass || !isWidgetAvailable('nextClass', establishment)
    ? null
    : hiddenWidgets.includes('nextClass') ? 'self' : 'card'
  const classesCacheKey = useMemo(() => buildNextClassCacheEntryKey(
    sessionUser,
    buildResourceIdsFromSelection(selection).join('|'),
    lookaheadDays,
  ), [lookaheadDays, selection, sessionUser])
  const briefing = useDailyBriefing({
    classesSource,
    classesCacheKey,
    selection,
    lookaheadDays,
    expectDeadlines: isShown('deadlines'),
  })
  // `showAverage`: « Mes notes » exists; each of its two cards can be hidden
  // in Réglages › Accueil.
  const showAverageCard = showAverage && !hiddenWidgets.includes('average')
  const showRecentGrades = showAverage && !hiddenWidgets.includes('latestGrade')
  const showAssiduityCard = showAssiduity && !hiddenWidgets.includes('assiduity')
  const [grades, retryGrades] = useNewestGrades(showAverageCard || showRecentGrades || showAssiduityCard)
  const anyCard = isShown('nextClass') || showAverageCard || showRecentGrades || isShown('deadlines') || isShown('mail') || showAssiduityCard
  const gridRef = useRef(null)
  const [gridBoxRef, twoColumns] = useMinWidth(600, anyCard)
  const place = layoutHomeCards(useDrawnCards(gridRef))
  const cellClasses = (id) => `${CELL_CLASSES} ${PLACE_CLASSES[place[id]] ?? ''}`
  const greeting = buildGreeting(displayName)
  // « Accueil »'s header (HomePhoneHeader), its wide variant beside the
  // sidebar.
  const isPhone = usePhoneViewport()
  const phoneIcons = homeIconActions({
    allApps: onOpenAllApps,
    planning: onOpenPlanningPage ? () => onOpenPlanningPage('home_icon') : null,
    grades: onOpenGradesPage ? () => onOpenGradesPage('home_icon') : null,
    moodle: onOpenMoodle,
    mail: onOpenMailPage ? () => onOpenMailPage('home_icon') : null,
  }).map((action) => ({ ...GREETING_ICONS.find((icon) => icon.id === action.id), ...action }))

  return (
    <section className="home-draft-page w-full grid pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5" aria-labelledby="home-draft-title">
      <HomePhoneHeader
        wide={!isPhone}
        greeting={greeting}
        briefing={!briefing.loading && briefing.text ? <BlurInText key={briefing.text} text={briefing.text} /> : null}
        briefingPending={briefing.loading}
        wallpaper={wallpaper}
        icons={phoneIcons}
        establishment={establishment}
        showUniversityLogo={showUniversityLogo}
        logoSource={logoSource}
        userName={displayName}
        profilePhotoSrc={profilePhotoSrc}
        onOpenAccount={onOpenAccount}
      />
      {/* A page just launched (the Messagerie, the Planning, « Mes notes »):
          a compact card under the band until it's seen. One at a time, the
          newest first: the others render nothing (LaunchCard). */}
      <div className={`min-w-0 ${CONTENT_MAX_CLASSES}`}>
        <MailLaunchCard onOpen={onOpenMailPage} />
        <PlanningLaunchCard onOpen={onOpenPlanningPage} />
        <GradesLaunchCard onOpen={onOpenGradesPage} />
      </div>
      {/* « Applications »: the favourites as tiles, portalled here by the
          dashboard's app list (AvailableApplications), which launches them. */}
      <div ref={appsSlotRef} className={`min-w-0 pt-6 empty:hidden max-md:pt-4 ${CONTENT_MAX_CLASSES}`} />
      {anyCard ? (
        // On the page's width (a container query: the sidebar can be
        // resized): one column on a phone; from 600px, two, the cards
        // placed by layoutHomeCards over the cards drawn: « Prochains
        // cours » down the left beside « Moyenne » over « Mails », then
        // « Dernières notes » beside « Échéances »; without some, the others
        // two by two, a card left alone across its row. A card fills its
        // cell, so the cards of a row end level. « Prochains cours » down
        // the left shows the classes that fit the height the cards beside
        // it give (`fill`); elsewhere it's as tall as its classes.
        <div ref={gridBoxRef} className={`@container min-w-0 pt-6 max-md:pt-4 ${CONTENT_MAX_CLASSES}`}>
          <div ref={gridRef} className="grid grid-cols-1 gap-3 max-md:gap-2 @min-[600px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {isShown('nextClass') ? (
              <div data-card="nextClass" className={cellClasses('nextClass')}>
                <WidgetNextClasses
                  selection={selection}
                  sessionUser={sessionUser}
                  lookaheadDays={lookaheadDays}
                  onOpenPlanningDay={onOpenPlanningDay}
                  fill={twoColumns && place.nextClass === 'tall'}
                />
              </div>
            ) : null}
            {showAverageCard ? (
              // The card opens « Mes notes » (Enter or Space too).
              <div
                data-card="average"
                className={`${cellClasses('average')} ${onOpenGrades ? 'cursor-pointer rounded-[31px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text' : ''}`}
                role={onOpenGrades ? 'link' : undefined}
                tabIndex={onOpenGrades ? 0 : undefined}
                aria-label={onOpenGrades ? 'Moyenne générale, voir Mes notes' : undefined}
                // Not from the card's own buttons (the approximate average's
                // « ? »): they keep their own action.
                onClick={onOpenGrades ? (event) => {
                  if (event.target.closest('button, a')) return
                  onOpenGrades()
                } : undefined}
                onKeyDown={onOpenGrades ? (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  if (event.target !== event.currentTarget) return
                  event.preventDefault()
                  onOpenGrades()
                } : undefined}
              >
                {grades.status === 'loading' || skeletonsForced
                  ? <AveragePlaceholder />
                  : <WidgetAverageGrade releve={grades.releve} visible icon={averageIcon} />}
              </div>
            ) : null}
            {isShown('mail') ? (
              <div data-card="mail" className={cellClasses('mail')}>
                <WidgetRecentMail visible large icon={mailIcon} onOpenMail={onOpenMail} />
              </div>
            ) : null}
            {showRecentGrades ? (
              <div data-card="latestGrade" className={cellClasses('latestGrade')}>
                <WidgetRecentGrades
                  releve={grades.releve}
                  config={grades.config}
                  semesterId={grades.semesterId}
                  sessionUser={sessionUser}
                  status={grades.status}
                  onRetry={retryGrades}
                  onOpenGrade={onOpenGrade}
                />
              </div>
            ) : null}
            {isShown('deadlines') ? (
              <div data-card="deadlines" className={cellClasses('deadlines')}>
                <WidgetDeadlines visible large icon={homeworkIcon} />
              </div>
            ) : null}
            {showAssiduityCard ? (
              // A click on the card opens « Assiduité », as « Moyenne » opens
              // « Mes notes ». Not a link itself: its marks are buttons, so
              // the keyboard's way to the page is the card's title
              // (WidgetAssiduity's Header).
              <div
                data-card="assiduity"
                className={`${cellClasses('assiduity')} ${onOpenAssiduity ? 'cursor-pointer' : ''}`}
                onClick={onOpenAssiduity ? () => onOpenAssiduity() : undefined}
              >
                <WidgetAssiduity
                  payload={grades.payload}
                  releve={grades.releve}
                  config={grades.config}
                  status={grades.status}
                  onOpen={onOpenAssiduity ? (id, action) => onOpenAssiduity({ id, action }) : null}
                  justifies={assiduityJustifies}
                  onOpenPage={onOpenAssiduity ? () => onOpenAssiduity() : null}
                  onOpenPlanning={onOpenPlanningDay}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        // Every card hidden (Réglages › Accueil): where to bring
        // them back, in place of the grid.
        <div className={`pt-6 max-md:pt-4 ${CONTENT_MAX_CLASSES}`}>
          <div className="engraved flex flex-col items-start gap-1 corners-[24px] px-5 py-6 max-md:px-4 max-md:py-5">
            <span className="flex items-center gap-[7px] font-body text-base font-semibold leading-[1.1] text-text">
              <Icon icon="ph:squares-four" className="size-[18px] shrink-0 opacity-70" aria-hidden="true" />
              Aucune carte sur l’accueil
            </span>
            <p className="m-0 font-body text-sm leading-[1.35] text-text-muted">{r('Choisis celles à afficher dans Réglages › Accueil', 'Choisissez celles à afficher dans Réglages › Accueil')}</p>
            {onOpenCardsSettings ? (
              <button
                type="button"
                onClick={onOpenCardsSettings}
                className="material mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 font-body text-[14px] font-semibold leading-none text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
              >
                <SmoothSurface />
                <Icon icon="ph:layout" className="size-4 shrink-0" aria-hidden="true" />
                Choisir les cartes
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

export default HomeDraftPage
