import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import SettingsGroup, { RowText } from './SettingsGroup'
import LoadingDots from './LoadingDots'
import SmoothSurface from './SmoothSurface'
import { PRESSABLE_ROW_CLASSES, ROW_CLASSES, WELL_CLASSES } from '../settingsStyles'
import {
  checkDesktopUpdates,
  describeChecked,
  describeDownload,
  describeUpdateNote,
  downloadProgress,
  installDesktopUpdate,
  useDesktopUpdate,
} from '../desktopUpdate'

// Réglages › À propos, « Mises à jour », in the desktop app only
// (src/desktopUpdate.js), under the hero:
// - the version and where its update is (up to date, downloading with the
//   bar, ready with « Redémarrer »);
// - « Rechercher les mises à jour », the menu's check, with when the last
//   one was and what this one found;
// - after a failed install, the installer to get by hand.
// A local 0.0.0 build doesn't look for updates: it says so, no check.

const NOTE_SHOWN_MS = 8000
const CLOCK_EVERY_MS = 30 * 1000

// What the card says under the version, and its icon.
function describeStatus(update) {
  if (!update.enabled) return { icon: 'ph:wrench', text: 'Version de développement, sans mises à jour' }
  if (update.phase === 'installing') return { icon: 'ph:rocket-launch', text: 'Redémarrage…' }
  if (update.phase === 'ready') {
    return { icon: 'ph:rocket', text: update.failed ? `${update.version} non installée` : `${update.version} prête à installer` }
  }
  if (update.phase === 'downloading') return { icon: 'ph:download-simple', text: `Téléchargement de la ${update.version}` }
  if (update.failed) return { icon: 'ph:warning-circle', text: 'Mise à jour non installée' }
  if (update.checked) return { icon: 'ph:check-circle', text: 'À jour' }
  return { icon: 'ph:clock', text: 'Pas encore vérifiée' }
}

// The first row: the version, where its update is, « Redémarrer » once
// it's ready, and the download's bar under it while it comes.
function StatusRow({ update }) {
  const status = describeStatus(update)
  const ready = update.phase === 'ready' || update.phase === 'installing'
  const installing = update.phase === 'installing'
  const downloading = update.phase === 'downloading'

  return (
    <div className="flex flex-col">
      <div className={ROW_CLASSES}>
        <RowText
          icon={status.icon}
          label={`Tafac ${update.current}`}
          description={downloading ? `${status.text} · ${describeDownload(update)}` : status.text}
        />
        {ready ? (
          <button
            type="button"
            onClick={installDesktopUpdate}
            disabled={installing}
            aria-busy={installing || undefined}
            className="lent-button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border-0 px-3 cursor-pointer disabled:cursor-wait"
          >
            <SmoothSurface />
            {installing ? <LoadingDots label={null} className="text-[13px]" /> : null}
            <span className="font-body text-[13px] font-semibold leading-none">
              {update.failed ? 'Réessayer' : 'Redémarrer'}
            </span>
          </button>
        ) : null}
      </div>
      {downloading ? (
        <div className="px-4 pb-[13px]">
          <div className={`${WELL_CLASSES} h-[6px] overflow-hidden rounded-full`} role="progressbar" aria-label="Téléchargement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downloadProgress(update) * 100)}>
            <div
              className="h-full rounded-full bg-text transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.max(3, downloadProgress(update) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// The check's row: the row is the button, the spinner while it looks, then
// what it found for a few seconds, else when the last check was.
function CheckRow({ update }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!note) return undefined
    const timer = window.setTimeout(() => setNote(null), NOTE_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [note])

  const busy = asking || update.checking
  const handleCheck = async () => {
    if (busy) return
    setAsking(true)
    setNote(null)
    const answer = await checkDesktopUpdates()
    setAsking(false)
    setNote(answer)
    setNow(Date.now())
  }

  const lastCheck = describeChecked(update.checked, now)
  const description = busy
    ? 'Recherche…'
    : describeUpdateNote(note) ?? (lastCheck ? `Dernière vérification ${lastCheck}` : 'Toutes les 6 heures et au lancement')

  return (
    <button
      type="button"
      className={`${PRESSABLE_ROW_CLASSES} disabled:cursor-wait`}
      onClick={() => void handleCheck()}
      disabled={busy}
      aria-busy={busy || undefined}
    >
      <RowText icon="ph:arrows-clockwise" label="Rechercher les mises à jour" description={description} />
      {busy
        ? <LoadingDots label={null} className="w-4 shrink-0 text-text-60" />
        : <Icon icon="ph:caret-right" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />}
    </button>
  )
}

function DesktopUpdateSettings() {
  const update = useDesktopUpdate()
  if (!update) return null
  const offerInstaller = update.failed && update.download

  return (
    <SettingsGroup title="Mises à jour">
      <StatusRow update={update} />
      {update.enabled ? <CheckRow update={update} /> : null}
      {offerInstaller ? (
        <a
          href={update.download}
          target="_blank"
          rel="noreferrer"
          className={`${PRESSABLE_ROW_CLASSES} no-underline`}
        >
          <RowText icon="ph:download-simple" label="Télécharger l’installateur" description="Pour installer la nouvelle version à la main" />
          <Icon icon="ph:arrow-up-right" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />
        </a>
      ) : null}
    </SettingsGroup>
  )
}

export default DesktopUpdateSettings
