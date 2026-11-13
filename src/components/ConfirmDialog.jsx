import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import SmoothSurface from './SmoothSurface'

// A small « are you sure » card for what can't be undone (the mail page's
// « Supprimer définitivement », « Vider la corbeille »), drawn as the app's
// other modals (AboutModal: the backdrop, the card's corners and its pop-in).
// `title` the question, `children` one line on what happens; the confirm
// button in red when `destructive`. Escape, a click on the backdrop or
// « Annuler » call `onCancel`. The focus lands on the safe choice: « Annuler »
// for a destructive one (Enter can't erase by accident, as Apple's
// guidelines ask), else the confirm button. `extraLabel` and `onExtra`: a
// third choice in red, under the confirm beside « Annuler » (the composer's
// « Supprimer », as Apple Mail asks on closing a draft).
// Text sits on spans: a <button> takes its font from index.css's
// `button { font: inherit }`, outside Tailwind's layers.
function ConfirmDialog({ open, title, children = null, confirmLabel, cancelLabel = 'Annuler', destructive = false, extraLabel = null, onExtra = null, onConfirm, onCancel }) {
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const initial = destructive ? cancelRef : confirmRef
    initial.current?.focus({ preventScroll: true })
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      // Captured: Escape closes the dialog, not the reader or a selection
      // under it.
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, destructive, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="weather-modal-backdrop fixed inset-0 z-60 flex items-center justify-center bg-backdrop p-5 animate-modal-backdrop-in max-sm:p-[14px]"
      onClick={onCancel}
      role="presentation"
    >
      <section
        className="glass-solid glass--quiet modal-surface w-[min(340px,100%)] modal-corners [--modal-inset:20px] [--modal-inner-radius:20px] border text-[var(--color-text)] animate-modal-card-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={children ? 'confirm-dialog-text' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-5 p-5">
          <div className="grid gap-[6px] px-1 pt-1">
            <h2 id="confirm-dialog-title" className="m-0 text-[18px] font-bold leading-[1.2] tracking-[-0.01em]">{title}</h2>
            {children ? <p id="confirm-dialog-text" className="m-0 text-[14px] font-medium leading-[1.4] text-text-muted">{children}</p> : null}
          </div>
          {/* Stacked, full width: the confirm on top when there's a third
              choice, the other two side by side under it; else the two side
              by side, the safe one first. Pills as tall as the card's inset
              is wide: their curve follows its corners. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              ref={confirmRef}
              type="button"
              className={`lent-button inline-flex h-10 items-center justify-center rounded-full px-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${destructive ? 'lent-button--danger' : ''} ${extraLabel && onExtra ? 'col-span-2' : 'order-2'}`}
              onClick={onConfirm}
            >
              <SmoothSurface />
              <span className="text-[14px] font-medium leading-none">{confirmLabel}</span>
            </button>
            {extraLabel && onExtra ? (
              <button type="button" className="material inline-flex h-10 items-center justify-center rounded-full px-4 cursor-pointer" onClick={onExtra}>
                <SmoothSurface />
                <span className="text-[14px] font-semibold leading-none text-[#d1342f] dark:text-[#ff6b63]">{extraLabel}</span>
              </button>
            ) : null}
            <button ref={cancelRef} type="button" className={`material inline-flex h-10 items-center justify-center rounded-full px-4 cursor-pointer ${extraLabel && onExtra ? '' : 'order-1'}`} onClick={onCancel}>
              <SmoothSurface />
              <span className="text-[14px] font-semibold leading-none text-text">{cancelLabel}</span>
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default ConfirmDialog
