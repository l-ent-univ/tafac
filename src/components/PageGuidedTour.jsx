import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'

const START_DELAY_MS = 600
const TARGET_WAIT_MS = 6000
const MEASURE_INTERVAL_MS = 120
const HIGHLIGHT_PADDING = 6
const CARD_GAP = 14
const VIEWPORT_MARGIN = 16
const CARD_WIDTH = 350

function findTarget(name) {
  if (!name || typeof document === 'undefined') return null
  return [...document.querySelectorAll(`[data-tour="${name}"]`)].find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null
}

function placeCard(rect, cardHeight) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)

  if (!rect) {
    return {
      width,
      left: (viewportWidth - width) / 2,
      top: Math.max(VIEWPORT_MARGIN, (viewportHeight - cardHeight) / 2),
    }
  }

  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - width / 2),
    viewportWidth - width - VIEWPORT_MARGIN,
  )
  const below = rect.bottom + HIGHLIGHT_PADDING + CARD_GAP
  const above = rect.top - HIGHLIGHT_PADDING - CARD_GAP - cardHeight
  const fitsBelow = below + cardHeight <= viewportHeight - VIEWPORT_MARGIN
  const top = fitsBelow || above < VIEWPORT_MARGIN ? below : above

  return {
    width,
    left,
    top: Math.min(Math.max(VIEWPORT_MARGIN, top), viewportHeight - cardHeight - VIEWPORT_MARGIN),
  }
}

export default function PageGuidedTour({
  storageKey,
  steps = [],
  enabled = true,
  manualTrigger = 0,
}) {
  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(-1)
  const [highlight, setHighlight] = useState(null)
  const [cardHeight, setCardHeight] = useState(180)
  const [animatingOut, setAnimatingOut] = useState(false)
  const cardRef = useRef(null)
  const directionRef = useRef(1)

  // Check if tour is already completed in localStorage
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      const done = localStorage.getItem(storageKey) === 'done'
      if (!done && enabled) {
        setActive(true)
      }
    } catch {
      // Best effort: nothing to do when it fails.
    }
  }, [storageKey, enabled])

  // Support manual trigger (replay button)
  useEffect(() => {
    if (manualTrigger > 0 && steps.length > 0) {
      setActive(true)
      setStepIndex(0)
    }
  }, [manualTrigger, steps.length])

  // Start tour with delay to let page render
  useEffect(() => {
    if (!active || !enabled || stepIndex !== -1 || !steps.length) return undefined

    let cancelled = false
    let pollTimer = 0
    const deadline = Date.now() + TARGET_WAIT_MS + START_DELAY_MS

    const tryStart = () => {
      if (cancelled) return
      const firstTargeted = steps.find((s) => s.target)
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
  }, [active, enabled, stepIndex, steps])

  const finish = useCallback(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, 'done')
      } catch {
        // Best effort: nothing to do when it fails.
      }
    }
    setAnimatingOut(true)
    setTimeout(() => {
      setActive(false)
      setStepIndex(-1)
      setAnimatingOut(false)
    }, 220)
  }, [storageKey])

  const isStepAvailable = useCallback((candidate) => {
    if (!candidate?.target) return true
    return findTarget(candidate.target) !== null
  }, [])

  const findNextAvailable = useCallback((currentIndex, direction) => {
    for (let next = currentIndex + direction; next >= 0 && next < steps.length; next += direction) {
      if (isStepAvailable(steps[next])) return next
    }
    return -1
  }, [isStepAvailable, steps])

  const goTo = useCallback((direction) => {
    directionRef.current = direction
    const next = findNextAvailable(stepIndex, direction)
    if (next === -1) {
      if (direction === 1) finish()
      return
    }
    setStepIndex(next)
  }, [findNextAvailable, finish, stepIndex])

  const step = stepIndex >= 0 ? steps[stepIndex] : null
  const running = active && step !== null

  // Follow the target element on screen
  useEffect(() => {
    if (!running) return undefined

    const target = findTarget(step?.target)
    if (!target) {
      setHighlight(null)
      return undefined
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

    const measure = () => {
      const element = findTarget(step?.target)
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
  }, [goTo, running, step])

  // Keyboard navigation
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
  const isFirst = findNextAvailable(stepIndex, -1) === -1
  const isLast = findNextAvailable(stepIndex, 1) === -1
  const targetedSteps = steps.filter((candidate) => candidate.target ? isStepAvailable(candidate) : true)
  const dotPosition = targetedSteps.indexOf(step)

  return (
    <div
      className={`fixed inset-0 z-[70] ${animatingOut ? 'animate-[pwa-backdrop-out_220ms_ease-in_forwards]' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-tour-title"
    >
      <div className="absolute inset-0" onClick={finish} />
      {step.target && highlight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-[18px] shadow-[0_0_0_9999px_rgba(0,0,0,0.62)] ring-2 ring-white/90 transition-[left,top,width,height] duration-300 ease-out"
          style={{
            left: highlight.left - HIGHLIGHT_PADDING,
            top: highlight.top - HIGHLIGHT_PADDING,
            width: highlight.width + HIGHLIGHT_PADDING * 2,
            height: highlight.height + HIGHLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-black/60 backdrop-blur-xs" />
      )}

      <div
        ref={cardRef}
        className="fixed z-10 rounded-[22px] border border-white dark:border-[rgba(255,255,255,0.12)] bg-widget-bg p-5 shadow-[0_20px_50px_var(--color-shadow)] backdrop-blur-xl transition-[left,top] duration-300 ease-out animate-scaleIn text-text"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <div className="flex items-start gap-3.5">
          {step.icon && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand">
              <Icon icon={step.icon} className="size-5" aria-hidden="true" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="page-tour-title" className="m-0 font-body text-[1.05rem] font-bold leading-tight text-text">
              {step.title}
            </h2>
            <p className="m-0 font-body text-[0.88rem] leading-snug text-text-secondary">
              {step.body}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-3 pt-1 border-t border-border/50">
          <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={`Étape ${dotPosition + 1} sur ${targetedSteps.length}`}>
            {targetedSteps.map((candidate, dotIndex) => (
              <li
                key={candidate.id}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${
                  dotIndex === dotPosition ? 'w-4 bg-brand' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </ol>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {!isLast && (
              <button
                type="button"
                onClick={finish}
                className="cursor-pointer rounded-full border-0 bg-transparent px-3 py-1.5 font-body text-[0.84rem] font-medium text-text-muted transition-colors hover:text-text"
              >
                Passer
              </button>
            )}
            {!isFirst && (
              <button
                type="button"
                onClick={() => goTo(-1)}
                className="cursor-pointer rounded-full border border-border bg-bg-subtle px-3 py-1.5 font-body text-[0.84rem] font-semibold text-text transition-colors hover:bg-bg"
              >
                Retour
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (isLast ? finish() : goTo(1))}
              className="cursor-pointer rounded-full border-0 bg-brand px-4 py-1.5 font-body text-[0.84rem] font-semibold text-bg transition-opacity hover:opacity-90 shadow-2xs"
            >
              {isLast ? "C'est parti !" : step.target ? 'Suivant' : 'Commencer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
