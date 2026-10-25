import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { track } from '../analytics'
import { getLaunchId } from '../changelogState'
import { markChangelogEntrySeen, useChangelog } from '../changelogStore'

// Closing: the card fades, then its room folds up (.launch-card-slot).
const LEAVE_MS = 480

// A launch card, under the dashboard's widgets: a small stage (`stage`, the
// page's own drawing: GradesLaunchCard, PlanningLaunchCard), one line and
// a way in. For a `spotlight` « Nouveautés » entry (`entryId`,
// src/changelog.js), only where it applies (its audience, the device not
// new: changelogStore) and while it's unseen; one launch at a time, the
// newest first (getLaunchId). Closing it, its button or visiting the page
// by any other way marks it seen. It stands in for the « Nouveautés » pill
// for this entry, which stays in the list.
// `launch`: which one, for the analytics ('grades', 'planning').
// `onOpen`: shows the page (App's page switch, told it's from here for its
// page_viewed).
function LaunchCard({ entryId, launch, stage, title, line, ctaLabel, closeLabel, onOpen }) {
  const { entries, unseenIds, heldLaunchIds } = useChangelog()
  const titleId = useId()
  const [isLeaving, setIsLeaving] = useState(false)
  const leaveTimeoutRef = useRef(null)
  const isShown = Boolean(onOpen) && getLaunchId(entries, unseenIds, heldLaunchIds) === entryId
  // Anonymous analytics: `shown` once per mount, when the card is there
  // (the ref outlives StrictMode's second effect run).
  const hasReportedShownRef = useRef(false)

  useEffect(() => () => window.clearTimeout(leaveTimeoutRef.current), [])

  useEffect(() => {
    if (!isShown || hasReportedShownRef.current) return
    hasReportedShownRef.current = true
    track('launch_card', { action: 'shown', launch })
  }, [isShown, launch])

  if (!isShown) return null

  const handleOpen = () => {
    track('launch_card', { action: 'cta', launch })
    markChangelogEntrySeen(entryId)
    onOpen('launch_card')
  }

  // Seen once it's gone: marking it right away would unmount it mid-fade.
  const handleClose = () => {
    if (isLeaving) return
    track('launch_card', { action: 'dismissed', launch })
    setIsLeaving(true)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    leaveTimeoutRef.current = window.setTimeout(() => markChangelogEntrySeen(entryId), reduceMotion ? 0 : LEAVE_MS)
  }

  return (
    <div className={`launch-card-slot ${isLeaving ? 'is-leaving' : ''}`}>
      <div className="min-h-0">
        <section
          className="launch-card widget-card widget-card-visible flex items-center gap-4 card-corners-sm border bg-widget-bg p-2 pr-3 text-text shadow-md max-md:gap-3"
          aria-labelledby={titleId}
          inert={isLeaving}
        >
          <div className="launch-card-stage flex h-[68px] w-[136px] shrink-0 items-end justify-center overflow-hidden rounded-[14px] max-md:h-auto max-md:min-h-[60px] max-md:w-[100px] max-md:self-stretch max-md:rounded-[12px]">
            <div className="relative aspect-[132/66] w-[124px] max-md:w-[92px]">
              {stage}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2 max-md:py-0.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="launch-card-rise m-0 font-display text-[18px] font-bold leading-[1.2] text-balance max-md:text-[16px]" style={{ '--delay': '160ms' }}>
                {title}
              </h2>
              <p className="launch-card-rise m-0 truncate font-body text-[14px] font-medium leading-[1.3] text-text-muted max-md:hidden" style={{ '--delay': '240ms' }}>
                {line}
              </p>
            </div>
            {/* Font on the label: index.css gives buttons `font: inherit` outside Tailwind's layers. */}
            <button
              type="button"
              className="launch-card-rise inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-0 bg-brand px-4 text-bg cursor-pointer transition-[background-color,transform] duration-150 ease-out hover:bg-brand-hover active:scale-[0.97] max-md:h-8 max-md:px-3"
              style={{ '--delay': '320ms' }}
              onClick={handleOpen}
            >
              <span className="font-body text-[14px] font-semibold leading-none whitespace-nowrap max-md:text-[13px]">{ctaLabel}</span>
              <Icon icon="carbon:arrow-right" className="launch-card-cta-arrow h-4 w-4 max-md:h-3.5 max-md:w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* 44px hit area on phones, same 16px cross (as the greeting's). */}
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-brand-subtle hover:text-text max-md:-my-1 max-md:-mr-2 max-md:h-11 max-md:w-11 max-md:self-start"
            onClick={handleClose}
            aria-label={closeLabel}
            title="Fermer"
          >
            <Icon icon="carbon:close" className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>
      </div>
    </div>
  )
}

export default LaunchCard
