import LoadingDots from './LoadingDots'

// The app's primary button: a pill in the brand colour (.lent-button in
// overrides.css for its shadow), 44 px tall unless the caller says
// otherwise, with `!` (min-h-[52px]!): its own size classes would otherwise
// win or lose by the stylesheet's order. Children can mix text and an icon.
// `loading` hides them behind LoadingDots and holds the button.
function LentButton({ children, className = '', type = 'button', loading = false, ...props }) {
  const disabled = props.disabled || loading
  const classes = [
    'lent-button relative inline-flex min-h-[44px] items-center justify-center rounded-full border-0 px-5 py-[11px] font-body text-[15px] font-semibold leading-[1.1] whitespace-nowrap cursor-pointer active:not-disabled:scale-[0.97] disabled:opacity-50 disabled:shadow-none',
    loading ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} {...props} disabled={disabled}>
      <span className={`inline-flex items-center gap-[6px] transition-opacity duration-150 ${loading ? 'opacity-0' : ''}`}>{children}</span>
      {loading && (
        <LoadingDots label={null} className="absolute inset-0" />
      )}
    </button>
  )
}

export default LentButton
