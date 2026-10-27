import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import tafacMark from '../assets/tafac-mark.png'
import UniversityLockup from './UniversityLockup'
import ChangelogPill from './ChangelogPill'
import SidebarGradePocket from './SidebarGradePocket'
import { track } from '../analytics'
import { useChangelog } from '../changelogStore'
import UpdateNotice from './UpdateNotice'
import { buildNavItems, openNavItemLink } from '../navItems'
import {
  COMPACT_SIDEBAR_WIDTH,
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
// How long folding or unfolding eases (the transition in overrides.css).
const SIDEBAR_SWITCH_MS = 340

// Dragged left of this, halfway between the compact strip and the narrowest
// sidebar, the sidebar folds into its compact state; dragged back right of
// it, it unfolds at the pointer.
const COMPACT_SNAP_WIDTH = Math.round((COMPACT_SIDEBAR_WIDTH + MIN_SIDEBAR_WIDTH) / 2)

// Thin strip on the sidebar's right edge, folded or not: drag to resize (or
// to fold and unfold), double-click to go back to the default width, or use
// the arrow keys. Width and state only reach storage on release. Halfway
// down the line, in its colour, a button folds or unfolds the sidebar.
// `onCompactChange(compact, { persist })`: live while dragging, stored on
// release.
//
// Folding or unfolding from anywhere but under the pointer (the button, the
// keys, the settings) eases: .sidebar-switching lets --sidebar-width
// transition, and with it the panel, the page's left padding and this line,
// while the new content fades in (.sidebar-swap, see overrides.css).
function SidebarResizeHandle({ compact, onCompactChange }) {
  const [width, setWidth] = useState(getStoredSidebarWidth)
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)
  const compactRef = useRef(compact)
  const appliedCompactRef = useRef(compact)
  const switchTimerRef = useRef(null)

  useLayoutEffect(() => {
    widthRef.current = width
    compactRef.current = compact
    const root = document.documentElement
    if (appliedCompactRef.current !== compact) {
      appliedCompactRef.current = compact
      if (!root.classList.contains('sidebar-resizing') && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        root.classList.add('sidebar-switching')
        window.clearTimeout(switchTimerRef.current)
        switchTimerRef.current = window.setTimeout(() => root.classList.remove('sidebar-switching'), SIDEBAR_SWITCH_MS)
      }
    }
    applySidebarWidth(compact ? COMPACT_SIDEBAR_WIDTH : width)
    // The unfolded width, folded or not: the full sidebar's content keeps it
    // while the panel grows or shrinks, so it's uncovered, not reflowed.
    document.documentElement.style.setProperty('--sidebar-full-width', `${width}px`)
  }, [compact, width])

  useEffect(() => () => {
    window.clearTimeout(switchTimerRef.current)
    document.documentElement.classList.remove('sidebar-switching')
  }, [])

  const commitWidth = useCallback((nextWidth) => {
    const clamped = clampSidebarWidth(nextWidth)
    setWidth(clamped)
    persistSidebarWidth(clamped)
  }, [])

  const setCompact = (nextCompact, options) => {
    compactRef.current = nextCompact
    onCompactChange(nextCompact, options)
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsDragging(true)
    document.documentElement.classList.add('sidebar-resizing')
  }

  const handlePointerMove = (event) => {
    if (!isDragging) return
    const pointerWidth = event.clientX - SIDEBAR_LEFT_PX
    const nextCompact = pointerWidth < COMPACT_SNAP_WIDTH
    if (nextCompact !== compactRef.current) setCompact(nextCompact)
    if (!nextCompact) setWidth(clampSidebarWidth(pointerWidth))
  }

  const endDragging = (event) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsDragging(false)
    document.documentElement.classList.remove('sidebar-resizing')
    setCompact(compactRef.current, { persist: true })
    if (!compactRef.current) commitWidth(widthRef.current)
  }

  const handleKeyDown = (event) => {
    // Folded: right unfolds. Unfolded at the narrowest: left folds.
    if (compact) {
      if (event.key === 'ArrowRight' || event.key === 'End') {
        event.preventDefault()
        setCompact(false, { persist: true })
      }
      return
    }
    if (event.key === 'ArrowLeft' && width <= MIN_SIDEBAR_WIDTH) {
      event.preventDefault()
      setCompact(true, { persist: true })
      return
    }
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

  const resetWidth = () => {
    if (compact) setCompact(false, { persist: true })
    commitWidth(DEFAULT_SIDEBAR_WIDTH)
  }

  return (
    <div
      className="group hidden 4xl:block fixed top-6 bottom-6 z-30 w-3 -translate-x-1/2"
      style={{ left: `calc(${SIDEBAR_LEFT_PX}px + var(--sidebar-width, ${DEFAULT_SIDEBAR_WIDTH}px))` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur de la barre latérale"
        aria-valuemin={COMPACT_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={compact ? COMPACT_SIDEBAR_WIDTH : width}
        aria-valuetext={compact ? 'Repliée' : `${width} pixels`}
        tabIndex={0}
        title="Glisser pour redimensionner, double-clic pour rétablir"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDragging}
        onPointerCancel={endDragging}
        onDoubleClick={resetWidth}
        onKeyDown={handleKeyDown}
        className="flex h-full w-full justify-center cursor-col-resize touch-none outline-none"
      >
        <span
          aria-hidden="true"
          className={`sidebar-handle-tint sidebar-handle-line h-full w-[3px] rounded-full transition-opacity duration-150 ${isDragging ? 'is-dragging opacity-100' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}
        />
      </div>
      <button
        type="button"
        onClick={() => setCompact(!compact, { persist: true })}
        aria-label={compact ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
        title={compact ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
        className={`sidebar-handle-tint sidebar-handle-button absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-0 p-0 text-bg cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${isDragging ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}
      >
        <Icon icon={compact ? 'carbon:chevron-right' : 'carbon:chevron-left'} className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

// Compact sidebar: what an icon stands for, in a bubble to its right on
// hover or keyboard focus. The control names itself (aria-label), so the
// bubble is for the eyes only.
function CompactTooltip({ title, detail = null }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 flex flex-col gap-[2px] w-max max-w-[240px] -translate-x-1 -translate-y-1/2 scale-95 whitespace-normal text-left corners-[12px] border border-black/10 bg-black px-[10px] py-[6px] text-[12px] font-medium leading-tight text-white opacity-0 invisible shadow-[0_12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-180 ease-out group-hover:visible group-hover:translate-x-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-x-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-white/15 dark:bg-white dark:text-black"
    >
      <span className="block font-semibold">{title}</span>
      {detail ? <span className="block text-[11px] text-white/70 dark:text-black/60">{detail}</span> : null}
    </span>
  )
}

// The compact sidebar's « Nouvelle version »: the rocket alone.
function CompactUpdateButton({ onUpdateClick }) {
  const [isApplying, setIsApplying] = useState(false)

  const handleClick = async () => {
    if (isApplying) return
    setIsApplying(true)
    try {
      await onUpdateClick?.()
    } catch (error) {
      console.error('Failed to apply update', error)
      setIsApplying(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isApplying}
      aria-label="Nouvelle version, mettre à jour"
      className="group relative inline-flex items-center justify-center size-10 rounded-full border border-border/70 bg-widget-bg/60 text-text cursor-pointer transition-[background-color] duration-150 hover:bg-brand-subtle disabled:opacity-50 disabled:cursor-wait"
    >
      <Icon icon="carbon:rocket" className="size-4" aria-hidden="true" />
      <span className="changelog-new-dot absolute top-[6px] right-[6px] size-[7px] rounded-full" aria-hidden="true" />
      <CompactTooltip title={isApplying ? 'Mise à jour…' : 'Nouvelle version'} detail={isApplying ? null : 'Mettre à jour'} />
    </button>
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
  showUniversityLogo = true,
  logoSource = 'establishment',
  gradesSupported = true,
  activePage = 'dashboard',
  onNavigatePage,
  onOpenLatestGrade = null,
  // Compact: the icons alone (App keeps it, the settings toggle it too).
  compact = false,
  onCompactChange,
}) {
  const [activeSection, setActiveSection] = useState('applications')
  const navItems = buildNavItems(establishment, { gradesSupported })
  const { unseenIds } = useChangelog()
  // On another page (grades…) its own item is the active one.
  const activeItemId = activePage === 'dashboard' ? activeSection : activePage

  const handleNavigate = useCallback((item) => {
    if (typeof document === 'undefined') {
      return
    }

    if (item.disabled) {
      return
    }

    if (item.href) {
      openNavItemLink(item, 'sidebar')
      return
    }

    if (item.page) {
      // Anonymous analytics: the item's « Nouveau » marker was showing
      // (`launch`: its page, 'grades' or 'planning').
      if (item.announcedBy && unseenIds.includes(item.announcedBy)) track('launch_card', { action: 'tab_marker', launch: item.page })
      onNavigatePage?.(item.page, 'nav')
      return
    }

    setActiveSection(item.id)

    if (activePage !== 'dashboard') {
      // Back from another page: the dashboard opens at its top.
      onNavigatePage?.('dashboard')
      return
    }

    document.getElementById(item.targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activePage, onNavigatePage, unseenIds])

  const initials = (userName || '?').trim().charAt(0).toUpperCase()

  // Same handle folded or not: kept mounted across the switch, so a drag
  // carries on through it.
  const resizeHandle = <SidebarResizeHandle compact={compact} onCompactChange={onCompactChange} />

  if (compact) {
    return (
      <>
        <aside
          className="sidebar-panel sidebar-panel--compact hidden 4xl:flex flex-col items-start justify-between px-4 py-5 w-[var(--sidebar-width,72px)] fixed top-3 left-3 bottom-3 z-30 card-corners border overflow-visible"
          aria-label="Navigation principale"
        >
          {/* A 40px column at a fixed left: the icons stay put while the
              width eases. */}
          <div className="flex flex-col items-center gap-6 w-10 sidebar-swap">
            <a href="/" className="inline-flex items-center justify-center h-10 no-underline" aria-label={`Retour, ${universityConfig.branding.appName}`}>
              <img src={tafacMark} alt="" className="block h-10 w-auto" />
            </a>
  
            <nav className="flex flex-col items-center gap-1 w-full" aria-label="Sections">
              {navItems.map((item) => {
                const isActive = activeItemId === item.id
                const isNew = Boolean(item.announcedBy) && unseenIds.includes(item.announcedBy)
                const label = [
                  item.label,
                  item.disabled ? item.disabledTitle : null,
                  isNew ? 'nouveau' : null,
                  item.href && !item.disabled ? 'ouvre un autre site' : null,
                ].filter(Boolean).join(', ')
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item)}
                    aria-label={label}
                    aria-disabled={item.disabled ? 'true' : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group relative inline-flex items-center justify-center size-10 shrink-0 rounded-full border text-text transition-[background-color,box-shadow,border-color] duration-150 ease-in-out ${
                      isActive
                        ? 'bg-widget-bg border-white dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                        : item.disabled
                          ? 'bg-transparent border-transparent cursor-not-allowed'
                          : 'bg-transparent border-transparent hover:bg-brand-subtle'
                    }`}
                  >
                    <Icon
                      icon={item.icon}
                      className={`w-[18px] h-[18px] shrink-0 ${item.disabled ? 'opacity-55 grayscale' : ''}`}
                      aria-hidden="true"
                    />
                    {isNew ? (
                      <span className="changelog-new-dot nav-new-pulse absolute top-[7px] right-[7px] h-[7px] w-[7px] rounded-full" aria-hidden="true" />
                    ) : null}
                    <CompactTooltip
                      title={item.disabled ? item.disabledTitle : item.label}
                      detail={item.disabled ? item.disabledDetail : isNew ? 'Nouveau' : null}
                    />
                  </button>
                )
              })}
            </nav>
          </div>
  
          <div className="flex flex-col items-center gap-3 w-10 sidebar-swap">
            {hasPendingUpdate ? <CompactUpdateButton onUpdateClick={onUpdateClick} /> : null}
            {authenticated ? (
              <>
                <div aria-hidden="true" className="h-px w-full bg-border/70" />
                <button
                  type="button"
                  onClick={onAccountClick}
                  disabled={checking}
                  className="group relative inline-flex shrink-0 size-9 rounded-full border border-border-input bg-bg-input p-0 items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                  aria-label={userName ? `Mon compte, ${userName}` : 'Mon compte'}
                >
                  <span className="inline-flex size-full rounded-full overflow-hidden items-center justify-center">
                    {profilePhotoSrc ? (
                      <img src={profilePhotoSrc} alt="" className="block w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold text-text-muted font-body">{initials}</span>
                    )}
                  </span>
                  <CompactTooltip title={userName || 'Mon compte'} detail={userSubtitle} />
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  disabled={checking}
                  className="group relative inline-flex items-center justify-center size-8 rounded-full bg-transparent border-0 text-text-muted cursor-pointer transition-opacity duration-120 ease-in-out hover:opacity-70 disabled:opacity-40 disabled:cursor-wait"
                  aria-label="Se déconnecter"
                >
                  <Icon icon="carbon:logout" className="w-4 h-4" aria-hidden="true" />
                  <CompactTooltip title="Se déconnecter" />
                </button>
              </>
            ) : null}
          </div>
        </aside>
        {resizeHandle}
      </>
    )
  }

  return (
    <>
      <aside
        className="sidebar-panel hidden 4xl:flex flex-col justify-between p-5 w-[var(--sidebar-width,280px)] fixed top-3 left-3 bottom-3 z-30 card-corners border overflow-y-auto overflow-x-hidden"
        aria-label="Navigation principale"
      >
        {/* At the unfolded width even while the panel eases, so unfolding
            uncovers the content instead of reflowing it. */}
        <div className="flex flex-col gap-6 w-full min-w-[calc(var(--sidebar-full-width,280px)-40px)] sidebar-swap">
          <a
            href="/"
            className="inline-flex items-center no-underline"
            aria-label="Retour"
          >
            <UniversityLockup variant="sidebar" establishment={establishment} showLogo={showUniversityLogo} logoSource={logoSource} />
          </a>

          <nav className="flex flex-col w-full" aria-label="Sections">
            {navItems.map((item) => {
              const isActive = activeItemId === item.id
              const isNew = Boolean(item.announcedBy) && unseenIds.includes(item.announcedBy)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item)}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative inline-flex items-center gap-2 w-full h-10 px-3 rounded-full border text-left text-text text-base font-body font-medium leading-6 whitespace-nowrap transition-[background-color,box-shadow,border-color] duration-150 ease-in-out ${
                    isActive
                      ? 'bg-widget-bg border-white dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                      : item.disabled
                        ? 'bg-transparent border-transparent cursor-not-allowed opacity-55 grayscale'
                        : 'bg-transparent border-transparent hover:bg-brand-subtle'
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
                      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 flex flex-col gap-[2px] w-max max-w-[260px] -translate-x-1/2 -translate-y-1 scale-95 whitespace-normal text-center corners-[14px] border border-black/10 bg-black px-3 py-[6px] text-[12px] font-medium leading-tight text-white opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-180 ease-out invisible group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-white/15 dark:bg-white dark:text-black"
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

        <div className="flex flex-col gap-3 w-full min-w-[calc(var(--sidebar-full-width,280px)-40px)] sidebar-swap">
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
      {resizeHandle}
    </>
  )
}

export default Sidebar
