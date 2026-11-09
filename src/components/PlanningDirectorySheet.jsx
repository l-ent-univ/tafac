import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSheetDrag } from '../useSheetDrag'
import CloseButton from './CloseButton'
import PlanningDirectoryContent from './PlanningDirectoryContent'

// « Salles et personnels » on a phone: a sheet over the page as the
// planning's others (PlanningShareSheet), tall from the start (its list
// is long) so it doesn't jump as the tabs change, a centred dialog from
// 640px as theirs. Its search, tabs and list are PlanningDirectoryContent's
// (the props past `onClose` are handed to it), held at its top under its
// title as the list scrolls. Opened on the sheet, not on its search field:
// the keyboard would hide the list. `onClose`: its close button, a pull
// down, the backdrop or Escape.
function PlanningDirectorySheet({ onClose, ...contentProps }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const dismiss = useSheetDrag(dialogRef, onClose)

  // Focus in, Escape out (the search field's own first: it empties it),
  // focus back where it was.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const handleKey = (keyEvent) => {
      if (keyEvent.key === 'Escape' && !keyEvent.defaultPrevented) dismiss()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (previous?.isConnected) previous.focus?.({ preventScroll: true })
    }
  }, [dismiss])

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={dismiss} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog planning-sheet relative isolate flex h-[min(820px,calc(100dvh-40px))] w-[min(560px,100%)] flex-col modal-corners [--modal-inset:24px] [--modal-inner-radius:20px] max-sm:[--modal-inset:16px] max-sm:[--modal-inner-radius:18px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="gd-clip relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-6 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">
            <PlanningDirectoryContent
              {...contentProps}
              stickyClassName="sticky top-0 z-10 -mx-2 mb-1 grid gap-3 bg-bg px-6 pb-3 max-sm:px-4"
              header={(
                <div className="relative">
                  <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
                  <div className="flex items-center gap-3 pt-4 max-sm:pt-[18px]">
                    <h2 id={titleId} className="m-0 min-w-0 flex-1 truncate font-body text-[16px] font-semibold leading-tight text-text">Salles et personnels</h2>
                    <CloseButton glass onClick={dismiss} />
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default PlanningDirectorySheet
