import { useEffect, useRef, useState } from 'react'
import universityConfig from '@university'
import heroVideo from '../assets/landing/landing-hero.mp4'
import heroPoster from '../assets/landing/landing-hero-poster.webp'
import heroStill from '../assets/landing/landing-hero-still.webp'
import heroVideoDark from '../assets/landing/landing-hero-dark.mp4'
import heroPosterDark from '../assets/landing/landing-hero-dark-poster.webp'
import heroStillDark from '../assets/landing/landing-hero-dark-still.webp'
import { buildLandingPreview } from '../landingPreview'
import { copy, copyText } from '../landingCopy'
import { useVisiblePlayback } from '../landingMotion'
import { useIsDarkTheme } from '../useUeColor'
import { listShowcaseTabs, showsFilm } from '../landingShowcase'
import { scrollToShowcaseTab } from '../landingShowcaseScroll'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import FeatureShowcase from './FeatureShowcase'
import FilmShowcase from './FilmShowcase'
import FloatingWidgets from './FloatingWidgets'
import LandingBeta from './LandingBeta'
import LandingContact from './LandingContact'
import LandingFaq from './LandingFaq'
import LandingFooter from './LandingFooter'
import LandingHeader from './LandingHeader'
import LandingShowcase from './LandingShowcase'
import LentButton from './LentButton'
import PapillonVision from './PapillonVision'
import UniversityMarquee from './UniversityMarquee'
import SecurityShowcase from './SecurityShowcase'

// Papillon's block at the end instead of the free/contact one (the same
// switch as every other mention, src/papillon.js).
const IS_PART_OF_PAPILLON = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride()) !== null
// The app's pages the showcase presents: all of them on the neutral page, a
// university's own on its page (src/landingShowcase.js).
const SHOWCASE_TABS = listShowcaseTabs(universityConfig)
// The film of every page on a phone, where the university has them all
// (src/landingShowcase.js); the device section otherwise.
const SHOWS_FILM = showsFilm(universityConfig)

// The phone's film, in the theme's colours (the dark theme's own render, on
// its near-black). With reduced motion it doesn't play: it shows its last
// frame (the phone facing the viewer), not its first (the phone's back).
const HERO_FILMS = {
  light: { src: heroVideo, poster: heroPoster, still: heroStill },
  dark: { src: heroVideoDark, poster: heroPosterDark, still: heroStillDark },
}

// LandingPage keys it by theme: a flip mounts the other film, playing as
// this one did.
function HeroFilm({ theme }) {
  const film = HERO_FILMS[theme]
  const videoRef = useRef(null)
  useVisiblePlayback(videoRef)
  useEffect(() => {
    const video = videoRef.current
    if (video && window.matchMedia('(prefers-reduced-motion: reduce)').matches) video.poster = film.still
  }, [film])

  return (
    <video
      ref={videoRef}
      src={film.src}
      poster={film.poster}
      width="1200"
      height="1500"
      muted
      playsInline
      preload="auto"
      aria-label="Tafac sur un téléphone : l'accueil, ses applications et les prochains cours"
      className="absolute inset-0 block size-full object-cover max-md:object-[50%_70%]"
    />
  )
}

// The public home page, shown at / while signed out: what Tafac is beside a
// film of the app on a phone, then the app page by page (LandingShowcase),
// on a computer and a phone, its privacy, the questions students ask and who
// makes it.
function LandingPage({ onLogin }) {
  const [preview] = useState(() => buildLandingPreview())
  const [selectedShowcaseTab, setShowcaseTabId] = useState(SHOWCASE_TABS[0]?.id ?? null)
  const isDark = useIsDarkTheme()

  // An address to a page's panel (/#messagerie): that tab, scrolled to
  // once shown (a hidden panel can't be scrolled to by the browser).
  useEffect(() => {
    let id = ''
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      // Not an address of this page (/#%): no tab.
    }
    const index = SHOWCASE_TABS.findIndex((tab) => tab.id === id)
    if (index < 0) return
    setShowcaseTabId(id)
    window.requestAnimationFrame(() => scrollToShowcaseTab(index, { smooth: false }))
  }, [])

  return (
    <>
      {/* The first screen: the showcase follows straight on (no longer held
          a window's height: on tall screens that left a band of blank). */}
      {/* The first screen, on the film's own grey (#eee, which browsers
          decode as #f0f0f0) so the film has no edges (.landing-first): the
          header, then what Tafac is and the way in on the left, the film on
          the whole right half, from under the header to the window's bottom.
          The phone comes in and settles close up, played once and held on
          its last frame. On phones and tablets, the film first across the
          width, fading at its bottom into the title. */}
      <div className="landing-first flex flex-col md:min-h-[max(640px,100svh)]">
        <div className="pt-4 4xl:pt-5 max-md:pt-3">
          <LandingHeader onLogin={onLogin} />
        </div>
        <section className="grid grid-cols-[minmax(0,1fr)] md:flex-1 md:grid-cols-2 md:grid-rows-[1fr_auto_auto_1fr]">
          <div className="landing-cta relative z-10 flex flex-col items-center px-6 text-center md:col-start-1 md:row-start-2 md:items-start md:pr-12 md:pl-[max(24px,calc((100vw-1240px)/2))] md:text-left max-md:-mt-14 max-sm:px-4">
            <h1 className="m-0 max-w-[16ch] text-balance text-[clamp(36px,5vw,64px)] font-bold leading-[0.95] text-text">
              {copyText(universityConfig.neutral ? copy.hero.title : copy.hero.universityTitle)}
            </h1>
          </div>
          <div className="relative select-none overflow-hidden bg-(--landing-first-bg) md:col-start-2 md:row-[1/-1] max-md:order-first max-md:aspect-square max-md:max-h-[64svh] max-md:w-full">
            <HeroFilm key={isDark ? 'dark' : 'light'} theme={isDark ? 'dark' : 'light'} />
            {/* On phones and tablets, the phone fades out under the title. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-b from-transparent to-(--landing-first-bg) md:hidden" />
          </div>
          <div className="landing-cta flex flex-col items-center px-6 pb-12 text-center md:col-start-1 md:row-start-3 md:items-start md:pb-0 md:pr-12 md:pl-[max(24px,calc((100vw-1240px)/2))] md:text-left max-md:pt-6 max-sm:px-4 max-sm:pb-8">
            <p className="m-0 max-w-[40ch] text-balance text-lg font-medium leading-snug text-text-muted font-body md:mt-5 max-md:text-base">
              {copyText(copy.hero.subtitle)}
            </p>
            <LentButton className="mt-7 min-h-[60px]! px-9! text-[19px]! max-md:mt-6" onClick={onLogin}>
              {copyText(copy.hero.cta)}
            </LentButton>
            {/* What Tafac is, right where it asks for the ENT password. */}
            <p className="m-0 mt-3 max-w-[44ch] text-balance text-[13px] font-semibold leading-snug text-text-secondary font-body">
              {copyText(copy.hero.disclaimer)}
            </p>
            <UniversityMarquee className="mt-10 w-[min(560px,100%)] max-md:mt-8" />
          </div>
        </section>
      </div>
      {/* What the app does, page by page. */}
      <LandingShowcase
        tabs={SHOWCASE_TABS}
        selectedId={selectedShowcaseTab}
        onSelect={setShowcaseTabId}
        preview={preview}
        className="pt-24 pb-8 max-md:pt-16 max-md:pb-4"
      />
      {/* The app on a phone, page by page in students' days; without every
          page it shows, the app on a computer and a phone at once, what each
          brings. */}
      {SHOWS_FILM ? (
        <FilmShowcase className="pt-24 pb-28 max-md:pt-16 max-md:pb-20" />
      ) : (
        <FeatureShowcase className="pt-24 pb-28 max-md:pt-16 max-md:pb-20" />
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
