import { Icon } from '@iconify/react'
import Tooltip from './Tooltip'
import UpdateNotice from './UpdateNotice'
import { installDesktopUpdate, useDesktopUpdate } from '../desktopUpdate'

// Desktop app: an update is downloaded and ready (src/desktopUpdate.js).
// Quitting installs it; a click does it now (« Non installée » if that
// failed: the click tries again). The web's « Nouvelle version » card, the
// rocket and the shimmer, at the bottom of the sidebar above the account.
// Nothing off the app, or while there's none.

function useReadyUpdate() {
  const update = useDesktopUpdate()
  if (!update || update.required) return null
  return update.phase === 'ready' || update.phase === 'installing' ? update : null
}

function DesktopUpdateRow() {
  const update = useReadyUpdate()
  if (!update) return null

  return (
    <UpdateNotice
      onUpdateClick={installDesktopUpdate}
      busy={update.phase === 'installing'}
      title="Mise à jour prête"
      action={update.failed ? 'Non installée · Réessayer' : `Redémarrer · ${update.version}`}
      busyAction="Redémarrage…"
      label={`Mise à jour prête, redémarrer pour passer à Tafac ${update.version}`}
    />
  )
}

// The folded sidebar's: the rocket alone, with the new dot (as the web's).
export function CompactDesktopUpdateButton() {
  const update = useReadyUpdate()
  if (!update) return null
  const installing = update.phase === 'installing'

  return (
    <button
      type="button"
      onClick={installDesktopUpdate}
      disabled={installing}
      aria-busy={installing || undefined}
      aria-label={`Mise à jour prête, redémarrer pour passer à Tafac ${update.version}`}
      className="glass-solid group relative inline-flex items-center justify-center size-10 rounded-full border text-text cursor-pointer transition-[background-color] duration-150 hover:bg-brand-subtle disabled:opacity-50 disabled:cursor-wait"
    >
      <Icon icon="ph:rocket" className="size-4" aria-hidden="true" />
      <span className="changelog-new-dot absolute top-[6px] right-[6px] size-[7px] rounded-full" aria-hidden="true" />
      <Tooltip
        side="right"
        title={installing ? 'Redémarrage…' : 'Mise à jour prête'}
        detail={installing ? null : update.failed ? 'Non installée · Réessayer' : `Redémarrer · Tafac ${update.version}`}
      />
    </button>
  )
}

export default DesktopUpdateRow
