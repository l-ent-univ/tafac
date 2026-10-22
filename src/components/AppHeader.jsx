import { Icon } from '@iconify/react'
import LentButton from './LentButton'
import UniversityLockup from './UniversityLockup'

function AppHeader({ authenticated, checking, onPrimaryAction, onAccountAction }) {
  const actionLabel = checking
    ? 'Chargement...'
    : authenticated
      ? 'Se déconnecter'
      : 'Se connecter'

  return (
    <header className="w-full pt-5 px-6 max-xl:pt-4 max-md:pt-3 max-md:px-3">
      <div className="w-full flex items-center justify-between gap-6 max-xl:gap-[0.9rem] max-md:items-start max-md:gap-3">
        <a className="inline-flex items-center no-underline min-w-0 max-md:self-start" href="/" aria-label="Retour">
          <UniversityLockup variant="header" />
        </a>

        <div className="flex items-center gap-2 justify-end max-md:ml-auto max-md:items-start max-md:gap-[0.4rem]">
          {authenticated ? (
            <>

              <button
                type="button"
                className="header-logout-btn inline-flex items-center justify-center gap-2 px-3 py-[10px] border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text-secondary text-[0.9rem] font-medium leading-[1.06] whitespace-nowrap cursor-pointer transition-[background-color,opacity] duration-120 ease-in-out hover:not-disabled:bg-bg-subtle disabled:opacity-40 disabled:cursor-wait max-md:w-[42px] max-md:min-w-[42px] max-md:h-[42px] max-md:p-0 max-md:justify-center max-md:gap-0 max-md:text-text"
                onClick={onPrimaryAction}
                disabled={checking}
                aria-label={actionLabel}
              >
                <Icon icon="carbon:login" className="w-4 h-4 shrink-0 max-md:w-[1.1rem] max-md:h-[1.1rem]" aria-hidden="true" />
                <span className="max-md:hidden">{actionLabel}</span>
              </button>

              <button
                type="button"
                className="header-account-btn inline-flex items-center justify-center gap-2 px-3 py-[10px] border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text text-[0.9rem] font-semibold leading-[1.06] whitespace-nowrap cursor-pointer transition-[background-color,opacity] duration-120 ease-in-out hover:not-disabled:bg-bg-subtle disabled:opacity-40 disabled:cursor-wait max-md:w-[42px] max-md:min-w-[42px] max-md:h-[42px] max-md:p-0 max-md:justify-center max-md:gap-0"
                onClick={onAccountAction}
                disabled={checking}
                data-tour="account"
                aria-label="Mon compte"
              >
                <Icon icon="carbon:user-avatar" className="w-4 h-4 shrink-0 max-md:w-[1.1rem] max-md:h-[1.1rem]" aria-hidden="true" />
                <span className="max-md:hidden">Mon compte</span>
              </button>
            </>
          ) : (
            <LentButton
              className="inline-flex items-center justify-center"
              onClick={onPrimaryAction}
              disabled={checking}
              aria-label={actionLabel}
            >
              {actionLabel}
            </LentButton>
          )}
        </div>
      </div>
    </header>
  )
}

export default AppHeader
