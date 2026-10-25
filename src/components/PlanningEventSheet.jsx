import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { dayText, durationText, formatTime, relativeDayText } from '../planningDates'
import { nextOccurrences } from '../planningEvents'
import { accentStyle } from '../eventAccents'
import { FULL_BLOCK_HEIGHT } from '../eventBlockLayout'
import PlanningEventBlock from './PlanningEventBlock'
import CloseButton from './CloseButton'

// A row of the sheet's cards (the iOS GroupCard's rows, in the look of
// the evaluation rows of Mes notes): an icon box, a line and a second one,
// parted from the next row by a hairline from the text's edge. A button with
// a chevron when it leads somewhere.
function SheetRow({ icon, title, detail, onClick }) {
  const content = (
    <>
      <span className="inline-flex size-8 shrink-0 items-center justify-center corners-[9px] bg-brand-subtle text-text-secondary" aria-hidden="true">
        <Icon icon={icon} className="size-[17px]" />
      </span>
      <span className="planning-row-text grid min-w-0 flex-1 content-center gap-[4px] self-stretch py-[17px] pr-4">
        <span className="truncate font-body text-[14px] font-semibold leading-[1.2] text-text">{title}</span>
        {detail ? <span className="truncate font-body text-[12.5px] font-medium leading-none text-text-muted">{detail}</span> : null}
      </span>
      {onClick ? <Icon icon="carbon:chevron-right" className="-ml-1 mr-4 size-[14px] shrink-0 text-text-30" aria-hidden="true" /> : null}
    </>
  )
  const className = 'planning-row flex w-full min-w-0 items-center gap-3.5 pl-4 text-left text-text'
  return onClick
    ? <li><button type="button" className={`${className} is-link cursor-pointer border-0 bg-transparent p-0 pl-4`} onClick={onClick}>{content}</button></li>
    : <li className={className}>{content}</li>
}

const CARD_CLASSES = 'widget-card widget-card-visible m-0 list-none overflow-hidden border bg-widget-bg px-0 py-1 card-corners'

// A class's sheet, laid out as the iOS app's (EventDetailViewController)
// and drawn as a grade's (GradeDetailModal): the course's colour washing
// its top, the class's block, a card with its hours, its day and length and
// its group, then the same course's next classes over 30 days (each one
// takes the planning to its day). `searching`: those weeks are still on
// their way.
function PlanningEventSheet({ event, accent, events, todayKey, searching, onClose, onPickDay }) {
  const dialogRef = useRef(null)
  const scrollRef = useRef(null)
  // Content under the header: its blur shows.
  const [isStuck, setIsStuck] = useState(false)
  const occurrences = nextOccurrences(events, event)

  // The block is laid out to the width inside the content's padding.
  const contentRef = useRef(null)
  const [contentWidth, setContentWidth] = useState(0)
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return undefined
    const measure = () => {
      const style = getComputedStyle(element)
      setContentWidth(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined
    const handleScroll = () => setIsStuck(scroller.scrollTop > 2)
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [])

  // Focus in, Escape out, focus back where it was.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const handleKey = (keyEvent) => {
      if (keyEvent.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (previous?.isConnected) previous.focus?.({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog planning-sheet relative isolate flex max-h-[min(820px,calc(100dvh-40px))] w-[min(448px,100%)] flex-col corners-[26px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        style={accentStyle(accent)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-sheet-title"
        tabIndex={-1}
      >
        <div className="gd-clip relative flex min-h-0 flex-1 flex-col">
          {/* The course's colour washing the top, as a grade's UEs do. */}
          <span className="latest-grade-wash gd-wash planning-accent-fill" aria-hidden="true" />
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
            <header className={`gd-header sticky top-0 z-20 ${isStuck ? 'is-stuck' : ''}`}>
              <span className="gd-header-blur" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </span>
              <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
              <div className="relative flex justify-end px-6 pt-4 pb-2 max-sm:px-4 max-sm:pt-[14px]">
                <CloseButton glass onClick={onClose} />
              </div>
            </header>

            <div ref={contentRef} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 px-6 pt-1 pb-6 max-sm:px-4 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">
              <h2 id="planning-sheet-title" className="sr-only">{event.title}</h2>
              <div className="gd-rise grid gap-3">
                {contentWidth > 0 ? (
                  <PlanningEventBlock event={event} accent={accent} variant="regular" width={contentWidth} height={FULL_BLOCK_HEIGHT} style={{ position: 'relative' }} />
                ) : <div style={{ height: FULL_BLOCK_HEIGHT }} />}
                <ul className={CARD_CLASSES}>
                  <SheetRow icon="carbon:time" title={`De ${formatTime(event.start)} à ${formatTime(event.end)}`} />
                  <SheetRow icon="carbon:calendar" title={`${dayText(event.day)} · ${durationText(event.start, event.end)}`} />
                  {event.group ? <SheetRow icon="carbon:events" title={event.group} /> : null}
                </ul>
              </div>
              {/* Titled like the sections of Mes notes. */}
              <section className="gd-rise grid gap-3" style={{ '--d': '80ms' }} aria-labelledby="planning-occurrences-title">
                <div className="flex items-center gap-[5px] text-brand">
                  <Icon icon="carbon:calendar-heat-map" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                  <h3 id="planning-occurrences-title" className="m-0 font-body text-base font-medium leading-[1.06]">Occurrences</h3>
                  <span className="ml-auto font-body text-[13px] font-medium leading-none text-text-muted">sur 30 jours</span>
                </div>
                {occurrences.length ? (
                  <ul className={CARD_CLASSES}>
                    {occurrences.map((occurrence) => (
                      <SheetRow
                        key={occurrence.id}
                        icon="carbon:calendar"
                        title={relativeDayText(occurrence.day, todayKey)}
                        detail={[`${formatTime(occurrence.start)} – ${formatTime(occurrence.end)}`, occurrence.location].filter(Boolean).join(' · ')}
                        onClick={() => onPickDay(occurrence.day)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 font-body text-[14px] font-medium leading-[1.4] text-text-secondary">
                    {searching ? 'Recherche d’autres séances…' : 'Aucune autre séance dans les 30 prochains jours'}
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default PlanningEventSheet
