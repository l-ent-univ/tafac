import { useEffect, useRef, useState } from 'react'
import LentButton from './LentButton'
import ClothBackdrop from './ClothBackdrop'
import DownloadIcon3D from './DownloadIcon3D'
import {
  describeDownload,
  describeSize,
  describeUpdateNote,
  downloadProgress,
  installDesktopUpdate,
  onDesktopUpdateNote,
  useDesktopUpdate,
} from '../desktopUpdate'

// Desktop app: what its updates show over the page (src/desktopUpdate.js),
// in a root of their own (main.jsx), so they show whether or not the app
// itself has started:
// - « Mise à jour nécessaire », when the running version can't sign in any
//   more: it takes the page, nothing behind it can be reached. The app's
//   widgets press through a cloth behind it (ClothBackdrop), the dialog
//   with the 3D download icon (DownloadIcon3D) in the middle;
// - the answer to the menu's « Rechercher les mises à jour… », a short note
//   in the window's top corner.
// The update that is ready has its row in the sidebar (DesktopUpdateRow).

const NOTE_MS = 4000
const APP_ROOT_ID = 'root'

// The note's dot: green when there is nothing to do.
const SETTLED_NOTES = new Set(['current', 'ready'])

function UpdateNote() {
  const [note, setNote] = useState(null)

  useEffect(() => {
    let timer = null
    const stop = onDesktopUpdateNote((detail) => {
      const text = describeUpdateNote(detail)
      if (!text) return
      window.clearTimeout(timer)
      setNote({ key: Date.now(), text, settled: SETTLED_NOTES.has(detail.kind) })
      timer = window.setTimeout(() => setNote(null), NOTE_MS)
    })
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [])

  return (
    // Below the band that moves the window (macOS), and nothing to click.
    <div className="desktop-update-note pointer-events-none fixed right-4 top-4 z-[70] flex justify-end" role="status" aria-live="polite">
      {note ? (
        <div key={note.key} className="glass-solid flex max-w-[calc(100vw-32px)] items-center gap-2 corners-[12px] px-3 py-2 animate-modal-card-in">
          <span className={`size-2 shrink-0 rounded-full ${note.settled ? 'bg-success' : 'bg-ink-muted'}`} aria-hidden="true" />
          <span className="font-body text-[13px] font-medium leading-[1.3] text-text">{note.text}</span>
        </div>
      ) : null}
    </div>
  )
}

// The line under the button: the versions and the download's size, then
// where the update is.
function describeStep(update, { busy, restarting }) {
  if (update.failed) return 'La mise à jour a échoué'
  if (restarting) return 'Redémarrage…'
  if (busy) return `Téléchargement · ${describeDownload(update)}`
  const versions = update.version ? `Tafac ${update.current} → ${update.version}` : `Tafac ${update.current}`
  return update.total ? `${versions} · ${describeSize(update.total)}` : versions
}

function RequiredSheet({ update }) {
  // « Mettre à jour » was pressed: the download's progress, then the restart.
  const [asked, setAsked] = useState(false)
  const buttonRef = useRef(null)
  const busy = asked && !update.failed
  const restarting = busy && (update.phase === 'ready' || update.phase === 'installing')

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true })
  }, [busy])

  // Nothing behind the sheet can be reached, by pointer or keyboard.
  useEffect(() => {
    const appRoot = document.getElementById(APP_ROOT_ID)
    if (!appRoot) return undefined
    appRoot.inert = true
    return () => {
      appRoot.inert = false
    }
  }, [])

  const handleUpdate = () => {
    setAsked(true)
    installDesktopUpdate()
  }

  const progress = restarting ? 1 : downloadProgress(update)

  return (
    <div className="desktop-update-sheet fixed inset-0 z-[80] flex items-center justify-center p-5 animate-modal-backdrop-in" role="presentation">
      <ClothBackdrop />
      <section
        className="glass-solid glass--quiet modal-surface relative w-[min(380px,100%)] modal-corners [--modal-inset:24px] [--modal-inner-radius:20px] border text-[var(--color-text)] animate-modal-card-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="desktop-update-title"
        aria-describedby="desktop-update-text"
      >
        <div className="grid justify-items-center gap-3 p-6 text-center">
          <DownloadIcon3D size={92} className="-mt-2 -mb-1" />
          <div className="grid gap-[6px]">
            <h2 id="desktop-update-title" className="m-0 text-[18px] font-bold leading-[1.2] tracking-[-0.01em]">Mise à jour nécessaire</h2>
            <p id="desktop-update-text" className="m-0 text-[14px] font-medium leading-[1.4] text-text-muted">
              Cette version de Tafac ne peut plus se connecter à l’université
            </p>
          </div>
          {busy ? (
            <div
              className="mt-1 h-[6px] w-full overflow-hidden rounded-full bg-sunken"
              role="progressbar"
              aria-label="Téléchargement de la mise à jour"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear motion-reduce:transition-none"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          ) : (
            <LentButton ref={buttonRef} className="mt-1 w-full" onClick={handleUpdate}>
              {update.failed ? 'Réessayer' : 'Mettre à jour'}
            </LentButton>
          )}
          <span className="font-body text-[12.5px] font-medium leading-[1.3] tabular-nums text-text-muted" aria-live="polite">{describeStep(update, { busy, restarting })}</span>
          {update.failed && update.download ? (
            // A web address: the app opens it in the browser (links.rs).
            <a href={update.download} target="_blank" rel="noreferrer" className="font-body text-[13px] font-medium text-text underline underline-offset-2">
              Télécharger l’installateur
            </a>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function DesktopUpdateLayer() {
  const update = useDesktopUpdate()
  return (
    <>
      {update?.required ? <RequiredSheet update={update} /> : null}
      <UpdateNote />
    </>
  )
}

export default DesktopUpdateLayer
