// The app's one loading indicator: a spinner, a bold arc with round ends
// turning fast while it stretches and shrinks (.loading-spinner in
// overrides.css), over a faint ring. In the text colour of where it sits,
// at 1.2 em: 18 px in a 15 px button. `label` is announced to screen
// readers; pass `label={null}` when the surrounding element already says
// what's loading and the spinner is only decoration. (Named for the dots it
// replaced; every loading state imports it.)
function LoadingDots({ label = 'Chargement', className = '' }) {
  const a11y = label
    ? { role: 'status', 'aria-live': 'polite', 'aria-label': label }
    : { 'aria-hidden': true }

  return (
    <span className={`inline-flex items-center justify-center ${className}`} {...a11y}>
      <svg viewBox="0 0 24 24" fill="none" className="loading-spinner size-[1.2em] shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3.4" opacity="0.18" />
        <circle className="loading-spinner-arc" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" pathLength="100" />
      </svg>
    </span>
  )
}

export default LoadingDots
