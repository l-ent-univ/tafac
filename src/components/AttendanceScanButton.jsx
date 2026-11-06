import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { parseAttendanceQr } from '../attendanceQr'
import { ENT_AUTH_PREFIX } from '../entApi'

const QR_ORIGIN = universityConfig.attendanceQr?.origin ?? null
const SCAN_INTERVAL_MS = 200
// Enough for a QR filling the frame, and quick to decode on a phone.
const SCAN_WIDTH = 640
const CAMERA_ERROR = "Impossible d'ouvrir la caméra. Autorise-la pour Tafac dans ton navigateur."
const WRONG_QR = "Ce QR code n'est pas un QR de présence du SIUAPS."
const IDLE_HINT = 'Vise le QR code de la séance'

// Full-screen camera. On a valid QR the page leaves for the server's sign-in
// relay, in this tab: a window.open this long after the tap would be blocked.
function AttendanceScanner({ onClose }) {
  const videoRef = useRef(null)
  const closeRef = useRef(null)
  const [hint, setHint] = useState(IDLE_HINT)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let stream = null
    let timer = null
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    function stopCamera() {
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }

    function scan(jsQR) {
      const video = videoRef.current
      if (!active || !video) return

      if (video.videoWidth) {
        canvas.width = Math.min(SCAN_WIDTH, video.videoWidth)
        canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth))
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(data, width, height, { inversionAttempts: 'dontInvert' })

        if (code) {
          const qrUrl = parseAttendanceQr(code.data, QR_ORIGIN)
          if (qrUrl) {
            stopCamera()
            setHint('Connexion au SIUAPS…')
            window.location.assign(`${ENT_AUTH_PREFIX}/attendance/open?url=${encodeURIComponent(qrUrl)}`)
            return
          }
          setHint(WRONG_QR)
        }
      }

      timer = window.setTimeout(() => scan(jsQR), SCAN_INTERVAL_MS)
    }

    async function start() {
      try {
        const [{ default: jsQR }, camera] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        ])
        stream = camera
        if (!active) {
          stopCamera()
          return
        }
        videoRef.current.srcObject = camera
        await videoRef.current.play()
        scan(jsQR)
      } catch {
        if (active) {
          setHint(CAMERA_ERROR)
          setFailed(true)
        }
      }
    }

    start()
    return () => {
      active = false
      stopCamera()
    }
  }, [])

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Scanner ma présence" className="fixed inset-0 z-50 bg-black text-white">
      <video ref={videoRef} muted playsInline aria-hidden="true" className="absolute inset-0 size-full object-cover" />
      {failed ? null : (
        <div aria-hidden="true" className="absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]" />
      )}
      <button
        ref={closeRef}
        type="button"
        aria-label="Fermer"
        className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-black/60 text-white"
        onClick={onClose}
      >
        <Icon icon="ph:x" width="22" height="22" aria-hidden="true" />
      </button>
      <p role="status" className="absolute inset-x-4 bottom-[max(2rem,env(safe-area-inset-bottom))] m-0 text-center text-base font-medium [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
        {hint}
      </p>
    </div>,
    document.body,
  )
}

// « Scanner ma présence » on the home page (features.attendanceQr).
function AttendanceScanButton() {
  const [open, setOpen] = useState(false)

  if (!universityConfig.features?.attendanceQr || !QR_ORIGIN) return null

  return (
    <>
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-widget-bg px-4 text-text shadow-md"
        onClick={() => setOpen(true)}
      >
        <Icon icon="ph:qr-code" width="20" height="20" aria-hidden="true" />
        <span className="text-sm font-semibold">Scanner ma présence</span>
      </button>
      {open ? <AttendanceScanner onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export default AttendanceScanButton
