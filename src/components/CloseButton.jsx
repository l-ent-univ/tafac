// The app's close button: round, with a bold × of rounded strokes. Plain, it
// is a soft tint of the text colour, which reads on any surface in both
// themes; `glass` over a photo or a frosted sheet (.glass-close-button in
// overrides.css). `large`: beside 38 px controls (the settings' header, the
// weather location field).
function CloseButton({ label = 'Fermer', glass = false, large = false, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`close-button ${glass ? 'glass-close-button' : 'close-button--plain'} inline-flex ${large ? 'size-[38px]' : 'size-[34px]'} shrink-0 cursor-pointer items-center justify-center rounded-full border-0 p-0 text-text disabled:cursor-wait disabled:opacity-60 ${className}`}
      {...props}
    >
      <svg viewBox="0 0 14 14" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    </button>
  )
}

export default CloseButton
