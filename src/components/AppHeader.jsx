import { Icon } from '@iconify/react'
import LentButton from './LentButton'
import UniversityLockup from './UniversityLockup'

// The logo: back to « Accueil » in place (onNavigatePage), no reload;
// ⌘-click, a middle click or Shift still open "/" as a link does.
function AppHeader({ authenticated, checking, establishment = null, showUniversityLogo = true, logoSource = 'establishment', onPrimaryAction, onAccountAction, onNavigatePage }) {
  const handleLogoClick = (event) => {
    if (!onNavigatePage || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigatePage('home', 'logo')
  }

  const actionLabel = checking ? 'Chargement...' : 'Se connecter'

  return (
    // Above what follows (relative z-[1]): the cards' area paints over the
    // buttons' soft shadow otherwise, cut in a straight line under them.
    <header className="relative z-[1] w-full pt-5 px-6 max-xl:pt-4 max-md:pt-3 max-md:px-3">
      <div className="w-full flex items-center justify-between gap-6 max-xl:gap-[0.9rem] max-md:items-start max-md:gap-3">
        <a className="inline-flex items-center no-underline min-w-0 max-md:self-start" href="/" onClick={handleLogoClick} aria-label="Retour">
          <UniversityLockup variant="header" establishment={establishment} showLogo={showUniversityLogo} logoSource={logoSource} />
        </a>

        <div className="flex items-center gap-2 justify-end max-md:ml-auto max-md:items-start max-md:gap-[0.4rem]">
          {/* Signed in: « Se déconnecter » is in Réglages › Compte. */}
          {authenticated ? (
            <>
              <button
                type="button"
                className="glass-solid header-account-btn inline-flex items-center justify-center gap-2 px-3 py-[10px] border rounded-full text-text text-[0.9rem] font-semibold leading-[1.06] whitespace-nowrap cursor-pointer transition-[background-color,opacity] duration-120 ease-in-out hover:not-disabled: disabled:opacity-40 disabled:cursor-wait max-md:w-[42px] max-md:min-w-[42px] max-md:h-[42px] max-md:p-0 max-md:justify-center max-md:gap-0"
                onClick={onAccountAction}
                disabled={checking}
                aria-label="Mon compte"
              >
                <Icon icon="ph:user-circle" className="w-4 h-4 shrink-0 max-md:w-[1.1rem] max-md:h-[1.1rem]" aria-hidden="true" />
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
