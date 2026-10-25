import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import renameNoticeImage from '../assets/login/rename-notice.webp'

const NEW_ADDRESS = 'tafac.fr'
const repoUrl = universityConfig.branding.about?.repoUrl ?? null

// Bottom sheet explaining the l'ent → Tafac rename, opened from the login
// page. Same frame as the PWA install/update prompts.
export default function RenameNotice({ visible, onDismiss }) {
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-notice-title"
      >
        <div className="max-w-[420px] mx-auto corners-[20px] bg-widget-bg border border-border overflow-hidden shadow-[0_-8px_40px_var(--color-shadow)]">
          <img
            src={renameNoticeImage}
            alt="Le logo l'ent devient le logo Tafac"
            className="block aspect-[1146/642] w-full"
            width="1146"
            height="642"
          />
          <div className="px-5 pt-4 pb-4 flex flex-col gap-2">
            <h2 id="rename-notice-title" className="m-0 text-[1.15rem] font-bold text-text leading-tight">
              l'ent devient Tafac !
            </h2>
            <p className="m-0 text-[0.9rem] text-text-muted font-body leading-snug">
              l'ent change de nom, maintenant c'est Tafac ! Y'a que le nom qui change : c'est toujours la même appli sécurisée, faite par des étudiants, avec tous tes services au même endroit
            </p>
            <p className="m-0 text-[0.9rem] text-text-muted font-body leading-snug">
              Pour te connecter, rien ne change : utilise toujours les identifiants de ton université
            </p>
            <a
              href={`https://${NEW_ADDRESS}`}
              className="mt-1 flex items-center gap-3 corners-[16px] border border-border bg-bg-subtle px-3.5 py-3 text-text no-underline transition-colors hover:bg-bg"
            >
              <Icon icon="carbon:earth" className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
              <span className="flex min-w-0 flex-col gap-0.5 font-body leading-snug">
                <span className="text-[0.9rem] font-semibold">Nouvelle adresse : {NEW_ADDRESS}</span>
                <span className="text-[0.8rem] text-text-muted">Pense à la rajouter sur ton écran d'accueil</span>
              </span>
            </a>
          </div>
          <div className={`grid border-t border-border ${repoUrl ? 'grid-cols-2' : ''}`}>
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 py-3.5 border-r border-border text-text-muted font-body font-medium text-[0.95rem] no-underline active:bg-bg-subtle transition-colors hover:text-text"
              >
                <Icon icon="carbon:logo-github" className="h-4 w-4" aria-hidden="true" />
                Code source
              </a>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              className="py-3.5 border-0 bg-transparent text-text font-body font-semibold text-[0.95rem] active:bg-bg-subtle transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
