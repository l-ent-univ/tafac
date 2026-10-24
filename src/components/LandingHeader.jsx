import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { copy, copyText } from '../landingCopy'
import { scrollToSection } from '../landingMotion'
import BetaTag from './BetaTag'
import LogoBut1 from './LogoBut1'
import PapillonBadge from './PapillonBadge'

const repoUrl = universityConfig.branding.about?.repoUrl
const LINK_CLASSES = 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 border-0 bg-transparent text-[15px] font-semibold text-text no-underline transition-colors hover:bg-white/60 dark:hover:bg-white/10'
const MENU_LINK_CLASSES = 'flex min-h-12 items-center gap-2 rounded-2xl px-4 text-[17px] font-semibold text-text no-underline transition-colors hover:bg-bg-subtle dark:hover:bg-white/10'

// The page's sections, in the bar on wide screens and in the menu otherwise.
const SECTIONS = [
  { id: 'fonctionnalites', label: copyText(copy.header.features) },
  { id: 'mot-de-passe', label: copyText(copy.header.privacy) },
  { id: 'faq', label: copyText(copy.header.faq) },
]

// On the body (see below); in place when there's no document, for the
// landing page's build-time render (src/landingPrerender.jsx).
function portalToBody(element) {
  return typeof document === 'undefined' ? element : createPortal(element, document.body)
}

// Whether the page has been scrolled down. Two thresholds, so a phone's
// bounce at the top doesn't flip it back and forth.
function useIsScrolled() {
  const [isScrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled((current) => (current ? window.scrollY > 4 : window.scrollY > 24))
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return isScrolled
}

// The landing page's top bar: the logo (in beta, part of Papillon), links
// to what's below (Confidentialité: the password's part of the security
// section), the code, and a way to sign in. Below 1024 px, the links move
// to a menu behind a burger button.
// Floating: fixed at the top of the window, on the body (the sky band is its
// own stacking context, the sections below would cover it). On the sky at
// first, as wide as the page and as if part of it; once the page scrolls (or
// the menu opens), it narrows into a frosted pill, the Papillon line folded
// away (.landing-header in overrides.css). In its place in the band, a
// spacer as tall as it.
function LandingHeader({ onLogin }) {
  const headerRef = useRef(null)
  const barRef = useRef(null)
  const foldRef = useRef(null)
  const [barHeight, setBarHeight] = useState(0)
  const [isMenuOpen, setMenuOpen] = useState(false)
  const isScrolled = useIsScrolled()
  const isFloating = isScrolled || isMenuOpen

  // The spacer keeps the bar's height on the sky, not the pill's (without
  // the Papillon line): measured only while the bar is unfolded and still,
  // never mid-fold, so the page doesn't move as it folds and unfolds.
  useEffect(() => {
    const bar = barRef.current
    const fold = foldRef.current
    if (!bar || !fold) return undefined
    const measure = () => {
      if (headerRef.current?.hasAttribute('data-floating') || fold.getAnimations().length > 0) return
      setBarHeight(bar.offsetHeight)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    fold.addEventListener('transitionend', measure)
    return () => {
      observer.disconnect()
      fold.removeEventListener('transitionend', measure)
    }
  }, [])

  // The menu closes on Escape, on a tap outside the header, and once the
  // window is wide enough for the links in the bar.
  useEffect(() => {
    if (!isMenuOpen) return undefined
    const close = () => setMenuOpen(false)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close()
    }
    const handlePointerDown = (event) => {
      if (!headerRef.current?.contains(event.target)) close()
    }
    const wideQuery = window.matchMedia('(min-width: 1024px)')
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    wideQuery.addEventListener('change', close)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
      wideQuery.removeEventListener('change', close)
    }
  }, [isMenuOpen])

  const goToSection = (event, id) => {
    setMenuOpen(false)
    scrollToSection(event, id)
  }

  return (
    <>
      <div aria-hidden="true" className="mb-2 h-[74px] max-md:h-[64px]" style={{ height: barHeight || undefined }} />
      {portalToBody(
        <header
          ref={headerRef}
          data-floating={isFloating || undefined}
          className="landing-header pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-2 pt-3 max-md:px-1.5 max-md:pt-2"
        >
          <div ref={barRef} className="landing-header-bar pointer-events-auto relative flex items-center justify-between gap-4 rounded-full border px-4 py-2 max-md:gap-2 max-md:pl-3 max-md:pr-2">
            {/* Under the logo, the family it belongs to (branding.papillon). Its logo
                white in dark mode; on phones while on the sky, the wordmark, this
                line and the burger white (overrides.css). */}
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <div className="flex items-center gap-2">
                <LogoBut1 className="h-9 max-md:h-8" wordmarkClassName="landing-header-wordmark" />
                <BetaTag />
              </div>
              <div ref={foldRef} className="landing-header-papillon-fold">
                <div className="min-h-0 overflow-hidden">
                  <PapillonBadge
                    className="landing-header-papillon mt-1.5 text-text/75 hover:text-text"
                    logoClassName="landing-header-papillon-logo dark:[filter:brightness(0)_invert(1)]"
                  />
                </div>
              </div>
            </div>
            <nav aria-label="Liens" className="landing-header-nav flex items-center gap-1 rounded-full border p-1 max-4xl:hidden">
              {SECTIONS.map(({ id, label }) => (
                <a key={id} href={`#${id}`} className={LINK_CLASSES} onClick={(event) => goToSection(event, id)}>
                  {label}
                </a>
              ))}
              {repoUrl ? (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>
                  <Icon icon="carbon:logo-github" className="size-4" aria-hidden="true" />
                  {copyText(copy.header.code)}
                </a>
              ) : null}
            </nav>
            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={onLogin}
                className="min-h-10 whitespace-nowrap rounded-full border-0 bg-brand px-5 text-[15px] font-semibold text-bg transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] cursor-pointer max-md:px-4"
              >
                {copyText(copy.header.login)}
              </button>
              <button
                type="button"
                aria-label={isMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-expanded={isMenuOpen}
                aria-controls="landing-menu"
                onClick={() => setMenuOpen((current) => !current)}
                className="landing-header-burger hidden size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text transition-colors hover:bg-white/60 dark:hover:bg-white/10 max-4xl:inline-flex"
              >
                <Icon icon={isMenuOpen ? 'carbon:close' : 'carbon:menu'} className="size-6" aria-hidden="true" />
              </button>
            </div>

            {/* The menu, under the pill: the sections, then the code. */}
            <nav
              id="landing-menu"
              aria-label="Menu"
              data-open={isMenuOpen || undefined}
              inert={!isMenuOpen}
              className="landing-header-menu absolute inset-x-0 top-full mt-2 flex flex-col gap-1 rounded-[28px] border p-2 4xl:hidden"
            >
              {SECTIONS.map(({ id, label }) => (
                <a key={id} href={`#${id}`} className={MENU_LINK_CLASSES} onClick={(event) => goToSection(event, id)}>
                  {label}
                </a>
              ))}
              {repoUrl ? (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" className={MENU_LINK_CLASSES} onClick={() => setMenuOpen(false)}>
                  <Icon icon="carbon:logo-github" className="size-5" aria-hidden="true" />
                  {copyText(copy.header.code)}
                </a>
              ) : null}
            </nav>
          </div>
        </header>,
      )}
    </>
  )
}

export default LandingHeader
