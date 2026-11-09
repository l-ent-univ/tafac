import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import PlanningDirectoryContent from './PlanningDirectoryContent'
import { TOOLBAR_BUTTON_CLASSES } from './MailToolbar'
import Tooltip from './Tooltip'

// « Salles et personnels », in a side panel on the right as the mail
// reader's (MailPage, .side-panel): it slides in from the screen's edge and
// back out, the page making room beside it, its width PlanningPage's
// --side-panel-width (dragged from its left edge). Wide screens only (a
// phone has its sheet, PlanningDirectorySheet). Its search, tabs and list
// are PlanningDirectoryContent's, opened on the search field (the props
// past `onClose` are handed to it). `open`: shown; `onClose`: its close
// button, or Escape.
function PlanningDirectoryPanel({ open, onClose, ...contentProps }) {
  const titleId = useId()
  // Kept while it slides out, unmounted at the animation's end.
  const [isMounted, setIsMounted] = useState(open)
  if (open && !isMounted) setIsMounted(true)
  const isClosing = isMounted && !open
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A dialog over the page (Réglages, opened from here) takes its own.
      if (document.querySelector('[aria-modal="true"]')) return
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Opened on its search field.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  if (!isMounted) return null

  return (
    <aside
      className={`side-panel card-corners fixed top-3 right-3 bottom-3 z-30 hidden w-[var(--side-panel-width)] overflow-y-auto overscroll-contain px-3 pb-5 border 4xl:block ${isClosing ? 'is-closing' : ''}`}
      aria-labelledby={titleId}
      inert={isClosing || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && isClosing) setIsMounted(false)
      }}
    >
      <PlanningDirectoryContent
        {...contentProps}
        inputRef={inputRef}
        stickyClassName="sticky top-0 z-10 -mx-3 grid gap-3 bg-[var(--mail-panel-bg)] px-5 pt-5 pb-4"
        header={(
          <div className="flex items-center gap-3">
            <h2 id={titleId} className="m-0 min-w-0 flex-1 truncate font-body text-[17px] font-semibold text-text">Salles et personnels</h2>
            <div className="button-group">
              <button type="button" className={TOOLBAR_BUTTON_CLASSES} aria-label="Fermer" onClick={onClose}>
                <Icon icon="ph:x" className="size-[18px] shrink-0" aria-hidden="true" />
                <Tooltip title="Fermer" side="bottom-end" />
              </button>
            </div>
          </div>
        )}
      />
    </aside>
  )
}

export default PlanningDirectoryPanel
