import LoadingDots from './LoadingDots'

function LentButton({ children, className = '', type = 'button', loading = false, ...props }) {
  const disabled = props.disabled || loading
  const classes = [
    'lent-button min-h-[52px] px-7 py-[16px] border-0 corners-[32px] bg-brand text-white font-semibold text-[17px] leading-[1.06] whitespace-nowrap transition-all duration-[180ms] ease-in-out hover:not-disabled:scale-[1.02] active:not-disabled:scale-[0.98] disabled:opacity-50 disabled:cursor-wait disabled:shadow-none relative',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} {...props} disabled={disabled}>
      <span className={`block transition-opacity duration-150 ${loading ? 'opacity-0' : ''}`}>{children}</span>
      {loading && (
        <LoadingDots label={null} className="absolute inset-0" />
      )}
    </button>
  )
}

export default LentButton
