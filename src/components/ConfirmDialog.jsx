import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// A small « are you sure » card for what can't be undone (the mail page's
// « Supprimer définitivement », « Vider la corbeille »), drawn as the app's
// other modals (AboutModal: the backdrop, the card's corners and its pop-in).
// `title` the question, `children` one line on what happens; the confirm
// button in red when `destructive`. Escape, a click on the backdrop or
// « Annuler » call `onCancel`. The focus lands on the safe choice: « Annuler »
// for a destructive one (Enter can't erase by accident, as Apple's
// guidelines ask), else the confirm button.
// Text sits on spans: a <button> takes its font from index.css's
// `button { font: inherit }`, outside Tailwind's layers.
function ConfirmDialog({ open, title, children = null, confirmLabel, cancelLabel = 'Annuler', destructive = false, onConfirm, onCancel }) {
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
        className="w-[min(360px,100%)] modal-corners [--modal-inset:21px] [--modal-inner-radius:20px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] animate-modal-card-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={children ? 'confirm-dialog-text' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-[15px] p-[21px]">
          <div className="grid gap-[6px]">
            <h2 id="confirm-dialog-title" className="m-0 text-[18px] font-bold leading-[1.2]">{title}</h2>
            {children ? <p id="confirm-dialog-text" className="m-0 text-[14px] font-medium leading-[1.4] text-text-muted">{children}</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <button ref={cancelRef} type="button" className="material inline-flex h-9 items-center rounded-full px-4 cursor-pointer" onClick={onCancel}>
              <span className="text-[13px] font-semibold leading-none text-text">{cancelLabel}</span>
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`inline-flex h-9 items-center rounded-full border-0 px-4 cursor-pointer transition-[transform,filter] duration-100 ease-out active:scale-[0.96] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${destructive ? 'bg-[#d1342f] text-white dark:bg-[#e5443d]' : 'bg-text text-bg'}`}
              onClick={onConfirm}
            >
              <span className="text-[13px] font-semibold leading-none">{confirmLabel}</span>
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default ConfirmDialog
