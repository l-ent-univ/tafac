import { useEffect, useRef, useState } from 'react'
import LoadingDots from './LoadingDots'

// A page's first load (Mes notes, Assiduité, the app's own waits): the
// spinner, large, centred in the page, « Chargement… » under it. A wait
// that drags on says so: the line is replaced, each new one springing in
// (scaled up from smaller, a touch past its size) as the last one shrinks
// away (.page-loading-in, -out in overrides.css). Read out as it changes.
const STEPS = [
  { at: 0, text: 'Chargement…' },
  { at: 3000, text: 'Ça prend un peu de temps…' },
  { at: 8000, text: 'L’université met du temps à répondre…' },
  { at: 15000, text: 'Encore quelques secondes…' },
]
const LEAVE_MS = 260

function PageLoading({ className = '' }) {
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(null)
  const leaveTimer = useRef(0)

  useEffect(() => {
    // In order: the line leaving is always the step before.
    const timers = STEPS.slice(1).map(({ at }, index) => setTimeout(() => {
      setLeaving(index)
      setStep(index + 1)
      clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(() => setLeaving(null), LEAVE_MS)
    }, at))
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(leaveTimer.current)
    }
  }, [])

  return (
    <div className={`flex min-h-[45vh] flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center ${className}`} role="status" aria-busy="true">
      <LoadingDots label={null} className="text-[30px] text-text-muted" />
      <span className="page-loading-label" aria-live="polite">
        {leaving != null ? (
          <span key={`out-${leaving}`} className="page-loading-out" aria-hidden="true">{STEPS[leaving].text}</span>
        ) : null}
        <span key={`in-${step}`} className={step > 0 ? 'page-loading-in' : ''}>{STEPS[step].text}</span>
      </span>
    </div>
  )
}

export default PageLoading
