import { Switch } from '../AccountModal'
import { MUTED_FILL_CLASSES } from '../../settingsStyles'

// The debug menu's building blocks, in the Réglages look: titled cards split
// by hairlines, a label and a short helper on the left, the control on the
// right. Denser than Réglages, as the menu packs a lot.

const BUTTON_TONES = {
  default: `${MUTED_FILL_CLASSES} text-text hover:not-disabled:bg-bg-muted`,
  // The last call's button, or the action the form leads to.
  active: 'bg-text text-bg',
  danger: 'bg-error-bg text-error hover:not-disabled:brightness-95',
}

export function DebugButton({ tone = 'default', className = '', type = 'button', children, ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-[6px] rounded-full border-0 px-[14px] font-body text-[14px] font-medium leading-none whitespace-nowrap transition-[background-color,filter,opacity] duration-[120ms] cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function DebugField({ label, mono = false, ...props }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
      <span className="px-1 font-body text-[12px] font-semibold leading-none text-text-60">{label}</span>
      <input
        className={`box-border h-10 w-full min-w-0 rounded-full border border-border-input bg-bg px-4 text-text transition-[border-color] duration-150 hover:border-text-30 focus-visible:border-text-60 ${mono ? 'font-mono text-[13px]' : 'font-body text-[14px]'}`}
        {...props}
      />
    </label>
  )
}

// Titled card; `id` lets the header's shortcuts scroll to it.
export function DebugSection({ id, title, children }) {
  return (
    <section id={id} className="flex scroll-mt-1 flex-col gap-[7px]" aria-label={title}>
      <h2 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">{title}</h2>
      <div className="card-corners-sm overflow-hidden border border-border bg-widget-bg divide-y divide-border">
        {children}
      </div>
    </section>
  )
}

export function DebugRowText({ label, hint }) {
  return (
    <span className="flex min-w-0 flex-[1_1_160px] flex-col gap-[3px]">
      <span className="font-body text-[15px] font-medium leading-[1.2] tracking-[-0.2px] text-text">{label}</span>
      {hint ? <span className="font-body text-[12.5px] font-medium leading-[1.35] text-text-60 break-words">{hint}</span> : null}
    </span>
  )
}

// Label and helper, then the controls; they drop under the label when the
// row runs out of room (phones).
export function DebugRow({ label, hint, children }) {
  return (
    <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-[10px]">
      <DebugRowText label={label} hint={hint} />
      {children ? <div className="flex flex-wrap items-center gap-[6px]">{children}</div> : null}
    </div>
  )
}

// A row whose whole surface flips the switch, as in Réglages.
export function DebugSwitchRow({ label, hint, checked, onChange }) {
  return (
    <label className="flex min-h-[54px] cursor-pointer items-center justify-between gap-3 px-4 py-[10px]">
      <DebugRowText label={label} hint={hint} />
      <Switch checked={checked} onChange={onChange} />
    </label>
  )
}

// One pressed among a few: the theme, the output's tabs.
export function DebugSegmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex shrink-0 items-center gap-[2px] rounded-full p-[3px] ${MUTED_FILL_CLASSES}`}>
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          className={`h-[30px] rounded-full border-0 px-3 font-body text-[13px] font-medium leading-none cursor-pointer transition-colors duration-[120ms] ${value === optionValue ? 'bg-text text-bg' : 'bg-transparent text-text-60 hover:text-text'}`}
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  )
}
