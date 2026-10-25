import { Icon } from '@iconify/react'

function SidebarStatPocket({
  icon,
  label,
  value,
  max,
  caption,
  accentHue = null,
  onClick,
  ariaLabel,
  tooltipPrimary,
  tooltipSecondary,
  disabled = false,
}) {
  const gradient = !disabled && accentHue != null
    ? `linear-gradient(180deg, hsla(${accentHue}, 60%, 72%, 0.28) 0%, transparent 70%)`
    : 'none'
  const gradientDark = !disabled && accentHue != null
    ? `linear-gradient(180deg, hsla(${accentHue}, 45%, 22%, 0.55) 0%, transparent 70%)`
    : 'none'
  const hasTooltip = Boolean(tooltipPrimary || tooltipSecondary)
  const handleClick = (event) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    onClick?.(event)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        '--grade-gradient': gradient,
        '--grade-gradient-dark': gradientDark,
      }}
      className={`sidebar-grade-pocket group relative flex flex-col items-start gap-[10px] flex-1 min-w-0 px-[14px] py-[12px] border corners-[22px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] transition-[transform,box-shadow] duration-150 ease-in-out ${disabled ? 'grade-feature-disabled' : 'border-white dark:border-[rgba(255,255,255,0.08)] text-text cursor-pointer hover:shadow-[0_6px_10px_-1px_rgba(0,0,0,0.12),0_3px_6px_-2px_rgba(0,0,0,0.12)]'}`}
      aria-label={ariaLabel}
      aria-disabled={disabled ? 'true' : undefined}
    >
      <div className="flex items-center gap-[5px] min-w-0 max-w-full">
        <Icon icon={icon} className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
        <span className="m-0 min-w-0 leading-[1.06] text-base font-medium overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
        </span>
      </div>
      <div className="flex flex-col items-start gap-[2px] min-w-0 max-w-full">
        <div className="flex items-end gap-[3px] leading-[1.06]">
          <span className="font-display text-[37px] font-bold leading-none whitespace-nowrap">{value}</span>
          <span className="text-[19px] font-medium leading-[1.06] whitespace-nowrap pb-[3px]">/{max}</span>
        </div>
        {caption ? (
          <span
            className="block min-w-0 max-w-full leading-[1.06] text-base font-medium overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {caption}
          </span>
        ) : null}
      </div>
      {hasTooltip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 flex flex-col items-center gap-[2px] w-max max-w-[260px] -translate-x-1/2 translate-y-1 scale-95 whitespace-normal text-center corners-[14px] border border-white/70 bg-[rgba(17,24,39,0.92)] px-3 py-[6px] text-[12px] font-medium leading-tight text-white opacity-0 shadow-[0_12px_32px_rgba(17,24,39,0.18)] transition-[opacity,transform] duration-180 ease-out invisible group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100"
        >
          {tooltipPrimary ? <span className="block font-semibold">{tooltipPrimary}</span> : null}
          {tooltipSecondary ? (
            <span className="block text-[11px] text-white/70">{tooltipSecondary}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}

export default SidebarStatPocket
