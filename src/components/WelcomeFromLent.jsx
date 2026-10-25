import { useState } from 'react'
import { Icon } from '@iconify/react'
import transitionDoneImage from '../assets/login/transition-done.webp'

// What a transferred setting looks like to a student. Several keys share a
// label (favourites and pins are both "Favoris"). The weather city still
// moves over, it just isn't listed.
const SETTING_LABELS = {
  'l-ent:establishment': 'Établissement',
  'l-ent:student-tp': 'Groupe',
  'l-ent:ade-lookahead-days': 'Planning',
  'l-ent:greeting-hidden': 'Widgets',
  'l-ent:hidden-widgets': 'Widgets',
  'l-ent:show-app-descriptions': 'Applications',
  'l-ent:anonymous-analytics': 'Confidentialité',
  'l-ent:favorites-order': 'Favoris',
  'l-ent:local-pins': 'Favoris',
  'l-ent:grade-colors': 'Couleurs',
  'l-ent:class-colors': 'Couleurs',
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

// Bottom sheet greeting students who just came over from the old l'ent
// address (see settingsTransferBoot.js): what came along, and what's left to
// do. Same frame as the PWA install/update prompts.
export default function WelcomeFromLent({ visible, importedKeys = [], signedIn = false, onInstall, onDismiss }) {
  const [animatingOut, setAnimatingOut] = useState(false)
  const labels = [...new Set(importedKeys.map((key) => SETTING_LABELS[key]).filter(Boolean))]
  const showInstall = Boolean(onInstall) && isMobile() && !isStandalone()

  // `then` runs once the sheet is gone (the install prompt opens after it).
  function dismiss(then) {
    setAnimatingOut(true)
    setTimeout(() => {
      setAnimatingOut(false)
      onDismiss?.()
      then?.()
    }, 280)
  }

  if (!visible) return null

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-backdrop ${animatingOut ? 'animate-[pwa-backdrop-out_280ms_ease-in_forwards]' : 'animate-[pwa-backdrop-in_280ms_ease-out]'}`}
        onClick={() => dismiss()}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${animatingOut ? 'animate-[pwa-slide-out_280ms_ease-in_forwards]' : 'animate-[pwa-slide-in_350ms_cubic-bezier(0.16,1,0.3,1)]'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-from-lent-title"
      >
        <div className="max-w-[420px] mx-auto corners-[20px] bg-widget-bg border border-border overflow-hidden shadow-[0_-8px_40px_var(--color-shadow)]">
          <img
            src={transitionDoneImage}
            alt="Le logo Tafac avec une coche"
            className="block aspect-[1146/642] w-full"
            width="1146"
            height="642"
          />
          <div className="px-5 pt-4 pb-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 id="welcome-from-lent-title" className="m-0 text-[1.15rem] font-bold text-text leading-tight">
                Bienvenue sur Tafac !
              </h2>
              <p className="m-0 text-[0.9rem] text-text-muted font-body leading-snug">
                {labels.length > 0
                  ? "Tes réglages t'ont suivi depuis l'ent :"
                  : "C'est la même appli qu'avant, avec un nouveau nom."}
              </p>
            </div>
            {labels.length > 0 ? (
              <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label="Réglages transférés">
                {labels.map((label) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-[0.8rem] font-body font-medium text-text"
                  >
                    <Icon icon="carbon:checkmark" className="h-3 w-3 text-success-text" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            ) : null}
            {signedIn ? null : (
              <p className="m-0 text-[0.9rem] text-text-muted font-body leading-snug">
                Connecte-toi avec les identifiants de ton université, comme avant.
              </p>
            )}
            {showInstall ? (
              <button
                type="button"
                onClick={() => dismiss(onInstall)}
                className="mt-1 flex w-full items-center gap-3 corners-[16px] border border-border bg-bg-subtle px-3.5 py-3 text-left text-text transition-colors hover:bg-bg cursor-pointer"
              >
                <Icon icon="carbon:mobile-add" className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 font-body leading-snug">
                  <span className="text-[0.9rem] font-semibold">Ajoute Tafac à ton écran d'accueil</span>
                  <span className="text-[0.8rem] text-text-muted">Puis supprime l'ancienne icône l'ent</span>
                </span>
                <Icon icon="carbon:chevron-right" className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss()}
            className="w-full py-3.5 border-0 border-t border-border bg-transparent text-text font-body font-semibold text-[0.95rem] active:bg-bg-subtle transition-colors"
          >
            C'est parti
          </button>
        </div>
      </div>
    </>
  )
}
