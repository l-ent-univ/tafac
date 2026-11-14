import { Icon } from '@iconify/react'
import SmoothSurface from './SmoothSurface'
import Tooltip from './Tooltip'
import { installDesktopUpdate, useDesktopUpdate } from '../desktopUpdate'

// Desktop app: an update is downloaded and ready (src/desktopUpdate.js).
// Quitting installs it; « Redémarrer » does it now (« Non installée » under
// the title if that failed: the button tries again). At the bottom of the
// sidebar, above the account. Nothing off the app, or while there's none.
// Text sits on spans: a <button> takes its font from index.css's
// `button { font: inherit }`, outside Tailwind's layers.

function useReadyUpdate() {
  const update = useDesktopUpdate()
  if (!update || update.required) return null
  return update.phase === 'ready' || update.phase === 'installing' ? update : null
}

function DesktopUpdateRow() {
  const update = useReadyUpdate()
  if (!update) return null
  const installing = update.phase === 'installing'

  return (
    // Its own container: under 236px (a sidebar narrower than the default),
    // the button goes under the words instead of cutting them short.
    <div className="@container w-full">
      <div className="glass-solid flex w-full min-w-0 flex-col gap-2 corners-[16px] p-2 pl-3 @[236px]:flex-row @[236px]:items-center">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="truncate font-body text-[13px] font-semibold leading-[1.2] text-text">Mise à jour prête</span>
            <span className="truncate font-body text-[12px] font-medium leading-none text-text-muted">
              {update.failed ? 'Non installée' : `Tafac ${update.version}`}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={installDesktopUpdate}
          disabled={installing}
          aria-busy={installing || undefined}
          className="lent-button inline-flex h-7 shrink-0 items-center justify-center rounded-full border-0 px-[9px] cursor-pointer disabled:cursor-wait"
        >
          <SmoothSurface />
          <span className="font-body text-[12px] font-medium leading-none">Redémarrer</span>
        </button>
      </div>
    </div>
  )
}

// The folded sidebar's: the arrows alone, with the dot.
export function CompactDesktopUpdateButton() {
  const update = useReadyUpdate()
  if (!update) return null
  const installing = update.phase === 'installing'

  return (
    <button
      type="button"
      onClick={installDesktopUpdate}
      disabled={installing}
      aria-label={`Mise à jour prête, redémarrer pour passer à Tafac ${update.version}`}
      className="glass-solid group relative inline-flex items-center justify-center size-10 rounded-full text-text cursor-pointer transition-[background-color] duration-150 hover:bg-brand-subtle disabled:opacity-50 disabled:cursor-wait"
    >
      <Icon icon="ph:arrows-clockwise" className="size-4" aria-hidden="true" />
      <span className="absolute top-[6px] right-[6px] size-[7px] rounded-full bg-success" aria-hidden="true" />
      <Tooltip title="Mise à jour prête" detail={update.failed ? 'Non installée' : `Redémarrer · Tafac ${update.version}`} />
    </button>
  )
}

export default DesktopUpdateRow
