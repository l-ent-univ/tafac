import { useEffect, useState } from 'react'
import { Icon, iconLoaded, loadIcons } from '@iconify/react'
import { track } from '../analytics'
import { useChangelog } from '../changelogStore'
import { getMobileTabItems, openNavItemLink } from '../navItems'

// How long the "unavailable" bubble stays above a greyed-out tab.
const NOTICE_DURATION_MS = 3200

// « Accueil » (HomeDraftPage): selected unless another in-app page
// (grades…) is shown. Tapping the selected tab scrolls back to the top.
const HOME_TAB = { id: 'home', label: 'Accueil', icon: 'ph:house', iconActive: 'ph:house-fill', page: 'home' }

// The bar's icons, all Phosphor (as the sidebar's): regular, the tab shown
// filled (its `iconActive`) on its lens (.mobile-tab-bar-item--selected), as
// the sidebar's. Moodle, without a Phosphor logo, is its graduation cap.
const TAB_ICONS = {
  moodle: 'ph:graduation-cap',
}

function getTabIcon(item) {
  return TAB_ICONS[item.id] ?? item.icon
}

function getShownIcon(item) {
  return item.selected ? TAB_ICONS[item.id] ?? item.iconActive ?? item.icon : getTabIcon(item)
}

// Up to three tabs: a compact pill sized to roomy tabs. From four on, like
// iOS, the bar spans the screen (up to 420px) and the tabs share it equally,
// so the spacing stays even and the selected tab keeps a generous lens.
// Full class strings, so Tailwind sees them.
const WIDE_BAR_MIN_TABS = 4

// « Assiduité » (the ScoDoc absences) on the bar only when the student
// asked for it (Réglages › Apparence, `showAssiduity`), in Moodle's place:
// six tabs don't fit a phone. Moodle stays otherwise.
function pickShortcuts(shortcuts, showAssiduity) {
  return showAssiduity
    ? shortcuts.filter((item) => item.id !== 'moodle')
    : shortcuts.filter((item) => item.id !== 'assiduity')
}

function getTabSizeClasses(count) {
  return count >= WIDE_BAR_MIN_TABS ? 'flex-1 basis-0 min-w-0 px-1' : 'min-w-[84px] px-3.5'
}

// Floating frosted pill at the bottom of the screen (iOS 26 style tab bar),
// shown wherever the desktop sidebar isn't. Home first, then the same
// shortcuts as the sidebar (grades, planning, mail, Moodle); a greyed-out tab
// explains itself in a bubble instead of a hover tooltip.
function MobileTabBar({ establishment, gradesSupported = true, activePage = 'home', showAssiduity = false, onNavigatePage }) {
  const shortcuts = pickShortcuts(getMobileTabItems(establishment, { gradesSupported }), showAssiduity)
  const items = [HOME_TAB, ...shortcuts].map((item) => (
    item.page ? { ...item, selected: item.page === activePage } : item
  ))
  const tabSizeClasses = getTabSizeClasses(items.length)
  const iconNames = [...new Set(items.flatMap((item) => [getTabIcon(item), item.iconActive].filter(Boolean)))]
  const iconKey = iconNames.join(',')
  const [noticeItem, setNoticeItem] = useState(null)
  const { unseenIds } = useChangelog()
  // Icons come from the Iconify API on first use: the bar stays hidden until
  // all of them are in, so it never shows blank tabs (and stays hidden if
  // they can't load at all).
  const [areIconsReady, setAreIconsReady] = useState(() => iconNames.every((name) => iconLoaded(name)))

  useEffect(() => {
    const names = iconKey.split(',')
    if (names.every((name) => iconLoaded(name))) {
      setAreIconsReady(true)
      return undefined
    }

    setAreIconsReady(false)
    return loadIcons(names, (loaded, missing, pending) => {
      if (pending.length === 0 && missing.length === 0) {
        setAreIconsReady(true)
      }
    })
  }, [iconKey])

  useEffect(() => {
    if (!noticeItem) return undefined
    const timeoutId = window.setTimeout(() => setNoticeItem(null), NOTICE_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [noticeItem])

  if (shortcuts.length === 0 || !areIconsReady) {
    return null
  }

  const handleSelect = (event, item) => {
    if (item.selected) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (item.disabled) {
      event.preventDefault()
      setNoticeItem((current) => (current?.id === item.id ? null : item))
      return
    }

    if (item.href) {
      event.preventDefault()
      openNavItemLink(item, 'tabbar')
      return
    }

    if (item.page) {
      // Anonymous analytics: the tab's « Nouveau » dot was showing
      // (`launch`: its page, as in the sidebar).
      if (item.announcedBy && unseenIds.includes(item.announcedBy)) track('launch_card', { action: 'tab_marker', launch: item.page })
      onNavigatePage?.(item.page, 'tabbar')
    }
  }

  return (
    <nav
      className="4xl:hidden pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-30 flex flex-col items-center gap-2 px-4"
      aria-label="Raccourcis"
    >
      {noticeItem ? (
        <p className="mobile-tab-bar-notice m-0 max-w-[300px] corners-[16px] bg-black px-3 py-2 text-center font-body text-[12px] font-medium leading-tight text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] animate-modal-card-in dark:bg-white dark:text-black" role="status">
          <span className="block font-semibold">{noticeItem.disabledTitle}</span>
          {noticeItem.disabledDetail ? (
            <span className="block text-white/70 dark:text-black/60">{noticeItem.disabledDetail}</span>
          ) : null}
        </p>
      ) : null}
      <div className={`mobile-tab-bar pointer-events-auto flex items-center gap-1 rounded-full p-1.5 animate-modal-card-in ${items.length >= WIDE_BAR_MIN_TABS ? 'w-full max-w-[420px]' : 'max-w-full'}`}>
        {items.map((item) => {
          const className = `mobile-tab-bar-item flex h-[54px] ${tabSizeClasses} flex-col items-center justify-center gap-[3px] rounded-full border-0 text-text no-underline cursor-pointer transition-[background-color,box-shadow,outline-color,transform] duration-200 ease-out active:scale-[0.94] ${item.selected ? 'mobile-tab-bar-item--selected' : 'bg-transparent'} ${item.disabled ? 'opacity-45' : ''}`
          // Just launched (as in the sidebar): a blue dot on the icon, no
          // room for the word.
          const isNew = Boolean(item.announcedBy) && unseenIds.includes(item.announcedBy)
          const content = (
            <>
              {/* `ssr`: draw on the first render. The bar only mounts once these icons
                  are loaded, so there's nothing to wait for. */}
              <span className="relative flex">
                <Icon icon={getShownIcon(item)} ssr className="h-[22px] w-[22px]" aria-hidden="true" />
                {isNew ? <span className="mobile-tab-bar-new-dot changelog-new-dot nav-new-pulse absolute -right-[3px] -top-[2px] h-[9px] w-[9px] rounded-full" aria-hidden="true" /> : null}
              </span>
              {/* Font on the label: index.css gives buttons `font: inherit` outside Tailwind's layers.
                  Medium, semibold once selected, the two weights stacked and
                  cross-fading (as the sidebar's: Collab Sans has no variable
                  axis); read once. */}
              <span className="grid font-body text-[11px] leading-none whitespace-nowrap">
                <span className={`col-start-1 row-start-1 text-center font-medium transition-opacity duration-200 ease-out motion-reduce:transition-none ${item.selected ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true">{item.shortLabel ?? item.label}</span>
                <span className={`col-start-1 row-start-1 text-center font-semibold transition-opacity duration-200 ease-out motion-reduce:transition-none ${item.selected ? 'opacity-100' : 'opacity-0'}`}>{item.shortLabel ?? item.label}</span>
              </span>
              {isNew ? <span className="sr-only">, nouveau</span> : null}
            </>
          )

          return item.href && !item.disabled ? (
            <a
              key={item.id}
              href={item.href}
              target={item.target}
              rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
              className={className}
              onClick={(event) => handleSelect(event, item)}
            >
              {content}
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              aria-current={item.selected ? 'page' : undefined}
              aria-disabled={item.disabled ? 'true' : undefined}
              className={className}
              onClick={(event) => handleSelect(event, item)}
            >
              {content}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default MobileTabBar
