import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import appsIcon from '../assets/home-icons/apps.png'
import averageIcon from '../assets/home-icons/average.png'
import calendarIcon from '../assets/home-icons/calendar.png'
import gradesIcon from '../assets/home-icons/grades.png'
import homeworkIcon from '../assets/home-icons/homework.png'
import mailIcon from '../assets/home-icons/mail.png'
import menuIcon from '../assets/home-icons/menu.png'
import { trackDashboardView } from '../analytics'
import { isWidgetAvailable } from '../dashboardWidgets'
import { getGrades, peekGrades } from '../entApi'
import { listGradesSemesters } from '../gradesReport'
import { buildGreeting } from '../greeting'
import { layoutHomeCards } from '../homeCardsLayout'
import { NEXT_CLASS_LOOKAHEAD_DAYS, buildNextClassCacheEntryKey, buildResourceIdsFromSelection } from '../upcomingClasses'
import useDailyBriefing from '../useDailyBriefing'
import { coverSourceRect, pickCreditInk } from '../wallpaperInk'
import GradesLaunchCard from './GradesLaunchCard'
import MailLaunchCard from './MailLaunchCard'
import PlanningLaunchCard from './PlanningLaunchCard'
import ServiceNotice from './ServiceNotice'
import WidgetAssiduity from './WidgetAssiduity'
import WidgetAverageGrade from './WidgetAverageGrade'
import WidgetDeadlines from './WidgetDeadlines'
import WidgetNextClasses from './WidgetNextClasses'
import WidgetRecentGrades from './WidgetRecentGrades'
import WidgetRecentMail from './WidgetRecentMail'
import { SHIMMER_CLASSES } from './widgetListUtils'
import { r } from '../register.js'
import HomeIcon from './HomeIcon'

// The row above the greeting, in place of the card's wave: each icon
// tilted its own way, on one line.
const GREETING_ICONS = [
  { src: appsIcon, rotate: -9 },
  { src: calendarIcon, rotate: 7 },
  { src: gradesIcon, rotate: -4 },
  { src: homeworkIcon, rotate: 10 },
  { src: mailIcon, rotate: -7 },
  { src: menuIcon, rotate: 6 },
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

// [grades, retry]: `retry()` asks again, past the cache.
function useNewestGrades(enabled) {
  const [grades, setGrades] = useState(() => readNewestGrades(enabled ? peekGrades()?.grades : null))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    getGrades({ force: attempt > 0 })
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
  }, [attempt, enabled])
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
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= minWidth))
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
      <div className="mt-auto grid gap-2" aria-hidden="true">
        <span className={`block h-8 w-28 rounded-full ${SHIMMER_CLASSES}`} />
        <span className={`block h-3 w-36 rounded-full ${SHIMMER_CLASSES}`} />
      </div>
    </article>
  )
}

// "rgb(r, g, b)" or "color(srgb r g b)" (a color-mix(), computed) → [r, g, b].
function parseCssColor(value) {
  const rgb = /rgba?\(([^)]+)\)/.exec(value)
  if (rgb) return rgb[1].split(/[\s,/]+/).slice(0, 3).map(Number)
  const srgb = /color\(srgb ([^)]+)\)/.exec(value)
  if (srgb) return srgb[1].split(/\s+/).slice(0, 3).map((channel) => Number(channel) * 255)
  return null
}

// 'light' or 'dark': the credit's ink, from the photo's pixels under it
// (wallpaperInk.js), as drawn: its opacity over the band's tint. Read again
// when the band or the credit changes size (it moves under the greeting
// when the line is full) or the theme changes; white if the pixels can't
// be read.
function useCreditInk(src, position, layerRef, creditRef) {
  const [ink, setInk] = useState('light')
  useEffect(() => {
    const layer = layerRef.current
    if (!src || !layer) return undefined
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    const measure = () => {
      if (cancelled || !image.naturalWidth) return
      const box = layer.getBoundingClientRect()
      const credit = creditRef.current?.getBoundingClientRect()
      if (!box.width || !box.height || !credit?.width) return
      const rect = coverSourceRect({
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        boxWidth: box.width,
        boxHeight: box.height,
        position,
        area: {
          left: credit.left - box.left,
          top: credit.top - box.top,
          width: credit.width,
          height: credit.height,
        },
      })
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 4
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
        const sum = [0, 0, 0]
        for (let index = 0; index < data.length; index += 4) {
          sum[0] += data[index]
          sum[1] += data[index + 1]
          sum[2] += data[index + 2]
        }
        const count = data.length / 4
        const opacity = Number(getComputedStyle(layer).opacity) || 1
        const backdrop = parseCssColor(getComputedStyle(layer.parentElement).backgroundColor) ?? [255, 255, 255]
        setInk(pickCreditInk(sum.map((channel) => channel / count), opacity, backdrop))
      } catch {
        setInk('light')
      }
    }
    image.addEventListener('load', measure)
    image.src = src
    const resize = new ResizeObserver(measure)
    resize.observe(layer)
    if (creditRef.current) resize.observe(creditRef.current)
    const themeChange = new MutationObserver(measure)
    themeChange.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', measure)
    return () => {
      cancelled = true
      image.removeEventListener('load', measure)
      resize.disconnect()
      themeChange.disconnect()
      scheme.removeEventListener('change', measure)
    }
  }, [src, position, layerRef, creditRef])
  return ink
}

// A line whose characters come into focus one after the other
// (.blur-in-char: opacity and blur, composited, a few ms apart, once).
// Read out whole: the characters are hidden from screen readers, the
// line carries the text. Keyed by its text, a new sentence plays again.
// Behind it, a soft blur of the band's tint: beside a long name the line
// runs over the photo, and stays readable.
// The greeting and the briefing reach over the photo's faded edge (a long
// name, a narrow band): a halo of the band's tint behind their letters
// keeps them readable whatever the photo holds there.
const BAND_TEXT_CLASSES = '[text-shadow:0_0_2px_var(--page-top-band,var(--color-bg)),0_0_10px_var(--page-top-band,var(--color-bg)),0_0_20px_var(--page-top-band,var(--color-bg))]'

const BLUR_IN_STEP_MS = 12
const BLUR_IN_MAX_DELAY_MS = 600
function BlurInText({ text }) {
  return (
    <p className="relative isolate m-0 text-[15px] font-medium leading-[1.35] text-text-secondary before:pointer-events-none before:absolute before:-inset-x-3 before:-inset-y-1.5 before:-z-10 before:rounded-full before:bg-[var(--page-top-band,var(--color-bg))] before:opacity-85 before:blur-[10px]" aria-label={text}>
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
  appsSlotRef = null,
}) {
  const displayName = userName?.trim() || ''
  // Anonymous analytics: one dashboard_viewed each time « Accueil » shows
  // (the ref outlives StrictMode's second effect run).
  const hasReportedViewRef = useRef(false)
  useEffect(() => {
    if (hasReportedViewRef.current) return
    hasReportedViewRef.current = true
    trackDashboardView()
  }, [])
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
  const wallpaperRef = useRef(null)
  const creditRef = useRef(null)
  const creditInk = useCreditInk(wallpaper?.src ?? null, wallpaper?.position ?? null, wallpaperRef, creditRef)
  const credit = wallpaper?.src ? wallpaper.credit : null
  const greeting = buildGreeting(displayName)

  return (
    <section className="home-draft-page w-full grid pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5" aria-labelledby="home-draft-title">
      <div className={`page-top-band @container/band flex flex-col gap-4 min-h-[160px] -mx-6 -mt-4 px-6 pt-4 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:gap-3 max-md:px-3 pb-6 max-md:pb-4 max-md:mt-[calc(-12px-var(--top-bar-height,0px))] max-md:pt-[calc(20px+var(--top-bar-height,0px))] max-md:min-h-[calc(136px+var(--top-bar-height,0px))]`}>
        {/* The wallpaper, when on: the band's right half and more, fading
            into the tint under the greeting; on a narrow band (a wide
            sidebar), a bit over half, so the briefing stays on the tint.
            On a phone the band runs up
            behind the app's top bar (App's --top-bar-height), the photo
            with it. Under the notch on the right too (landscape), as the
            band's tint is. */}
        {wallpaper?.src ? (
          <div
            ref={wallpaperRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-[calc(-1*env(safe-area-inset-right))] w-[70%] md:@max-[860px]/band:w-[55%] bg-cover bg-[center_40%] opacity-90 [mask-image:linear-gradient(to_right,transparent,black_55%)] dark:opacity-70 max-md:w-full max-md:opacity-50 max-md:[mask-image:linear-gradient(to_right,transparent,black_80%)]"
            style={{
              backgroundImage: `url("${wallpaper.src}")`,
              ...(wallpaper.position ? { backgroundPosition: wallpaper.position } : null),
            }}
          />
        ) : null}
        <div className="relative">
          <ServiceNotice />
        </div>
        <div className="relative mt-auto grid gap-1 min-w-0">
          {/* On arrival the icons come into focus one after the other
              (.home-icon-deal), each turning once as it lands (HomeIcon).
              Hovered, an icon grows a little with a springy overshoot,
              turns again and comes over its neighbours. */}
          <div className="mb-2 flex items-center gap-1.5" aria-hidden="true">
            {GREETING_ICONS.map(({ src, rotate }, index) => (
              <span
                key={src}
                className="home-icon-deal relative shrink-0 hover:z-10"
                style={{ '--i': index, '--r': `${rotate}deg`, transform: 'rotate(var(--r))' }}
              >
                <HomeIcon
                  src={src}
                  size={36}
                  order={index}
                  className="block size-9 select-none transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.8,0.5,1)] hover:scale-[1.15] motion-reduce:transition-none max-md:size-[30px]"
                />
              </span>
            ))}
          </div>
          {/* The day's briefing beside the greeting, on its baseline, then
              the photo's credit at the line's end; each goes under when the
              line is full (a phone, a long sentence). */}
          <div className={`flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 ${BAND_TEXT_CLASSES}`}>
            <h1 id="home-draft-title" className="m-0 min-w-0 truncate text-2xl font-bold leading-[1.15] max-md:text-[26px] max-md:tracking-[-0.01em]" title={greeting}>{greeting}</h1>
            {/* No loading state: the sentence comes in once it's known, its
                characters blurring into focus one after the other. */}
            {!briefing.loading && briefing.text ? <BlurInText key={briefing.text} text={briefing.text} /> : null}
            {/* White or black after the photo under it (useCreditInk). */}
            {credit?.author ? (
              <a
                ref={creditRef}
                className={`ml-auto max-w-[240px] shrink-0 truncate font-body text-[11px] font-medium leading-4 no-underline opacity-80 transition-opacity duration-150 hover:opacity-100 ${creditInk === 'light' ? 'text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]' : 'text-black [text-shadow:0_1px_2px_rgb(255_255_255/0.35)]'}`}
                href={credit.url || undefined}
                target="_blank"
                rel="noreferrer"
              >
                Photo : {credit.author}{credit.license ? `, ${credit.license}` : ''}
              </a>
            ) : null}
          </div>
        </div>
      </div>
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
                {grades.status === 'loading'
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
              // The card opens « Assiduité » (Enter or Space too), as
              // « Moyenne » opens « Mes notes ».
              <div
                data-card="assiduity"
                className={`${cellClasses('assiduity')} ${onOpenAssiduity ? 'cursor-pointer rounded-[31px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text' : ''}`}
                role={onOpenAssiduity ? 'link' : undefined}
                tabIndex={onOpenAssiduity ? 0 : undefined}
                aria-label={onOpenAssiduity ? 'Assiduité, voir la page' : undefined}
                onClick={onOpenAssiduity ?? undefined}
                onKeyDown={onOpenAssiduity ? (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  if (event.target !== event.currentTarget) return
                  event.preventDefault()
                  onOpenAssiduity()
                } : undefined}
              >
                <WidgetAssiduity payload={grades.payload} releve={grades.releve} config={grades.config} status={grades.status} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        // Every card hidden (Réglages › Accueil): where to bring
        // them back, in place of the grid.
        <div className={`pt-6 max-md:pt-4 ${CONTENT_MAX_CLASSES}`}>
          <div className="flex flex-col items-start gap-1 corners-[24px] border border-dashed border-text-30 px-5 py-6 max-md:px-4 max-md:py-5">
            <span className="flex items-center gap-[7px] font-body text-base font-semibold leading-[1.1] text-text">
              <Icon icon="ph:squares-four" className="size-[18px] shrink-0 opacity-70" aria-hidden="true" />
              Aucune carte sur l’accueil
            </span>
            <p className="m-0 font-body text-sm leading-[1.35] text-text-muted">{r('Choisis celles à afficher dans Réglages › Accueil', 'Choisissez celles à afficher dans Réglages › Accueil')}</p>
            {onOpenCardsSettings ? (
              <button
                type="button"
                onClick={onOpenCardsSettings}
                className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white bg-widget-bg px-3.5 py-2 font-body text-[14px] font-semibold leading-none text-text shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow duration-150 hover:shadow-[0_3px_10px_rgba(0,0,0,0.1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text dark:border-[var(--color-border)]"
              >
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
