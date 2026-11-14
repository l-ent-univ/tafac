import { Icon } from '@iconify/react'
import { CARD_CLASSES, MUTED_FILL_CLASSES } from '../settingsStyles'

// A row's left side: an icon in a muted circle (or `media`, e.g. an avatar,
// in its place), the label, and a description under it.
export function RowText({ icon, media = null, label, description }) {
  return (
    <span className="flex min-w-0 items-center gap-[10px]">
      {media ?? (icon ? (
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${MUTED_FILL_CLASSES}`} aria-hidden="true">
          <Icon icon={icon} className="h-[17px] w-[17px] text-[var(--color-text)]" />
        </span>
      ) : null)}
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="font-body text-[16px] font-medium leading-[1.2] tracking-[-0.3125px] text-[var(--color-text)]">{label}</span>
        {description ? (
          <span className="font-body text-[13px] font-medium leading-[1.35] text-text-60">{description}</span>
        ) : null}
      </span>
    </span>
  )
}

// Titled card of solid glass; its rows split by engraved hairlines, inset
// from both sides (.settings-rows).
export default function SettingsGroup({ title, footer, children }) {
  return (
    <div className="flex flex-col gap-[7px]">
      {title ? (
        <h4 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">{title}</h4>
      ) : null}
      <div className={`${CARD_CLASSES} settings-rows`}>
        {children}
      </div>
      {footer ? (
        <p className="m-0 px-1 font-body text-[13px] font-medium leading-[1.4] text-text-50">{footer}</p>
      ) : null}
    </div>
  )
}
