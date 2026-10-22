import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import UniversityLockup from './UniversityLockup'
import ChangelogPill from './ChangelogPill'
import SidebarGradePocket from './SidebarGradePocket'
import { track } from '../analytics'
import { useChangelog } from '../changelogStore'
import UpdateNotice from './UpdateNotice'
import { scrollAppToTop, useAppRoute } from '../appRoute'
import { prefetchGradesPage } from '../entApi'
import { buildNavItems, openNavItemLink } from '../navItems'
import { useSlidingIndicator } from '../useSlidingIndicator'
import { SlidingIndicator } from './SlidingIndicator'

// Pages fed by ScoDoc, prefetched on hover.
const SCODOC_ROUTES = new Set(['grades', 'absences'])
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  applySidebarWidth,
  clampSidebarWidth,
  getStoredSidebarWidth,
  persistSidebarWidth,
} from '../sidebarWidth'

// The sidebar floats 12px (left-3) from the window edge.
const SIDEBAR_LEFT_PX = 12
const SIDEBAR_KEYBOARD_STEP_PX = 16

// Thin strip on the sidebar's right edge: drag to resize, double-click to go
// back to the default width, or use the arrow keys. The width only reaches
// storage on release.
function SidebarResizeHandle() {
  const [width, setWidth] = useState(getStoredSidebarWidth)
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)

  useLayoutEffect(() => {
    widthRef.current = width
    applySidebarWidth(width)
  }, [width])

  const commitWidth = useCallback((nextWidth) => {
    const clamped = clampSidebarWidth(nextWidth)
    setWidth(clamped)
    persistSidebarWidth(clamped)
  }, [])

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsDragging(true)
    document.documentElement.classList.add('sidebar-resizing')
  }

  const handlePointerMove = (event) => {
    if (!isDragging) return
    setWidth(clampSidebarWidth(event.clientX - SIDEBAR_LEFT_PX))
  }

  const endDragging = (event) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsDragging(false)
    document.documentElement.classList.remove('sidebar-resizing')
    commitWidth(widthRef.current)
  }

  const handleKeyDown = (event) => {
    const steps = {
      ArrowLeft: width - SIDEBAR_KEYBOARD_STEP_PX,
      ArrowRight: width + SIDEBAR_KEYBOARD_STEP_PX,
      Home: MIN_SIDEBAR_WIDTH,
      End: MAX_SIDEBAR_WIDTH,
    }
    if (!(event.key in steps)) return
    event.preventDefault()
    commitWidth(steps[event.key])
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Largeur de la barre latérale"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Glisser pour redimensionner, double-clic pour rétablir"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDragging}
      onPointerCancel={endDragging}
      onDoubleClick={() => commitWidth(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={handleKeyDown}
      className="group hidden 4xl:flex fixed top-6 bottom-6 z-30 w-3 -translate-x-1/2 justify-center cursor-col-resize touch-none outline-none"
      style={{ left: `calc(${SIDEBAR_LEFT_PX}px + var(--sidebar-width, ${DEFAULT_SIDEBAR_WIDTH}px))` }}
    >
      <span
        aria-hidden="true"
        className={`h-full w-[3px] rounded-full bg-text-30 transition-opacity duration-150 ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
      />
    </div>
  )
}

function Sidebar({
  authenticated,
  checking,
  userName,
  userSubtitle,
  profilePhotoSrc,
  onLogout,
  onAccountClick,
  favoritesSlotRef = null,
  hasPendingUpdate = false,
  onUpdateClick,
  showChangelogPill = false,
  establishment = null,
  gradesSupported = true,
  onOpenLatestGrade = null,
}) {
  const route = useAppRoute()
  const navItems = buildNavItems(establishment, { gradesSupported })
  const [navRef, activeBox] = useSlidingIndicator(route)
  const { unseenIds } = useChangelog()

  const handleNavigate = useCallback((item) => {
    if (item.disabled) {
      return
    }

    // Already there: back to the top of the page.
    if (item.route && item.route === route) {
      scrollAppToTop({ smooth: true })
      return
    }

    // Anonymous analytics: the item's « Nouveau » marker was showing
    // (`launch`: its page, 'grades' or 'planning').
    if (item.announcedBy && unseenIds.includes(item.announcedBy)) track('launch_card', { action: 'tab_marker', launch: item.route })
    openNavItemLink(item, 'sidebar')
  }, [route, unseenIds])

  const initials = (userName || '?').trim().charAt(0).toUpperCase()

  return (
    <>
      <aside
        className="sidebar-panel hidden 4xl:flex flex-col justify-between p-5 w-[var(--sidebar-width,280px)] fixed top-3 left-3 bottom-3 z-30 rounded-[24px] border overflow-y-auto"
        aria-label="Navigation principale"
      >
        <div className="flex flex-col gap-6 w-full">
          <a
            href="/"
            className="inline-flex items-center no-underline"
            aria-label="Retour"
          >
            <UniversityLockup variant="sidebar" />
          </a>

          <nav ref={navRef} className="relative flex flex-col w-full" aria-label="Sections" data-tour="nav">
            {/* The active pill slides between items when the page changes. */}
            <SlidingIndicator
              box={activeBox}
              className="rounded-full border bg-widget-bg border-white dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
            />
            {navItems.map((item) => {
              const isActive = Boolean(item.route) && item.route === route
              const isNew = Boolean(item.announcedBy) && unseenIds.includes(item.announcedBy)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item)}
                  // Warm the ScoDoc pages while the pointer is on its way.
                  onPointerEnter={SCODOC_ROUTES.has(item.route) ? prefetchGradesPage : undefined}
                  onFocus={SCODOC_ROUTES.has(item.route) ? prefetchGradesPage : undefined}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  data-active={isActive ? 'true' : undefined}
                  className={`group relative inline-flex items-center gap-2 w-full h-10 px-3 rounded-full border border-transparent text-left text-text text-base font-body font-medium leading-6 whitespace-nowrap transition-[background-color] duration-150 ease-in-out ${
                    isActive
                      ? 'bg-transparent'
                      : item.disabled
                        ? 'bg-transparent cursor-not-allowed opacity-55 grayscale'
                        : 'bg-transparent hover:bg-brand-subtle'
                  }`}
                >
                  <Icon
                    icon={item.icon}
                    className="w-[17px] h-[17px] shrink-0"
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                  {/* Just launched (its « Nouveautés » entry unseen): gone once
                      the page is visited or its dashboard card closed. */}
                  {isNew ? (
                    <>
                      <span className="nav-new-badge ml-auto inline-flex h-5 shrink-0 items-center gap-[5px] rounded-full px-2 font-body text-[11px] font-semibold leading-none" aria-hidden="true">
                        <span className="changelog-new-dot nav-new-pulse h-[6px] w-[6px] rounded-full" />
                        Nouveau
                      </span>
                      <span className="sr-only">, nouveau</span>
                    </>
                  ) : null}
                  {/* No in-app page yet: this one opens the service's own site. */}
                  {item.href && !item.disabled ? (
                    <Icon
                      icon="carbon:arrow-up-right"
                      className="ml-auto mr-[-2px] w-3 h-3 shrink-0 text-text-muted"
                      aria-label="Ouvre un autre site"
                    />
                  ) : null}
                  {item.disabled ? (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 flex flex-col gap-[2px] w-max max-w-[260px] -translate-x-1/2 -translate-y-1 scale-95 whitespace-normal text-center rounded-[14px] border border-black/10 bg-black px-3 py-[6px] text-[12px] font-medium leading-tight text-white opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-180 ease-out invisible group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-white/15 dark:bg-white dark:text-black"
                    >
                      <span className="block font-semibold">{item.disabledTitle}</span>
                      {item.disabledDetail ? (
                        <span className="block text-[11px] text-white/70 dark:text-black/60">{item.disabledDetail}</span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 w-full">
          {/* With « Mes notes »: the latest grade, opening there on it. */}
          {onOpenLatestGrade ? (
            <div className="flex w-full empty:hidden">
              <SidebarGradePocket onOpen={onOpenLatestGrade} />
            </div>
          ) : null}
          <div ref={favoritesSlotRef} className="sidebar-favorites-slot empty:hidden w-full" />
          {hasPendingUpdate ? <UpdateNotice onUpdateClick={onUpdateClick} /> : null}
          {showChangelogPill ? <ChangelogPill className="flex" /> : null}
          {authenticated ? (
            <div aria-hidden="true" className="h-px w-full bg-border/70" />
          ) : null}
          {authenticated ? (
            <div className="flex items-center justify-between w-full h-10 gap-2">
            <button
              type="button"
              onClick={onAccountClick}
              disabled={checking}
              data-tour="account"
              className="flex items-center gap-2 min-w-0 flex-1 bg-transparent border-0 p-0 text-left cursor-pointer disabled:opacity-40 disabled:cursor-wait"
              aria-label="Mon compte"
            >
              <span className="inline-flex shrink-0 size-9 rounded-full overflow-hidden border border-border-input bg-bg-input items-center justify-center">
                {profilePhotoSrc ? (
                  <img
                    src={profilePhotoSrc}
                    alt=""
                    className="block w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold text-text-muted font-body">
                    {initials}
                  </span>
                )}
              </span>
              <span className="flex flex-col min-w-0 gap-0">
                <span className="block text-base leading-[1.15] text-text font-body tracking-[-0.01em] truncate">
                  {userName || 'Mon compte'}
                </span>
                {userSubtitle ? (
                  <span className="block text-[13px] leading-[1.15] text-text-muted font-body font-medium truncate">
                    {userSubtitle}
                  </span>
                ) : null}
              </span>
            </button>
              <button
                type="button"
                onClick={onLogout}
                disabled={checking}
                className="inline-flex items-center justify-center size-8 rounded-full bg-transparent border-0 text-text-muted cursor-pointer transition-opacity duration-120 ease-in-out hover:opacity-70 disabled:opacity-40 disabled:cursor-wait"
                aria-label="Se déconnecter"
              >
                <Icon icon="carbon:logout" className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      </aside>
      <SidebarResizeHandle />
    </>
  )
}

export default Sidebar
