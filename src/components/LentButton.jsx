import LoadingDots from './LoadingDots'
import SmoothSurface from './SmoothSurface'

// The app's primary button: a pill in the brand colour (.lent-button in
// overrides.css for its shadow), 44 px tall unless the caller says
// otherwise, with `!` (min-h-[52px]!): its own size classes would otherwise
// win or lose by the stylesheet's order. Children can mix text and an icon.
// `loading` hides them behind the spinner and holds the button, at full
// strength (aria-busy: overrides.css fades a disabled one, not a busy one).
function LentButton({ children, className = '', type = 'button', loading = false, ...props }) {
  const disabled = props.disabled || loading
  const classes = [
    'lent-button relative inline-flex min-h-[44px] items-center justify-center rounded-full border-0 px-5 py-[11px] font-body text-[15px] font-medium leading-[1.1] whitespace-nowrap cursor-pointer',
    loading ? 'disabled:cursor-wait' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} {...props} disabled={disabled} aria-busy={loading || undefined}>
      <SmoothSurface />
      <span className={`inline-flex items-center gap-[6px] transition-opacity duration-150 ${loading ? 'opacity-0' : ''}`}>{children}</span>
      {loading && (
        <LoadingDots label={null} className="absolute inset-0" />
      )}
    </button>
  )
}

export default LentButton
