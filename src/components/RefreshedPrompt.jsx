import { useCallback, useState } from 'react'
import mobileUpdateImg from '../assets/mobile-pwa-update.png'
import { APP_NAME } from '../seo'
import LoadingDots from './LoadingDots'

export default function RefreshedPrompt({
  visible,
  onDismiss,
  onConfirm = null,
  title = 'Une nouvelle version est prête',
  description = `Une nouvelle version de ${APP_NAME} est disponible. Applique-la maintenant pour la mettre à jour`,
  dismissLabel = 'Plus tard',
  confirmLabel = 'Mettre à jour',
  confirmBusy = false,
}) {
  const [animatingOut, setAnimatingOut] = useState(false)

  const dismiss = useCallback(() => {
    setAnimatingOut(true)
    setTimeout(() => {
      setAnimatingOut(false)
      onDismiss?.()
    }, 280)
  }, [onDismiss])

  if (!visible) return null

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-backdrop ${animatingOut ? 'animate-[pwa-backdrop-out_280ms_ease-in_forwards]' : 'animate-[pwa-backdrop-in_280ms_ease-out]'}`}
        onClick={dismiss}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${animatingOut ? 'animate-[pwa-slide-out_280ms_ease-in_forwards]' : 'animate-[pwa-slide-in_350ms_cubic-bezier(0.16,1,0.3,1)]'}`}
      >
        <div className="max-w-[420px] mx-auto corners-[20px] bg-widget-bg border border-border overflow-hidden shadow-[0_-8px_40px_var(--color-shadow)]">
          <img
            src={mobileUpdateImg}
            alt=""
            aria-hidden="true"
            className="w-full"
          />
          <div className="px-5 pt-4 pb-4 flex flex-col gap-2">
            <h2 className="m-0 text-[1.15rem] font-bold text-text leading-tight">
              {title}
            </h2>
            <p className="m-0 text-[0.9rem] text-text-muted font-body leading-snug">
              {description}
            </p>
          </div>
          {onConfirm ? (
            <div className="grid grid-cols-2 border-t border-border">
              <button
                type="button"
                onClick={dismiss}
                className="py-3.5 border-0 border-r border-border bg-transparent text-text-muted font-body font-medium text-[0.95rem] active:bg-bg-subtle transition-colors"
                disabled={confirmBusy}
              >
                {dismissLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="inline-flex items-center justify-center gap-2 py-3.5 border-0 bg-bg-subtle text-text font-body font-semibold text-[0.95rem] active:bg-bg transition-colors disabled:opacity-60 disabled:cursor-wait"
                disabled={confirmBusy}
              >
                {confirmBusy ? <LoadingDots /> : confirmLabel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="w-full py-3.5 border-t border-border bg-transparent text-text font-body font-semibold text-[0.95rem] active:bg-bg-subtle transition-colors"
            >
              {dismissLabel}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
