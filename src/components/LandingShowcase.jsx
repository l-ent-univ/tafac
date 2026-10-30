import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import loginClouds from '../assets/login/login-clouds.webp'
import loginSky from '../assets/login/login-sky.webp'
import { copy, copyText } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'
import { showcaseTabId } from '../landingShowcase'
import { SHOWCASE_SECTION_ID, findPinnedTrack, scrollToShowcaseTab, useScrollTabs } from '../landingShowcaseScroll'
import LandingShowcasePreview from './LandingShowcasePreviews'

// True once the element is near the screen, and from then on: the previews
// render only then (none in the page built for search engines).
function useNearScreen(ref) {
  const [isNear, setNear] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setNear(true)
      observer.disconnect()
    }, { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return isNear
}

// One tab's panel: its title, what the page does, and its preview beside
// them; on narrower screens the preview between the title and the list
// (.landing-showcase-panel's areas). The preview is a picture of the page
// (role="img", its contents inert): what it shows is in the text. Every
// panel stays in the page, one over the other (the CSS fades the selected
// one in, the scroll places them when pinned); the others are inert, out of
// the keyboard's and assistive tech's way.
function ShowcasePanel({ tab, selected, showPreview, preview }) {
  const text = copy.showcase.tabs[tab.key]
  const items = tab.items.map((index) => ({ ...text.items[index], icon: tab.itemIcons[index] }))

  return (
    <div
      id={tab.id}
      role="tabpanel"
      aria-labelledby={showcaseTabId(tab.id)}
      data-selected={selected || undefined}
      inert={!selected || undefined}
      tabIndex={0}
      className="landing-showcase-panel scroll-mt-28 w-full focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-text"
    >
      <div className="landing-showcase-head flex min-w-0 flex-col items-start">
        <h3 className="m-0 text-[clamp(24px,2.6vw,30px)] font-bold leading-[1.05] text-text">{copyText(text.title)}</h3>
        <p className="m-0 mt-2 text-balance text-base font-medium leading-snug text-text-muted font-body">{copyText(text.intro)}</p>
      </div>
      <ul className="landing-showcase-items m-0 flex w-full min-w-0 list-none flex-col gap-4 p-0">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-3">
            <span className="mt-[1px] inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text" aria-hidden="true">
              <Icon icon={item.icon} className="size-[17px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <h4 className="m-0 text-[15px] font-bold leading-tight text-text">{copyText(item.title)}</h4>
              <p className="m-0 text-balance text-sm leading-snug text-text-muted font-body">{copyText(item.body)}</p>
            </span>
          </li>
        ))}
      </ul>
      <div
        role="img"
        aria-label={`${copyText(text.previewLabel)} (${copyText(copy.showcase.previewLabel).toLowerCase()})`}
        className="landing-showcase-frame relative isolate min-w-0 overflow-hidden corners-[32px] max-md:corners-[26px]"
      >
        {/* The login page's sky and clouds, as the dashboard's wallpaper
            behind its frosted cards (the top of the page has them already). */}
        <img src={loginSky} alt="" aria-hidden="true" draggable="false" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover dark:brightness-[0.55]" />
        <img src={loginClouds} alt="" aria-hidden="true" draggable="false" loading="lazy" className="pointer-events-none absolute bottom-0 left-1/2 -z-10 w-[max(900px,150%)] max-w-none -translate-x-1/2 translate-y-[38%] dark:brightness-[0.6]" />
        <div inert className="landing-showcase-stage select-none">
          {showPreview ? <LandingShowcasePreview kind={tab.key} preview={preview} /> : null}
        </div>
      </div>
    </div>
  )
}

// "Ce que regroupe Tafac": the app page by page, a tab each (`tabs`:
// listShowcaseTabs'), in the look of the app's own tab bar on phones (a
// frosted pill, the selected tab under a lens that slides to it). The
// selected one (`selectedId`, LandingPage's: /#messagerie picks one too)
// shows its panel, fading in over the last one's place; the others stay in
// the page, faded out, so search engines read them all, and the section
// keeps its height from one tab to the next. The arrow keys, Home and End
// move between the tabs (and pick them), as a tab list does. On large
// screens the section stays pinned while the page scrolls through the tabs
// (useScrollTabs), and picking one scrolls to it.
function LandingShowcase({ tabs, selectedId, onSelect, preview, className = '' }) {
  const sectionRef = useRef(null)
  const trackRef = useRef(null)
  const listRef = useRef(null)
  const isNear = useNearScreen(sectionRef)
  const isRevealed = useRevealOnce(sectionRef)
  const selectedIndex = Math.max(tabs.findIndex((tab) => tab.id === selectedId), 0)
  useScrollTabs(trackRef, (index) => {
    if (tabs[index] && tabs[index].id !== selectedId) onSelect(tabs[index].id)
  })

  const pick = (index) => {
    onSelect(tabs[index].id)
    if (findPinnedTrack()) scrollToShowcaseTab(index)
  }

  const handleKeyDown = (event) => {
    const steps = { ArrowRight: 1, ArrowLeft: -1 }
    let index = null
    if (event.key in steps) index = (selectedIndex + steps[event.key] + tabs.length) % tabs.length
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = tabs.length - 1
    if (index === null) return
    event.preventDefault()
    pick(index)
    listRef.current?.querySelectorAll('[role="tab"]')[index]?.focus()
  }

  if (tabs.length === 0) return null

  return (
    <section
      ref={sectionRef}
      id={SHOWCASE_SECTION_ID}
      data-revealed={isRevealed || undefined}
      className={`landing-showcase scroll-mt-24 flex justify-center px-6 max-md:px-4 ${className}`}
      aria-labelledby="fonctionnalites-title"
    >
      <div className="flex w-full max-w-[1180px] flex-col items-center">
        {/* The track the pinned showcase scrolls along (one stretch per tab),
            and what stays on screen meanwhile. */}
        <div
          ref={trackRef}
          data-count={tabs.length}
          className={`w-full ${tabs.length > 1 ? 'landing-showcase-track' : ''}`}
          style={{ '--tab-count': tabs.length }}
        >
          <div className="landing-showcase-pin flex w-full flex-col items-center">
            <h2 id="fonctionnalites-title" className="m-0 text-balance text-center text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text">
              {copyText(copy.showcase.title)}
            </h2>
            <p className="landing-showcase-intro m-0 mt-3 max-w-[52ch] text-balance text-center text-base font-medium leading-snug text-text-muted font-body">
              {copyText(copy.showcase.intro)}
            </p>
            {tabs.length > 1 ? (
              <div
                ref={listRef}
                role="tablist"
                aria-label={copyText(copy.showcase.tabsLabel)}
                className="landing-tabs mobile-tab-bar relative mt-8 flex w-full max-w-[460px] items-center gap-1 rounded-full p-1.5 max-md:mt-6"
                style={{ '--tab-count': tabs.length, '--tab-index': selectedIndex }}
                onKeyDown={handleKeyDown}
              >
                <span className="landing-tabs-lens mobile-tab-bar-item--selected pointer-events-none absolute rounded-full" aria-hidden="true" />
                {tabs.map((tab) => {
                  const text = copy.showcase.tabs[tab.key]
                  const selected = tab.id === tabs[selectedIndex].id
                  return (
                    <button
                      key={tab.id}
                      id={showcaseTabId(tab.id)}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={tab.id}
                      tabIndex={selected ? 0 : -1}
                      className="mobile-tab-bar-item relative z-10 flex h-[54px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] rounded-full border-0 bg-transparent px-1 text-text cursor-pointer transition-transform duration-150 ease-out active:scale-[0.94]"
                      onClick={() => pick(tabs.indexOf(tab))}
                    >
                      <Icon icon={tab.icon} className="size-[22px]" aria-hidden="true" />
                      {/* Font on the label: index.css gives buttons `font: inherit` outside Tailwind's layers. */}
                      <span className="font-body text-[12px] font-semibold leading-none whitespace-nowrap">
                        <span className="max-xs:hidden">{copyText(text.label)}</span>
                        <span className="xs:hidden">{copyText(text.shortLabel)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            <div className="landing-showcase-panels mt-12 w-full max-md:mt-8">
              {tabs.map((tab, index) => (
                <ShowcasePanel
                  key={tab.id}
                  tab={tab}
                  selected={index === selectedIndex}
                  showPreview={isNear}
                  preview={preview}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="m-0 mt-10 max-w-[60ch] text-balance text-center text-[13px] leading-snug text-text-muted font-body max-md:mt-8">
          {copyText(copy.showcase.note)}
        </p>
      </div>
    </section>
  )
}

export default LandingShowcase
