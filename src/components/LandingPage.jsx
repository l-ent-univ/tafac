import { useEffect, useState, useSyncExternalStore } from 'react'
import universityConfig from '@university'
import appIcon from '../assets/landing/app-icon.webp'
import loginClouds from '../assets/login/login-clouds.webp'
import loginSky from '../assets/login/login-sky.webp'
import { buildLandingPreview } from '../landingPreview'
import { copy, copyText } from '../landingCopy'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import FeatureShowcase from './FeatureShowcase'
import FloatingWidgets from './FloatingWidgets'
import GreetingCard from './GreetingCard'
import LandingBeta from './LandingBeta'
import LandingContact from './LandingContact'
import LandingFaq from './LandingFaq'
import LandingFooter from './LandingFooter'
import LandingHeader from './LandingHeader'
import LaptopMockup from './LaptopMockup'
import LentButton from './LentButton'
import PapillonVision from './PapillonVision'
import UniversityMarquee from './UniversityMarquee'
import PhoneMockup from './PhoneMockup'
import SecurityShowcase from './SecurityShowcase'
import WidgetDeadlines from './WidgetDeadlines'
import WidgetLatestGrade from './WidgetLatestGrade'
import WidgetListStrip from './WidgetListStrip'
import WidgetNextClass from './WidgetNextClass'
import WidgetRecentMail from './WidgetRecentMail'

// Papillon's block at the end instead of the free/contact one (the same
// switch as every other mention, src/papillon.js).
const IS_PART_OF_PAPILLON = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride()) !== null

// The widgets move on to their next demo frame together: each frame stays
// HOLD_MS, then its text leaves upwards (OUT_MS) and the next one comes in
// from below (IN_MS). The first change waits for the intro.
const FIRST_HOLD_MS = 2000
const HOLD_MS = 1500
const OUT_MS = 450
const IN_MS = 600
// Empty but still a preview: the cards never fall back to loading real data.
const EMPTY_MAIL = { status: 'ok', unreadCount: 0, webmailHref: null, messages: [] }
const EMPTY_DEADLINES = { status: 'ok', moodleHref: null, items: [] }

// How many times the widgets have moved on (each one shows frame
// `step % frames`) and the text animation playing: 'out', 'in' or none yet
// (data-swap below, overrides.css).
function useFrameCycle() {
  const [cycle, setCycle] = useState({ step: 0, phase: null })

  useEffect(() => {
    let timeoutId = 0
    const leave = () => {
      setCycle((current) => ({ ...current, phase: 'out' }))
      timeoutId = window.setTimeout(enter, OUT_MS)
    }
    const enter = () => {
      setCycle((current) => ({ step: current.step + 1, phase: 'in' }))
      timeoutId = window.setTimeout(leave, IN_MS + HOLD_MS)
    }
    timeoutId = window.setTimeout(leave, FIRST_HOLD_MS)

    return () => window.clearTimeout(timeoutId)
  }, [])

  return cycle
}

// A computer: a mouse or trackpad that hovers (whatever the window's
// width). It shows the laptop with the features, then the phone; a phone or
// tablet the other way round. Followed if it changes (a tablet's keyboard
// with a trackpad).
const COMPUTER_QUERY = '(hover: hover) and (pointer: fine)'

function subscribeToComputerQuery(onChange) {
  const query = window.matchMedia(COMPUTER_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function useIsComputer() {
  return useSyncExternalStore(subscribeToComputerQuery, () => window.matchMedia(COMPUTER_QUERY).matches, () => false)
}

function frameAt(frames, step) {
  return frames.length > 0 ? frames[step % frames.length] : undefined
}

// A device mockup and a FeatureShowcase side by side: the device on the
// left, or on the right when `mirrored`; one under the other below 1024 px,
// the device first. As wide as the two (the device, the gap, the features'
// widest line), so the pair sits centred on the page: `wide` for the
// laptop, which takes more room than the phone.
function ShowcaseRow({ wide = false, mirrored = false, className = '', children }) {
  return (
    <div className={`relative z-20 flex justify-center px-6 max-md:px-4 ${className}`}>
      <div className={`flex w-full items-center max-4xl:flex-col max-4xl:gap-12 ${wide ? 'max-w-[1240px] gap-14' : 'max-w-[920px] gap-16'} ${mirrored ? 'flex-row-reverse' : ''}`}>
        {children}
      </div>
    </div>
  )
}

// The public home page, shown at / while signed out: for now the dashboard's
// widgets on demo data, as WidgetContainer lays them out.
function LandingPage({ onLogin }) {
  const [preview] = useState(() => buildLandingPreview())
  const [areWidgetsVisible, setAreWidgetsVisible] = useState(false)
  const { step, phase } = useFrameCycle()
  const greeting = frameAt(preview.greetings, step)
  const isComputer = useIsComputer()

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setAreWidgetsVisible(true), 140)
    return () => window.clearTimeout(timeoutId)
  }, [])

  return (
    <>
      {/* The first screen: at least the window's height, so the device mockups
          (and the phone's flower) start below the fold, never peeking in on load. */}
      <div className="flex min-h-svh flex-col">
        {/* The header, then the dashboard's frosted cards (as over its wallpaper),
            on a band of sky. */}
        <section
          className="landing-widgets select-none relative w-full grid gap-10 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-8"
          aria-label="Widgets"
          data-swap={phase ?? undefined}
        >
          <div className="relative isolate overflow-hidden -mx-6 -mt-4 px-6 pt-4 pb-7 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:px-3 max-md:pt-3 max-md:pb-5">
            {/* The login page's sky and clouds, the clouds along the bottom
                where the title sits. On narrow phones, where the band is short,
                lower still: the header stays on the sky's plain blue. */}
            <img src={loginSky} alt="" aria-hidden="true" draggable="false" className="landing-scroll-sky absolute inset-0 -z-10 size-full object-cover dark:brightness-[0.55]" />
            <img src={loginClouds} alt="" aria-hidden="true" draggable="false" className="landing-scroll-clouds pointer-events-none absolute bottom-0 left-1/2 -z-10 w-[max(1300px,140%)] max-w-none -translate-x-1/2 translate-y-[45%] dark:brightness-[0.6] max-md:w-[900px] max-xs:translate-y-[62%]" />
            <LandingHeader onLogin={onLogin} />
            <div className="landing-scroll-cards widget-row flex flex-wrap gap-3 items-stretch max-md:gap-2 overflow-visible p-2 -m-2">
              <GreetingCard displayName={greeting?.displayName ?? ''} greeting={greeting?.greeting ?? null} visible={areWidgetsVisible} />
              <div className="contents">
                <WidgetNextClass visible={areWidgetsVisible} preview={frameAt(preview.upcomingEvents, step) ?? []} />
              </div>
              <div className="contents">
                {preview.latestGrades.length > 0 ? (
                  <WidgetLatestGrade visible={areWidgetsVisible} preview={frameAt(preview.latestGrades, step)} />
                ) : null}
                {/* Left out on phones, where they would be under the title. */}
                <div className="contents max-md:hidden">
                  <WidgetListStrip labels={['Mails récents', 'Échéances']} visible={areWidgetsVisible}>
                    <WidgetRecentMail key="mail" visible={areWidgetsVisible} preview={frameAt(preview.mail, step) ?? EMPTY_MAIL} />
                    <WidgetDeadlines key="deadlines" visible={areWidgetsVisible} preview={frameAt(preview.deadlines, step) ?? EMPTY_DEADLINES} />
                  </WidgetListStrip>
                </div>
              </div>
            </div>
            {/* The bottom of the band (the sky and the bottom cards' last lines)
                fades into the page colour, under the title. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[140px] bg-linear-to-b from-transparent via-bg/60 via-50% to-bg max-md:h-[40px]" />
          </div>
        </section>
        {/* Pulled up so the title's middle sits on the band's last row of cards
            (its height: two lines on wide screens). On phones, under the cards
            instead, the app icon just overlapping the band's edge: the
            schedule and the grade stay in full view. */}
        <div className="relative z-20 flex flex-col items-center px-6 pb-12 -mt-[115px] max-md:-mt-[4px] max-md:px-4 max-md:pb-10">
          <div className="landing-cta flex w-full flex-col items-center">
            <div className="relative">
              {/* The app's icon, as on a home screen (the PWA's own). */}
              <div className="absolute inset-x-0 bottom-full mb-5 flex justify-center max-md:mb-4">
                <img
                  src={appIcon}
                  alt=""
                  width="240"
                  height="240"
                  draggable="false"
                  className="landing-app-icon block size-20 rounded-[22.5%] shadow-[0_2px_6px_rgb(52_18_0/0.12),0_14px_32px_-10px_rgb(52_18_0/0.35)] max-md:size-16"
                />
              </div>
              <h1 className="m-0 max-w-[24ch] text-balance text-center text-[clamp(36px,5vw,64px)] font-bold leading-[0.95] text-text">
                {copyText(copy.hero.title)}
              </h1>
            </div>
            <p className="m-0 mt-5 max-w-[40ch] text-balance text-center text-lg font-medium leading-snug text-text-muted font-body max-md:mt-4 max-md:text-base">
              {copyText(copy.hero.subtitle)}
            </p>
            <LentButton className="mt-7 min-h-[60px]! px-9! text-[19px]! max-md:mt-6" onClick={onLogin}>
              {copyText(copy.hero.cta)}
            </LentButton>
            {/* What Tafac is, right where it asks for the ENT password. */}
            <p className="m-0 mt-3 max-w-[62ch] text-balance text-center text-[13px] font-semibold leading-snug text-text-secondary font-body">
              {copyText(copy.hero.disclaimer)}
            </p>
            <UniversityMarquee className="mt-10 w-[min(640px,90vw)] max-md:mt-8" />
          </div>
        </div>
      </div>
      {/* The first device (the one in hand: the laptop on a computer, the
          phone otherwise) with what the app does, then the other one with
          other sides of it, mirrored. The top padding clears the first
          device's flower (and its scroll parallax) from the first screen. The
          second device shows the app in its dark theme. */}
      {isComputer ? (
        <>
          <ShowcaseRow wide className="pt-24 pb-24 max-md:pt-20 max-md:pb-16">
            <LaptopMockup decorated className="w-[min(700px,58%)] shrink-0 max-4xl:w-full max-4xl:max-w-[760px]" />
            <FeatureShowcase className="min-w-0 flex-1" />
          </ShowcaseRow>
          <ShowcaseRow mirrored className="pt-8 pb-28 max-md:pt-4 max-md:pb-20">
            <div className="landing-device w-[min(300px,72vw)] shrink-0">
              <PhoneMockup decorated={false} darkScreen />
            </div>
            <FeatureShowcase variant="phone" className="min-w-0 flex-1" />
          </ShowcaseRow>
        </>
      ) : (
        <>
          <ShowcaseRow className="pt-24 pb-24 max-md:pt-20 max-md:pb-16">
            <PhoneMockup className="w-[min(300px,72vw)] shrink-0" />
            <FeatureShowcase className="min-w-0 flex-1" />
          </ShowcaseRow>
          <ShowcaseRow wide mirrored className="pt-8 pb-28 max-md:pt-4 max-md:pb-20">
            <div className="landing-device w-[min(700px,58%)] shrink-0 max-4xl:w-full max-4xl:max-w-[760px]">
              <LaptopMockup darkScreen />
            </div>
            <FeatureShowcase variant="computer" className="min-w-0 flex-1" />
          </ShowcaseRow>
        </>
      )}
      {/* What happens to the password and the data, then who makes Tafac:
          Papillon's team and vision while it shows it's part of Papillon,
          otherwise free, the team and how to reach them. */}
      <SecurityShowcase className="pb-20 max-md:pb-14" />
      {/* What students ask before signing in. */}
      <LandingFaq className="pb-24 max-md:pb-16" />
      {/* A word from the team: it's still in beta. */}
      <LandingBeta className="pb-24 max-md:pb-16" />
      {/* The end of the page on a glow rising from the bottom (Papillon's
          green, Tafac's yellow and sky): the last block with the widgets
          floating around it, then the footer. */}
      {/* Clipped across only: a widget drifting up may cross the top. */}
      <div className="relative isolate overflow-x-clip">
        <div aria-hidden="true" className="landing-papillon-glow pointer-events-none absolute inset-0 -z-10" />
        <div className="relative mx-auto w-full max-w-[1240px] pb-10 max-md:pb-6">
          {IS_PART_OF_PAPILLON ? <PapillonVision /> : <LandingContact />}
          <FloatingWidgets />
        </div>
        <LandingFooter onLogin={onLogin} />
      </div>
    </>
  )
}

export default LandingPage
