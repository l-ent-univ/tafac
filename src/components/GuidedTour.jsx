import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { readSeenValue } from '../changelogState'
import logoImage from '../assets/login/login-logo.webp'
import { settingsTransfer } from '../settingsTransferBoot'
import {
  TOUR_STEPS,
  doneTourValue,
  findAvailableStep,
  readTourValue,
  resolveTourVisit,
  writeTourValue,
} from '../onboardingTour'

// Decided once, when the page loads and before anything records a
// « Nouveautés » visit: that record is what tells a new device from an old one.
const initialVisit = resolveTourVisit({
  rawTour: readTourValue(),
  rawChangelogSeen: readSeenValue(),
  arrivedFromLent: settingsTransfer.arrived,
})
if (initialVisit.nextValue) {
  writeTourValue(initialVisit.nextValue)
}

// Waiting for the dashboard (apps, widgets) before giving up on a target.
const START_DELAY_MS = 900
const TARGET_WAIT_MS = 8000
const MEASURE_INTERVAL_MS = 120
// Breathing room around the highlighted element, and card/viewport gaps.
const HIGHLIGHT_PADDING = 6
const CARD_GAP = 14
const VIEWPORT_MARGIN = 16
const CARD_WIDTH = 340

function findTarget(name) {
  if (!name || typeof document === 'undefined') return null
  return [...document.querySelectorAll(`[data-tour="${name}"]`)].find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null
}

// Card above or below the highlight, whichever has the room, kept on screen.
function placeCard(rect, cardHeight) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)

  if (!rect) {
    return { width, left: (viewportWidth - width) / 2, top: Math.max(VIEWPORT_MARGIN, (viewportHeight - cardHeight) / 2) }
  }

  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - width / 2),
    viewportWidth - width - VIEWPORT_MARGIN,
  )
  const below = rect.bottom + HIGHLIGHT_PADDING + CARD_GAP
  const above = rect.top - HIGHLIGHT_PADDING - CARD_GAP - cardHeight
  const fitsBelow = below + cardHeight <= viewportHeight - VIEWPORT_MARGIN
  const top = fitsBelow || above < VIEWPORT_MARGIN ? below : above

  return { width, left, top: Math.min(Math.max(VIEWPORT_MARGIN, top), viewportHeight - cardHeight - VIEWPORT_MARGIN) }
}

// First-connection tour: dims the dashboard, lights up one element at a time
// and explains it. `blocked` holds it back while another sheet is open.
export default function GuidedTour({ enabled = false, blocked = false }) {
  const [pending, setPending] = useState(initialVisit.pending)
  const [stepIndex, setStepIndex] = useState(-1)
  const [highlight, setHighlight] = useState(null)
  const [cardHeight, setCardHeight] = useState(180)
  const [animatingOut, setAnimatingOut] = useState(false)
  const cardRef = useRef(null)
  const directionRef = useRef(1)
  const step = stepIndex >= 0 ? TOUR_STEPS[stepIndex] : null
  const running = pending && step !== null
  const canStart = pending && enabled && !blocked && stepIndex === -1

  const finish = useCallback(() => {
    writeTourValue(doneTourValue())
    setAnimatingOut(true)
    setTimeout(() => {
      setPending(false)
      setStepIndex(-1)
      setAnimatingOut(false)
    }, 220)
  }, [])

  const isStepAvailable = useCallback((candidate) => !candidate.target || findTarget(candidate.target) !== null, [])

  const goTo = useCallback((direction) => {
    directionRef.current = direction
    const next = findAvailableStep(TOUR_STEPS, stepIndex, direction, isStepAvailable)
    if (next === -1) {
      if (direction === 1) finish()
      return
    }
    setStepIndex(next)
  }, [finish, isStepAvailable, stepIndex])

  // Start once the dashboard is there: the first targeted step has to exist.
  useEffect(() => {
    if (!canStart) return undefined
    let cancelled = false
    let pollTimer = 0
    const deadline = Date.now() + TARGET_WAIT_MS + START_DELAY_MS

    const tryStart = () => {
      if (cancelled) return
      const firstTargeted = TOUR_STEPS.find((candidate) => candidate.target)
      if (!firstTargeted || findTarget(firstTargeted.target)) {
        setStepIndex(0)
      } else if (Date.now() < deadline) {
        pollTimer = window.setTimeout(tryStart, 300)
      } else {
        setStepIndex(0)
      }
    }

    pollTimer = window.setTimeout(tryStart, START_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(pollTimer)
    }
  }, [canStart])

  // Another sheet took over mid-tour: the tour starts again from the top later.
  useEffect(() => {
    if (blocked && stepIndex !== -1) setStepIndex(-1)
  }, [blocked, stepIndex])

  // Bring the step's element into view, then follow it (scroll, resize,
  // layout shifts) so the highlight never drifts.
  useEffect(() => {
    if (!running) return undefined

    const target = findTarget(step.target)
    if (step.target && !target) {
      goTo(directionRef.current)
      return undefined
    }

    target?.scrollIntoView({ block: 'center', inline: 'nearest' })

    const measure = () => {
      const element = findTarget(step.target)
      if (!element) {
        setHighlight(null)
        return
      }
      const { left, top, width, height, right, bottom } = element.getBoundingClientRect()
      setHighlight((current) => (
        current && current.left === left && current.top === top && current.width === width && current.height === height
          ? current
          : { left, top, width, height, right, bottom }
      ))
    }

    measure()
    const intervalId = window.setInterval(measure, MEASURE_INTERVAL_MS)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  // goTo changes with stepIndex, which is already covered by `step`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, step])

  // The desktop star only shows on hover: keep it visible while it's lit.
  useEffect(() => {
    if (!running) return undefined
    document.documentElement.setAttribute('data-tour-active', '')
    return () => document.documentElement.removeAttribute('data-tour-active')
  }, [running])

  useEffect(() => {
    if (!running) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') finish()
      if (event.key === 'ArrowRight') goTo(1)
      if (event.key === 'ArrowLeft') goTo(-1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [finish, goTo, running])

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [step, highlight])

  if (!running) return null

  const position = placeCard(step.target ? highlight : null, cardHeight)
  const isFirst = findAvailableStep(TOUR_STEPS, stepIndex, -1, isStepAvailable) === -1
  const isLast = findAvailableStep(TOUR_STEPS, stepIndex, 1, isStepAvailable) === -1
  const targetedSteps = TOUR_STEPS.filter((candidate) => candidate.target ? isStepAvailable(candidate) : true)
  const dotPosition = targetedSteps.indexOf(step)

  return (
    <div
      className={`fixed inset-0 z-[70] ${animatingOut ? 'animate-[pwa-backdrop-out_220ms_ease-in_forwards]' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-tour-title"
    >
      {/* Swallows clicks so the dashboard can't be used mid-tour. */}
      <div className="absolute inset-0" />
      {step.target && highlight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-[18px] shadow-[0_0_0_9999px_rgba(0,0,0,0.58)] ring-2 ring-white/90 transition-[left,top,width,height] duration-300 ease-out"
          style={{
            left: highlight.left - HIGHLIGHT_PADDING,
            top: highlight.top - HIGHLIGHT_PADDING,
            width: highlight.width + HIGHLIGHT_PADDING * 2,
            height: highlight.height + HIGHLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-backdrop" />
      )}
      <div
        ref={cardRef}
        className="fixed rounded-[20px] border border-border bg-widget-bg p-5 shadow-[0_16px_48px_var(--color-shadow)] transition-[left,top] duration-300 ease-out"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        {step.logo ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <img src={logoImage} alt="Tafac" width="750" height="330" className="block h-[72px] w-auto" />
            <h2 id="guided-tour-title" className="m-0 text-[1.05rem] font-bold leading-tight text-text">{step.title}</h2>
            <p className="m-0 font-body text-[0.9rem] leading-snug text-text-muted">{step.body}</p>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
              <Icon icon={step.icon} className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id="guided-tour-title" className="m-0 text-[1.05rem] font-bold leading-tight text-text">{step.title}</h2>
              <p className="m-0 font-body text-[0.9rem] leading-snug text-text-muted">{step.body}</p>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={`Étape ${dotPosition + 1} sur ${targetedSteps.length}`}>
            {targetedSteps.map((candidate, dotIndex) => (
              <li
                key={candidate.id}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${dotIndex === dotPosition ? 'w-4 bg-brand' : 'w-1.5 bg-border'}`}
              />
            ))}
          </ol>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {isLast ? null : (
              <button
                type="button"
                onClick={finish}
                className="cursor-pointer rounded-full border-0 bg-transparent px-3 py-2 font-body text-[0.85rem] font-medium text-text-muted transition-colors hover:text-text"
              >
                Passer
              </button>
            )}
            {isFirst ? null : (
              <button
                type="button"
                onClick={() => goTo(-1)}
                className="cursor-pointer rounded-full border border-border bg-bg-subtle px-3.5 py-2 font-body text-[0.85rem] font-semibold text-text transition-colors hover:bg-bg"
              >
                Retour
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (isLast ? finish() : goTo(1))}
              className="cursor-pointer rounded-full border-0 bg-brand px-4 py-2 font-body text-[0.85rem] font-semibold text-bg transition-opacity hover:opacity-90"
            >
              {isLast ? "C'est parti" : step.target ? 'Suivant' : 'Commencer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
