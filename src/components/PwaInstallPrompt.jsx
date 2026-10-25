import { useCallback, useEffect, useRef, useState } from 'react'
import mobileInviteImg from '../assets/mobile-pwa-invite.png'
import { APP_NAME } from '../seo'

const VISIT_COUNT_KEY = 'l-ent:visit-count'
const PROMPT_DISMISSED_KEY = 'l-ent:pwa-prompt-dismissed'

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

// `autoOpen` false: only opens when forced (the Tafac welcome sheet offers it).
// `onVisibleChange`: told when the sheet opens and closes (the « Nouveautés »
// pill waits while it's up).
export default function PwaInstallPrompt({ forceShow = false, forceIos = false, autoOpen = true, onVisibleChange }) {
  const [visible, setVisible] = useState(false)
  const [animatingOut, setAnimatingOut] = useState(false)
  const [showIos, setShowIos] = useState(false)
  const isForced = useRef(false)

  useEffect(() => {
    onVisibleChange?.(visible)
  }, [onVisibleChange, visible])

  useEffect(() => {
    if (forceShow) {
      isForced.current = true
      setShowIos(forceIos || /iPhone|iPad|iPod/i.test(navigator.userAgent))
      setAnimatingOut(false)
      setVisible(true)
      return
    }

    if (!autoOpen || !isMobile() || isStandalone()) return
    if (localStorage.getItem(PROMPT_DISMISSED_KEY)) return

    const count = Number(localStorage.getItem(VISIT_COUNT_KEY) || '0') + 1
    localStorage.setItem(VISIT_COUNT_KEY, String(count))

    if (count >= 2) {
      setShowIos(/iPhone|iPad|iPod/i.test(navigator.userAgent))
      const timer = setTimeout(() => setVisible(true), 1200)
      return () => clearTimeout(timer)
    }
  }, [forceShow, forceIos, autoOpen])

  const dismiss = useCallback(() => {
    setAnimatingOut(true)
    setTimeout(() => {
      setVisible(false)
      if (!isForced.current) {
        localStorage.setItem(PROMPT_DISMISSED_KEY, '1')
      }
      isForced.current = false
    }, 280)
  }, [])

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
            src={mobileInviteImg}
            alt={`${APP_NAME} sur l'écran d'accueil`}
            className="w-full"
          />
          <div className="px-5 pt-4 pb-4 flex flex-col gap-3">
            <div>
              <h2 className="m-0 text-[1.15rem] font-bold text-text leading-tight">
                Ajoute {APP_NAME} à ton écran d'accueil
              </h2>
              <p className="m-0 mt-1 text-[0.9rem] text-text-muted font-body">
                Cours et notes de ton université, sur ton téléphone
              </p>
            </div>
            {showIos ? (
              <div className="text-[0.85rem] text-text-secondary font-body text-left w-full flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand text-[color:var(--color-bg)] text-[0.75rem] font-bold flex items-center justify-center">1</span>
                  <span>
                    Appuie sur{' '}
                    <svg className="inline-block w-[1.1em] h-[1.1em] align-[-0.15em]" viewBox="0 0 18.2512 26.8443" fill="currentColor">
                      <path d="M17.8899 11.4937L17.8899 20.9984C17.8899 23.1375 16.7402 24.2804 14.5812 24.2804L3.30863 24.2804C1.14961 24.2804 0 23.1441 0 20.9984L0 11.4937C0 9.34493 1.14961 8.21175 3.30863 8.21175L6.09506 8.21175L6.09506 10.3865L3.48964 10.3865C2.63419 10.3865 2.17471 10.8171 2.17471 11.7147L2.17471 20.7743C2.17471 21.672 2.63419 22.1057 3.48964 22.1057L14.3936 22.1057C15.2423 22.1057 15.7151 21.672 15.7151 20.7743L15.7151 11.7147C15.7151 10.8171 15.2423 10.3865 14.3936 10.3865L11.7881 10.3865L11.7881 8.21175L14.5812 8.21175C16.7402 8.21175 17.8899 9.35159 17.8899 11.4937Z" fillOpacity="0.85"/>
                      <path d="M8.9416 16.2458C9.49505 16.2458 9.94643 15.7953 9.94643 15.2671L9.94643 5.56526L9.863 4.12571L10.3509 4.77952L11.656 6.17347C11.8269 6.36388 12.0693 6.46685 12.3169 6.46685C12.7923 6.46685 13.1975 6.11177 13.1975 5.61867C13.1975 5.35724 13.1038 5.16683 12.9263 4.9924L9.71606 1.90556C9.45864 1.65125 9.21189 1.56471 8.9416 1.56471C8.67796 1.56471 8.43431 1.65125 8.16713 1.90556L4.96355 4.9924C4.78912 5.16683 4.6857 5.35724 4.6857 5.61867C4.6857 6.11177 5.08425 6.46685 5.55962 6.46685C5.80728 6.46685 6.05628 6.36388 6.22716 6.17347L7.53898 4.77952L8.02685 4.12571L7.94342 5.56526L7.94342 15.2671C7.94342 15.7953 8.38814 16.2458 8.9416 16.2458Z" fillOpacity="0.85"/>
                    </svg>
                    {' '}en bas de Safari
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand text-[color:var(--color-bg)] text-[0.75rem] font-bold flex items-center justify-center">2</span>
                  <span>Choisis <strong>Sur l'écran d'accueil</strong></span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand text-[color:var(--color-bg)] text-[0.75rem] font-bold flex items-center justify-center">3</span>
                  <span>Appuie sur <strong>Ajouter</strong></span>
                </div>
              </div>
            ) : (
              <p className="m-0 text-[0.82rem] text-text-secondary font-body leading-snug">
                Appuie sur <strong>Installer</strong> dans le menu de ton navigateur.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="w-full py-3.5 border-t border-border bg-transparent text-text font-body font-semibold text-[0.95rem] active:bg-bg-subtle transition-colors"
          >
            Plus tard
          </button>
        </div>
      </div>
    </>
  )
}
