// A ring filled to `value` (0 to 1) in `color`, drawn in on arrival like
// « UE validées »' segments, its content in the middle: the bus countdown
// and the RU's service on their pages.
export default function ProgressRing({ value, color, label, children, className = '' }) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <div className={`relative flex shrink-0 items-center justify-center ${className}`}>
      <svg viewBox="0 0 120 120" className="progress-ring block size-full -rotate-90 overflow-visible" role="img" aria-label={label}>
        <circle cx="60" cy="60" r="50" pathLength="100" className="progress-ring-track" />
        <circle
          cx="60"
          cy="60"
          r="50"
          pathLength="100"
          className="progress-ring-value"
          style={{ stroke: color, strokeDasharray: `${clamped * 100} 100` }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
