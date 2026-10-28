// The app's switch (Réglages, the debug menu's toggles, the composer's
// signature). `small`: a notch smaller, beside a field's text.
function Switch({ checked, onChange, small = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full border-0 p-0 transition-colors duration-150 ease-in-out cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${small ? 'h-[22px] w-[38px]' : 'h-[26px] w-[44px]'} ${checked ? 'bg-text' : 'bg-text-30'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[3px] top-[3px] rounded-full bg-widget-bg shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-150 ease-in-out ${small ? 'size-4' : 'size-5'} ${checked ? (small ? 'translate-x-4' : 'translate-x-[18px]') : 'translate-x-0'}`}
      />
    </button>
  )
}

export default Switch
