import { useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import CloseButton from './CloseButton'
import MailSearchField from './MailSearchField'

// The cards a drawer's arrows move through (MailGradePicker's grades,
// MailCoursePicker's classes).
export const ATTACH_CARD_CLASS = 'mail-attach-card'

// A line in place of the list (none yet, none found).
export function AttachDrawerNote({ children }) {
  return <p className="m-0 px-2 py-8 text-center font-body text-[14px] font-medium leading-[1.4] text-text-secondary">{children}</p>
}

// A list that didn't load: why, and « Réessayer ».
export function AttachDrawerError({ text, onRetry }) {
  return (
    <div className="grid justify-items-center gap-3 px-2 py-8 text-center" role="alert">
      <p className="m-0 max-w-[340px] font-body text-[14px] font-medium leading-[1.4] text-text-secondary">{text}</p>
      <button type="button" className="material inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2" onClick={onRetry}>
        <Icon icon="carbon:renew" className="size-4" aria-hidden="true" />
        <span className="font-body text-[14px] font-semibold text-text">Réessayer</span>
      </button>
    </div>
  )
}

// The card the arrows go to from `current`: the next or previous in order
// (left, right), or the nearest on the row below or above (down, up).
function nextCard(cards, current, key) {
  const index = cards.indexOf(current)
  if (key === 'ArrowRight') return cards[index + 1] ?? null
  if (key === 'ArrowLeft') return index > 0 ? cards[index - 1] : null
  if (index < 0) return key === 'ArrowDown' ? cards[0] ?? null : null
  const from = current.getBoundingClientRect()
  const down = key === 'ArrowDown'
  const rows = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter(({ rect }) => (down ? rect.top > from.top + 1 : rect.top < from.top - 1))
  if (!rows.length) return null
  const rowTop = down ? Math.min(...rows.map(({ rect }) => rect.top)) : Math.max(...rows.map(({ rect }) => rect.top))
  return rows
    .filter(({ rect }) => Math.abs(rect.top - rowTop) < 2)
    .sort((left, right) => Math.abs(left.rect.left - from.left) - Math.abs(right.rect.left - from.left))[0].card
}

// A drawer of the composer's trombone (« Une note… », « Un cours… »):
// sliding up over the composer's foot (inside its window, which clips
// it), of a set height (a search narrowing the list doesn't move it), its
// title and count, a search field (`search`: { value, onChange,
// placeholder } once there's enough to search, else null), its × and the
// list (`children`, its cards of ATTACH_CARD_CLASS). Focus in (the search
// field once there, else the drawer), back on close to what opened it.
// Its own keys, kept from the composer (marked handled, and not let up the
// tree: Escape there would close the mail): Escape closes it only (the
// search field's own Escape, emptying it, first), the arrows move through
// the cards (from the search field too), Enter in the field picks the
// first (`onSubmit`), Tab goes round it. `scrollRef`: its scroll box.
function MailAttachDrawer({ titleId, title, subtitle = null, search = null, onSubmit = null, onClose, scrollRef = null, children }) {
  const dialogRef = useRef(null)
  const searchRef = useRef(null)
  const hasSearch = Boolean(search)

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (hasSearch) searchRef.current?.focus({ preventScroll: true })
  }, [hasSearch])

  const handleKeyDown = (event) => {
    const focusable = [...dialogRef.current.querySelectorAll('input, button:not(:disabled)')].filter((element) => element.getClientRects().length > 0)
    const cards = [...dialogRef.current.querySelectorAll(`.${ATTACH_CARD_CLASS}`)]
    let handled = true
    if (event.key === 'Escape') {
      if (!event.defaultPrevented) onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && cards.includes(document.activeElement))) {
      const target = nextCard(cards, cards.includes(document.activeElement) ? document.activeElement : null, event.key)
      if (target) target.focus()
      else if (event.key === 'ArrowUp' && cards.includes(document.activeElement)) searchRef.current?.focus()
    } else if (event.key === 'Enter' && event.target === searchRef.current) {
      onSubmit?.()
    } else if (event.key === 'Tab' && focusable.length) {
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) last.focus()
      else if (!event.shiftKey && document.activeElement === last) first.focus()
      else handled = false
    } else {
      handled = false
    }
    if (handled) event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" role="presentation">
      <div className="absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="mail-grade-drawer planning-sheet relative flex h-[min(640px,calc(100%-56px))] w-full flex-col overflow-hidden rounded-t-[24px] border-t border-border bg-bg text-text shadow-[0_-12px_48px_var(--color-shadow)] outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <span className="mx-auto mt-2 h-[4px] w-9 shrink-0 rounded-full bg-text-30" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pt-3 pb-4 max-sm:px-4">
          <div className="grid min-w-0 flex-1 gap-[5px]">
            <h2 id={titleId} className="m-0 text-[19px] font-bold leading-[1.1]">{title}</h2>
            {subtitle ? <p className="m-0 font-body text-[13px] font-medium leading-none text-text-muted">{subtitle}</p> : null}
          </div>
          {search ? (
            <MailSearchField
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
              inputRef={searchRef}
              className="order-last w-full sm:order-none sm:w-[260px]"
            />
          ) : null}
          <CloseButton onClick={onClose} />
        </div>
        {/* Room around the cards for their shadow, inside the scroll box. */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5 max-sm:px-4 max-sm:pb-[max(16px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </section>
    </div>
  )
}

export default MailAttachDrawer
