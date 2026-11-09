import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { trackPlanningAction } from '../analytics'
import { weekRangeText } from '../planningDates'
import { prepareTimetableMail, prepareWeekImage, shareFileName, weekImageAlt } from '../planningShare'
import { usePlanningExport } from '../usePlanningExport'
import { useSheetDrag } from '../useSheetDrag'
import CloseButton from './CloseButton'
import { GROUP_CARD_CLASSES, GroupRow } from './GroupCard'
import LoadingDots from './LoadingDots'

// A row's word after an action (« Copiée »), this long.
const FEEDBACK_MS = 2500
const EXPORT_DETAILS = { loading: 'Export…', empty: 'Aucun cours à exporter', error: 'Export indisponible pour le moment' }

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const canCopyImage = () => typeof window !== 'undefined' && typeof window.ClipboardItem === 'function' && Boolean(navigator.clipboard?.write)

// An app of the sheet's top row, as the iPhone's share sheet has them: a
// rounded tile, its name under it.
function ShareTile({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-[76px] cursor-pointer flex-col items-center gap-2 border-0 bg-transparent p-0 text-text disabled:cursor-default disabled:opacity-50 focus-visible:outline-none"
    >
      <span className="inline-flex size-[58px] items-center justify-center corners-[16px] border border-border bg-widget-bg shadow-xs transition-transform duration-150 group-enabled:group-active:scale-95 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand">
        <Icon icon={icon} className="size-[26px]" aria-hidden="true" />
      </span>
      <span className="font-body text-[12.5px] font-medium leading-none text-text-secondary">{label}</span>
    </button>
  )
}

// « Partager » (the Planning's header): the week shown drawn as an image
// (src/weekCardImage.js) at the top of a sheet laid out as the iPhone's
// share sheet: the apps in a row (a mail in the Messagerie, the system's
// share where the browser has it), then the actions (copy the image, save
// it, the .ics export). `days`: the week's columns, `status`: its state
// (usePlanningWeeks' statusOn), drawn once it's in. `onComposeMail`: App's,
// null without the in-app mail page (no Mail tile).
function PlanningShareSheet({ monday, days, events, status, accentFor, group = '', selection, onClose, onComposeMail = null }) {
  const dialogRef = useRef(null)
  const dismiss = useSheetDrag(dialogRef, onClose)
  const [drawn, setDrawn] = useState(null)
  const [drawFailed, setDrawFailed] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const exporter = usePlanningExport(selection, { from: 'share' })
  const isReady = status === 'loaded' || status === 'no-timetable'
  const isUnavailable = status === 'unavailable' || status === 'unconfigured'

  // The week's classes, as one key: drawn again only when they change.
  const weekEvents = useMemo(() => events.filter((event) => days.includes(event.day)), [events, days])
  const signature = `${days.join(',')}|${weekEvents.map((event) => `${event.id}:${event.start}:${event.end}:${accentFor(event.title)}`).join(',')}`

  useEffect(() => {
    if (!isReady) return undefined
    let alive = true
    let url = null
    prepareWeekImage({ monday, days, events: weekEvents, accentFor, group })
      .then((image) => {
        if (!alive) return
        url = URL.createObjectURL(image.blob)
        setDrawn({ ...image, url, file: new File([image.blob], shareFileName(monday), { type: 'image/png' }) })
        setDrawFailed(false)
      })
      .catch(() => {
        if (alive) setDrawFailed(true)
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, monday, signature, group])

  useEffect(() => {
    if (!feedback) return undefined
    const timeoutId = window.setTimeout(() => setFeedback(null), FEEDBACK_MS)
    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  // Focus in, Escape out, focus back where it was.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const handleKey = (keyEvent) => {
      if (keyEvent.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (previous?.isConnected) previous.focus?.({ preventScroll: true })
    }
  }, [dismiss])

  const canShareFile = Boolean(drawn && navigator.canShare?.({ files: [drawn.file] }))
  const report = (method, result = 'ok') => trackPlanningAction('week_shared', { method, result })

  const writeMail = () => {
    if (!drawn || !onComposeMail) return
    report('mail')
    onComposeMail(prepareTimetableMail({ monday, drawn }))
  }

  // The system's share (Messages, WhatsApp, AirDrop…): straight from the
  // tap, the image already drawn (Safari wants the gesture).
  const shareFile = async () => {
    if (!drawn) return
    try {
      await navigator.share({ files: [drawn.file], title: weekImageAlt(monday) })
      report('system')
    } catch (error) {
      report('system', error?.name === 'AbortError' ? 'cancelled' : 'error')
    }
  }

  const copyImage = async () => {
    if (!drawn) return
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': drawn.blob })])
      setFeedback({ id: 'copy', text: 'Copiée' })
      report('copy')
    } catch {
      setFeedback({ id: 'copy', text: 'Copie impossible' })
      report('copy', 'error')
    }
  }

  const saveImage = () => {
    if (!drawn) return
    saveBlob(drawn.blob, shareFileName(monday))
    setFeedback({ id: 'save', text: 'Enregistrée' })
    report('download')
  }

  const hasTiles = Boolean(onComposeMail) || canShareFile
  const range = weekRangeText(monday)

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={dismiss} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog planning-sheet relative isolate flex max-h-[min(820px,calc(100dvh-40px))] w-[min(560px,100%)] flex-col modal-corners [--modal-inset:24px] [--modal-inner-radius:20px] max-sm:[--modal-inset:16px] max-sm:[--modal-inner-radius:18px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-share-title"
        tabIndex={-1}
      >
        <div className="gd-clip relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
            <header className="relative">
              <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
              <div className="flex items-center gap-3 px-6 pt-4 pb-3 max-sm:px-4 max-sm:pt-[18px]">
                <div className="grid min-w-0 flex-1 gap-1">
                  <h2 id="planning-share-title" className="m-0 font-body text-[16px] font-semibold leading-tight text-text">Partager le planning</h2>
                  <p className="m-0 truncate font-body text-[13px] font-medium leading-none text-text-muted">{range}</p>
                </div>
                <CloseButton glass onClick={dismiss} />
              </div>
            </header>

            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-1 pb-6 max-sm:px-4 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">
              {/* The image as it'll be sent. */}
              <div className="flex min-h-[180px] items-center justify-center overflow-hidden corners-[14px] border border-border bg-widget-bg">
                {drawn ? (
                  <img
                    src={drawn.url}
                    width={drawn.width}
                    height={drawn.height}
                    alt={weekImageAlt(monday)}
                    className="block h-auto max-h-[46dvh] w-full object-contain"
                  />
                ) : (
                  <p className="m-0 px-4 py-6 text-center font-body text-[14px] font-medium text-text-secondary" role="status">
                    {drawFailed || isUnavailable ? 'Planning indisponible pour cette semaine' : <LoadingDots label="Préparation de l’image" className="w-5" />}
                  </p>
                )}
              </div>

              {hasTiles ? (
                <div className="flex flex-wrap justify-center gap-3 max-sm:justify-start">
                  {onComposeMail ? <ShareTile icon="ph:envelope-simple" label="Mail" onClick={writeMail} disabled={!drawn} /> : null}
                  {canShareFile ? <ShareTile icon="ph:export" label="Partager" onClick={() => void shareFile()} disabled={!drawn} /> : null}
                </div>
              ) : null}

              <ul className={GROUP_CARD_CLASSES}>
                {canCopyImage() ? (
                  <GroupRow
                    icon="ph:copy"
                    title="Copier l’image"
                    trailing={feedback?.id === 'copy' ? feedback.text : ' '}
                    onClick={drawn ? () => void copyImage() : undefined}
                  />
                ) : null}
                <GroupRow
                  icon="ph:download-simple"
                  title="Enregistrer l’image"
                  detail={shareFileName(monday)}
                  trailing={feedback?.id === 'save' ? feedback.text : ' '}
                  onClick={drawn ? saveImage : undefined}
                />
                {selection ? (
                  <GroupRow
                    icon="ph:calendar-plus"
                    title="Exporter vers un agenda"
                    detail={EXPORT_DETAILS[exporter.state] ?? 'Fichier .ics des 60 prochains jours'}
                    trailing=" "
                    onClick={exporter.state === 'loading' ? undefined : () => void exporter.run()}
                  />
                ) : null}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default PlanningShareSheet
