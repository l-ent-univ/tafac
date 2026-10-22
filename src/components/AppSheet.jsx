import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

// The pages' sheet, drawn like « Mes notes »' grade sheet (GradeDetailModal):
// a centred card on wide screens, a sheet from the bottom on phones, on the
// app's backdrop. Escape, the backdrop and the close button close it; focus
// goes to it on open and back where it was on close. `toolbar`: a row under
// the title that stays while the body scrolls. `footer`: the actions.
function AppSheet({ open, onClose, title, subtitle = null, icon = null, toolbar = null, footer = null, width = 560, children }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    dialogRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="grades-page fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        className="gd-dialog relative isolate flex max-h-[min(820px,calc(100dvh-40px))] flex-col overflow-hidden rounded-[26px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3 max-sm:px-4 max-sm:pt-4">
          {icon ? (
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted-fill text-text" aria-hidden="true">
              <Icon icon={icon} className="size-5" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
            <h2 id={titleId} className="m-0 font-body text-[19px] font-bold leading-[1.2] text-text">{title}</h2>
            {subtitle ? <p className="m-0 font-body text-[14px] font-medium leading-snug text-text-secondary">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="relative -mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-muted-fill text-text transition-colors hover:bg-bg-muted after:absolute after:-inset-1"
          >
            <Icon icon="carbon:close" className="size-[18px]" aria-hidden="true" />
          </button>
        </header>
        {toolbar ? <div className="px-5 pb-3 max-sm:px-4">{toolbar}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {children}
        </div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+12px)]">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}

export default AppSheet
