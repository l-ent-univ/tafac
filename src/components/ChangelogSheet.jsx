import { useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import { closeChangelog, useChangelog } from '../changelogStore'
import { formatEntryDate, groupEntriesByDate } from '../changelogState'
import CloseButton from './CloseButton'

const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])'

// Title of an entry that's new since the last visit, with the blue dot glued
// to its last word so a wrapping title never leaves the dot alone on a line.
function NewTitle({ title }) {
  const splitAt = title.lastIndexOf(' ') + 1
  return (
    <>
      {title.slice(0, splitAt)}
      <span className="whitespace-nowrap">
        {title.slice(splitAt)}
        <span className="changelog-new-dot ml-[7px] inline-block h-[7px] w-[7px] rounded-full align-[0.1em]" aria-hidden="true" />
      </span>
      <span className="sr-only"> (nouveau)</span>
    </>
  )
}

// The « Nouveautés » list: a centred card on larger screens, a bottom sheet
// on phones. Opened from the dashboard pill or Réglages › À propos, so it
// stacks above the Réglages modal and its Escape doesn't close Réglages too.
// Newest first, grouped by day; what was new when it opened gets a blue dot.
function ChangelogSheet() {
  const { open, entries, highlightIds } = useChangelog()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const previouslyFocused = document.activeElement
    dialogRef.current?.focus()

    // Capture phase on window runs before the Réglages listener, which
    // stopPropagation then skips.
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeChangelog()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      // Back to what opened the list (the pill itself is gone by then).
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [open])

  if (!open) return null

  const highlighted = new Set(highlightIds)
  const subtitle = highlighted.size > 0
    ? `${highlighted.size} nouveauté${highlighted.size > 1 ? 's' : ''} depuis ta dernière visite`
    : 'Ce qui a changé récemment'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:px-3 max-sm:pt-12 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="presentation">
      <div className="changelog-backdrop absolute inset-0 bg-backdrop animate-[pwa-backdrop-in_280ms_ease-out]" onClick={closeChangelog} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="changelog-sheet relative flex w-[min(440px,100%)] max-h-[min(640px,calc(100dvh-40px))] flex-col overflow-hidden corners-[22px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none animate-modal-card-in max-sm:max-h-full max-sm:corners-[20px] max-sm:animate-[pwa-slide-in_350ms_cubic-bezier(0.16,1,0.3,1)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        aria-describedby="changelog-subtitle"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3 px-[21px] pt-[21px] pb-[14px] max-sm:px-[18px] max-sm:pt-[18px]">
          <div className="flex min-w-0 flex-col gap-[6px]">
            <h2 id="changelog-title" className="m-0 text-[22px] font-bold leading-[1.1]">
              Nouveautés
            </h2>
            <p id="changelog-subtitle" className="m-0 font-body text-[14px] font-medium leading-[1.3] text-text-60">
              {subtitle}
            </p>
          </div>
          <CloseButton label="Fermer les nouveautés" onClick={closeChangelog} />
        </div>

        {/* Focusable so the list scrolls from the keyboard. */}
        <div
          className="flex min-h-0 flex-col gap-[18px] overflow-y-auto overscroll-contain px-[21px] pb-[21px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text max-sm:px-[18px] max-sm:pb-[18px]"
          tabIndex={0}
          aria-label="Liste des nouveautés"
        >
          {entries.length === 0 ? (
            <p className="m-0 font-body text-[15px] text-text-60">Rien de neuf pour l’instant.</p>
          ) : groupEntriesByDate(entries).map((group) => (
            <section key={group.date} className="flex flex-col gap-[7px]" aria-labelledby={`changelog-date-${group.date}`}>
              <h3 id={`changelog-date-${group.date}`} className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">
                {formatEntryDate(group.date)}
              </h3>
              <ul className="m-0 list-none p-0 overflow-hidden corners-[20px] border border-white bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-border dark:border-border dark:bg-bg-surface dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                {group.entries.map((entry) => {
                  const isNew = highlighted.has(entry.id)
                  return (
                    <li key={entry.id} className="flex items-start gap-3 px-4 py-[13px]">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f1eb] dark:bg-bg-muted" aria-hidden="true">
                        <Icon icon={entry.icon || 'ph:sparkle'} className="h-[17px] w-[17px] text-text" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-[3px] pt-[5px]">
                        <h4 className="m-0 font-body text-[15px] font-semibold leading-[1.25] tracking-[-0.2px]">
                          {isNew ? <NewTitle title={entry.title} /> : entry.title}
                        </h4>
                        <p className="m-0 font-body text-[14px] font-medium leading-[1.4] text-text-60">{entry.body}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}

export default ChangelogSheet
