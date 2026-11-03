import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import loginHands from '../assets/login/login-hands.webp'
import LentButton from './LentButton'
import BetaTag from './BetaTag'
import LogoBut1 from './LogoBut1'
import AboutModal from './AboutModal'
import PapillonBadge from './PapillonBadge'
import ServiceNotice from './ServiceNotice'
import { APP_NAME } from '../seo'
import { getListedUniversities, getLoadedUniversityId, writeUniversityChoice } from '../universityRuntime'
import { r } from '../register.js'

const universityLogo = universityConfig.branding.logo
const universityLogoAlt = universityConfig.branding.logoAlt ?? universityConfig.university?.name ?? ''
// A square badge (branding.logoShape) shows taller than a wordmark.
const universityLogoSquare = universityConfig.branding.logoShape === 'square'
const passwordNote = universityConfig.branding.loginPasswordNote ?? null
const repoUrl = universityConfig.branding.about?.repoUrl ?? null
const loginLinks = universityConfig.links ?? {}
// "Mot de passe oublié" / "Activer mon compte" under the button, hidden for now.
const SHOW_ACCOUNT_LINKS = false

// Pill fields like the rest of the app's inputs, in the widget colour so they
// stand out on the page. Focus keeps the app-wide outline (index.css).
const FIELD_CLASS = 'box-border w-full min-h-[52px] rounded-full border border-border-input bg-widget-bg px-[18px] py-[15px] text-base leading-none text-text font-body transition-[border-color,box-shadow] duration-150 hover:border-text-30 focus-visible:border-text-60'
const LINK_CLASS = 'corners-[4px] text-[14px] font-medium leading-[1.2] text-text-70 underline decoration-text-30 underline-offset-[3px] transition-colors duration-120 hover:text-text hover:decoration-current font-body'

// No university picked yet (tafac.fr serves them all): the page lists them
// instead of the form. Each one is a link to its form (openUniversityLogin).
const isPicker = universityConfig.neutral === true
// A university picked: the others the server lists, under the form (« aussi
// disponible pour »), each to its own form. None on a single-university
// server (self-hosted).
const otherUniversities = isPicker
  ? []
  : getListedUniversities().filter((entry) => entry.id !== getLoadedUniversityId())
// A university's link: /<slug> (its landing page, for search engines and a
// new tab), but a plain click goes straight to its form: picked, then the
// page boots again for it (src/universityBoot.js) on the login page.
function openUniversityLogin(event, entry) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  writeUniversityChoice(entry.id)
  window.location.assign('/login')
}
const issuesUrl = repoUrl ? `${repoUrl.replace(/\/$/, '')}/issues` : null
// The guide to adding a university, in the repo.
const addUniversityUrl = repoUrl ? `${repoUrl.replace(/\/$/, '')}/blob/main/docs/ADDING_A_UNIVERSITY.md` : null
// From this many universities, a search field over the list.
const PICKER_SEARCH_FROM = 6

// The picker: a pill per university, like the form's fields (its logo, its
// name, its address). A search field once the list is long; a way to ask
// for a missing university.
function UniversityPicker() {
  const universities = getListedUniversities()
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return universities
    return universities.filter((entry) => `${entry.name} ${entry.shortName ?? ''} ${entry.slug}`.toLowerCase().includes(needle))
  }, [query, universities])

  return (
    <div className="mt-6 flex w-full flex-col gap-3">
      {universities.length >= PICKER_SEARCH_FROM ? (
        <div className="relative">
          <Icon icon="ph:magnifying-glass" className="pointer-events-none absolute left-[18px] top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            type="search"
            className={`${FIELD_CLASS} pl-11`}
            placeholder="Chercher une université"
            aria-label="Chercher une université"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      <nav className="flex flex-col gap-2.5" aria-label="Universités">
        {shown.map((entry) => (
          <a
            key={entry.id}
            className="group box-border flex min-h-[76px] items-center gap-4 rounded-full border border-border-input bg-widget-bg py-3 pl-6 pr-5 text-left text-text no-underline transition-[border-color] duration-150 hover:border-text-30 focus-visible:border-text-60 max-md:gap-3 max-md:pl-5 max-md:pr-4"
            href={`/${entry.slug}`}
            onClick={(event) => openUniversityLogin(event, entry)}
          >
            <span className="flex h-11 w-[120px] shrink-0 items-center justify-start max-md:w-[96px]">
              {entry.logoUrl ? (
                <img className="block max-h-full w-auto max-w-full object-contain dark:invert" src={entry.logoUrl} alt="" />
              ) : (
                <Icon icon="ph:graduation-cap" className="h-7 w-7 text-text" aria-hidden="true" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[16px] font-bold leading-[1.2]">{entry.name}</span>
              <span className="truncate text-[13px] font-medium leading-[1.2] text-text-muted font-body">tafac.fr/{entry.slug}</span>
            </span>
            <Icon icon="ph:caret-right" className="h-5 w-5 shrink-0 text-text-muted transition-colors duration-150 group-hover:text-text" aria-hidden="true" />
          </a>
        ))}
        {universities.length === 0 ? (
          <p className="m-0 text-sm font-medium text-text-muted font-body">Aucune université disponible pour le moment</p>
        ) : null}
        {universities.length > 0 && shown.length === 0 ? (
          <p className="m-0 py-2 text-sm font-medium text-text-muted font-body">Aucune université ne correspond</p>
        ) : null}
      </nav>
      {issuesUrl ? (
        <p className="m-0 mt-2 text-[13px] font-medium leading-[1.4] text-text-muted font-body">
          {r("Ton université n'est pas dans la liste", "Votre université n'est pas dans la liste")}{'\u202f'}?{' '}
          <a className={LINK_CLASS} href={issuesUrl} target="_blank" rel="noopener noreferrer">{r('Dis-le-nous', 'Dites-le-nous')}</a>
          {' '}ou{' '}
          <a className={LINK_CLASS} href={addUniversityUrl} target="_blank" rel="noopener noreferrer">{r('ajoute-la', 'ajoutez-la')}</a>
        </p>
      ) : null}
    </div>
  )
}

function LoginPage({
  credentials,
  checking,
  errorMessage,
  onCredentialsChange,
  onDemoLogin,
  onSubmit,
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  function handleDemoLinkClick() {
    setAboutOpen(false)
    onDemoLogin?.()
  }

  return (
    <section className="flex w-full min-h-screen bg-bg" aria-label="Page de connexion">
      {/* The photo of the app in hand on its own grey (#EEEEEE), the panel
          in the same grey so it runs seamless; the text in the brand's
          brown. Fixed colours, not the theme's: the photo stays light in
          dark mode, so does the panel. The screen's height, never more: the
          logo's band follows the height, and the panel's width
          (.login-left-panel) is what lets the photo fit whole under it. */}
      <div className="login-left-panel relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#eeeeee] max-4xl:hidden">
        {/* At the top, centred: the Tafac logo (its wordmark kept dark in
            dark mode too), what it is, small, under it. */}
        <div className="relative z-10 flex shrink-0 flex-col items-center gap-[clamp(8px,1.4vh,14px)] px-10 pt-[clamp(28px,6vh,64px)] text-center max-3xl:px-8">
          <LogoBut1 className="h-[clamp(44px,7.5vh,72px)]" wordmarkClassName="dark:[filter:none]!" />
          <p className="m-0 font-body text-[clamp(13px,1.9vh,17px)] font-semibold leading-[1.2] text-[#341200]/70">{r('Cours, notes et services de ton université', 'Cours, notes et services de votre université')}</p>
        </div>

        {/* The hands and the phone centred in the room under the logo,
            always the panel's width (the hands against both edges) and never
            cropped; the panel's width keeps them and the logo's band within
            the screen. The photo's grey melts into the panel's. */}
        <div className="relative z-0 flex min-h-0 flex-1 items-center">
          <img
            className="block h-auto w-full max-w-none shrink-0"
            src={loginHands}
            alt=""
            aria-hidden="true"
            width="1080"
            height="1070"
          />
        </div>
      </div>

      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        demoLinkLabel="Accéder à la démo"
        onDemoLinkClick={handleDemoLinkClick}
      />

      <div className="relative isolate flex min-h-screen min-w-0 flex-[1_1_auto] flex-col bg-[#f5f3ed] dark:bg-bg max-4xl:w-full">
        {/* In the flow rather than pinned over the form, so nothing overlaps
            on short or narrow screens. */}
        <div className="flex shrink-0 items-center justify-end gap-3 px-6 pt-6 max-3xl:px-5 max-3xl:pt-5 max-md:px-4 max-md:pt-4">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-widget-bg/60 text-text-muted transition-colors duration-120 hover:bg-widget-bg hover:text-text"
            onClick={() => setAboutOpen(true)}
            aria-label="À propos"
          >
            <Icon icon="ph:info" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-4 max-3xl:px-5 max-md:justify-start max-md:px-4 max-md:pt-8 max-md:pb-8">
          <div className="flex w-full max-w-[420px] flex-col items-center gap-7 max-md:gap-6">
            {/* The left panel (its app logo, Papillon's badge and tagline)
                is hidden below 4xl: all three here instead. */}
            <div className="hidden flex-col items-center gap-3 text-center max-4xl:flex">
              <div className="flex flex-col items-center gap-1.5">
                <LogoBut1 className="h-10" />
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <BetaTag />
                  <PapillonBadge className="text-text-muted hover:text-text" />
                </div>
              </div>
              <p className="m-0 text-[15px] font-medium leading-[1.25] text-text-muted font-body">{r('Cours, notes et services de ton université', 'Cours, notes et services de votre université')}</p>
            </div>

            <div className="flex w-full flex-col items-center text-center">
              <header className="flex flex-col items-center gap-5">
                {/* What Tafac works with, over the title: the university's
                    logo under "Compatible avec" rather than as the form's
                    header (Tafac isn't the university's). */}
                {universityLogo ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-[12px] font-medium leading-none text-text-muted font-body">Compatible avec</span>
                    <img
                      className={`block w-auto max-w-[180px] object-contain dark:invert ${universityLogoSquare ? 'h-[72px]' : 'h-10'}`}
                      src={universityLogo}
                      alt={universityLogoAlt}
                    />
                  </div>
                ) : null}

                <div className="flex flex-col items-center gap-2 text-text">
                  <h2 className="m-0 text-[32px] leading-none max-md:text-[28px]">Connexion</h2>
                  <p className="m-0 text-[15px] font-medium leading-[1.35] text-text-70 font-body">
                    {isPicker
                      ? r('Choisis ton université', 'Choisissez votre université')
                      : r("Utilise tes codes fournis par ton établissement d'enseignement supérieur", "Utilisez vos codes fournis par votre établissement d'enseignement supérieur")}
                  </p>
                </div>
              </header>

              {/* A university's outage notice (`serviceNotice`), over its
                  form; none on the neutral picker. */}
              <ServiceNotice className="mt-5" />

              {isPicker ? <UniversityPicker /> : null}

              {isPicker ? null : (
                <>
                {/* Real form with labelled username/current-password fields and a
                    submit button, so password managers recognize and offer to save
                    the login. */}
                <form className="mt-6 flex w-full flex-col" onSubmit={onSubmit}>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-[7px]">
                      <label htmlFor="login-username" className="pl-[18px] text-left text-[13px] font-semibold leading-none text-text-70 font-body">Identifiant</label>
                      <input
                        id="login-username"
                        name="username"
                        className={FIELD_CLASS}
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        type="text"
                        value={credentials.username}
                        onChange={(event) => onCredentialsChange('username', event.target.value)}
                      />
                    </div>

                    <div className="flex flex-col gap-[7px]">
                      <label htmlFor="login-password" className="pl-[18px] text-left text-[13px] font-semibold leading-none text-text-70 font-body">Mot de passe</label>
                      <div className="relative">
                        <input
                          id="login-password"
                          name="password"
                          className={`${FIELD_CLASS} pr-[52px]`}
                          autoComplete="current-password"
                          type={showPassword ? 'text' : 'password'}
                          value={credentials.password}
                          onChange={(event) => onCredentialsChange('password', event.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-[5px] top-1/2 flex h-[42px] w-[42px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text-muted transition-colors duration-120 hover:bg-text/6 hover:text-text"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                          aria-controls="login-password"
                          tabIndex={-1}
                        >
                          <Icon icon={showPassword ? 'ph:eye-slash' : 'ph:eye'} className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Collapses to nothing when empty: its spacing sits inside
                      the clipped row, so the button doesn't jump. */}
                  <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${errorMessage ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="pt-4" role="alert">
                        <div className={`flex items-start gap-[10px] corners-[14px] border border-error/20 bg-error-bg px-4 py-3 text-error transition-opacity duration-200 ${errorMessage ? 'opacity-100' : 'opacity-0'}`}>
                          <Icon icon="ph:warning-circle-fill" className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                          <p className="m-0 text-sm font-semibold leading-[1.3] font-body">{errorMessage}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <LentButton type="submit" className="mt-5 min-h-[52px]! w-full text-[16px]!" loading={checking}>
                    Se connecter
                  </LentButton>
                </form>

                {SHOW_ACCOUNT_LINKS && (loginLinks.forgotPassword || loginLinks.activateAccount) ? (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                    {loginLinks.forgotPassword ? (
                      <a className={LINK_CLASS} href={loginLinks.forgotPassword}>
                        Mot de passe oublié
                      </a>
                    ) : null}
                    {loginLinks.activateAccount ? (
                      <a className={LINK_CLASS} href={loginLinks.activateAccount}>
                        Activer mon compte
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {/* What happens to the password. */}
                {passwordNote ? (
                  <p className="m-0 mt-5 box-border w-full corners-[16px] border border-border bg-widget-bg px-4 py-3 text-[13px] font-medium leading-[1.4] text-text-muted font-body">
                    <Icon icon="ph:lock" className="mr-[6px] inline-block h-[14px] w-[14px] align-[-2px]" aria-hidden="true" />
                    {passwordNote}
                  </p>
                ) : null}

                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 px-6 pb-5 text-center max-3xl:px-5 max-md:px-4">
          {/* The other universities, to their own form. */}
          {otherUniversities.length > 0 ? (
            <div
              className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3"
              aria-label="Autres universités disponibles"
            >
              <p className="m-0 text-[13px] font-medium leading-[1.1] text-text-muted font-body">
                {APP_NAME} est aussi disponible pour
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                {otherUniversities.map((entry) => (
                  <a
                    key={entry.id}
                    className="corners-[6px] opacity-40 transition-opacity duration-120 hover:opacity-75 focus-visible:opacity-75"
                    href={`/${entry.slug}`}
                    onClick={(event) => openUniversityLogin(event, entry)}
                    title={`Se connecter — ${entry.name}`}
                  >
                    {entry.logoUrl ? (
                      <img
                        className="block h-7 w-auto max-w-[140px] object-contain grayscale dark:invert"
                        src={entry.logoUrl}
                        alt={entry.name}
                      />
                    ) : (
                      <span className="text-[13px] font-semibold text-text font-body">{entry.name}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] font-medium leading-[1.4] text-text-muted font-body" aria-label="Copyright">
            <span>{universityConfig.branding.loginFooterLine}</span>
            {repoUrl ? (
              <a className="text-text-muted underline decoration-text-30 underline-offset-2 transition-colors duration-120 hover:text-text hover:decoration-current" href={repoUrl} target="_blank" rel="noreferrer">Code source</a>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  )
}

export default LoginPage
