import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'

// « Nouvelle version »: a new build is waiting (PwaUpdateManager), a tap
// installs it. Quiet: the whole card one button of solid glass, the rocket
// muted, the words shimmering over « Mettre à jour » in small, an arrow at
// its end; no primary button. Two lines, so it fits the sidebar's narrow
// column. `className`: its place (the floating pill over a phone's tab bar,
// the tablet's top). The desktop app's « Mise à jour prête » is the same
// card (DesktopUpdateRow): its own `title` and `action`, and `busy` from the
// app instead of the card's own.
function UpdateNotice({
  onUpdateClick,
  className = '',
  title = 'Nouvelle version',
  action = 'Mettre à jour',
  busyAction = 'Mise à jour…',
  busy,
  label,
}) {
  const [isApplyingHere, setIsApplying] = useState(false)
  const isApplying = busy ?? isApplyingHere

  const handleClick = useCallback(async () => {
    if (isApplying) return
    if (busy !== undefined) {
      onUpdateClick?.()
      return
    }
    setIsApplying(true)
    try {
      await onUpdateClick?.()
    } catch (error) {
      console.error('Failed to apply update', error)
      setIsApplying(false)
    }
  }, [busy, isApplying, onUpdateClick])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isApplying}
      aria-busy={isApplying || undefined}
      aria-label={label}
      className={`glass-solid flex w-full min-w-0 cursor-pointer items-center gap-2.5 corners-[16px] py-2 pr-3 pl-3 text-left disabled:cursor-wait ${className}`}
    >
      <Icon icon="ph:rocket-launch" className="size-[17px] shrink-0 text-text-muted" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          className="min-w-0 truncate bg-[linear-gradient(90deg,var(--color-text-muted)_0%,var(--color-text)_50%,var(--color-text-muted)_100%)] bg-[length:200%_100%] bg-clip-text font-body text-[13.5px] font-semibold leading-[1.2] text-transparent animate-shimmer"
          style={{ animationDuration: '3s' }}
        >
          {title}
        </span>
        <span className="truncate font-body text-[12px] font-medium leading-none text-text-muted">{isApplying ? busyAction : action}</span>
      </span>
      <Icon icon="ph:arrow-right" className="size-[14px] shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  )
}

export default UpdateNotice
