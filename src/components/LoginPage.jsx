import { useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import loginClouds from '../assets/login/login-clouds.webp'
import loginIsland from '../assets/login/login-island.webp'
import loginSky from '../assets/login/login-sky.webp'
import loginLogo from '../assets/login/login-logo.webp'
import LentButton from './LentButton'
import LogoBut1 from './LogoBut1'
import AboutModal from './AboutModal'
import RenameNotice from './RenameNotice'
import { APP_NAME } from '../seo'
import { PICKER_PATH, getListedUniversities, isMultiUniversity } from '../universityRuntime'

const universityLogo = universityConfig.branding.logo
const universityLogoAlt = universityConfig.branding.logoAlt ?? universityConfig.university?.name ?? ''
const passwordNote = universityConfig.branding.loginPasswordNote ?? null
const repoUrl = universityConfig.branding.about?.repoUrl ?? null
const loginLinks = universityConfig.links ?? {}
// "Mot de passe oublié" / "Activer mon compte" under the button, hidden for now.
const SHOW_ACCOUNT_LINKS = false
// Width of the login page's left panel, matching its flex-basis.
const PANEL_WIDTH = 'min(529px, 47vw)'

// Pill fields like the rest of the app's inputs, in the widget colour so they
// stand out on the page. Focus keeps the app-wide outline (index.css).
const FIELD_CLASS = 'box-border w-full min-h-[52px] rounded-full border border-border-input bg-widget-bg px-[18px] py-[15px] text-base leading-none text-text font-body transition-[border-color,box-shadow] duration-150 hover:border-text-30 focus-visible:border-text-60'
const LINK_CLASS = 'rounded-sm text-[14px] font-medium leading-[1.2] text-text-70 underline decoration-text-30 underline-offset-[3px] transition-colors duration-120 hover:text-text hover:decoration-current font-body'

// No university picked yet (tafac.fr serves them all): the page lists them
// instead of the form. Each one is a link to /<slug>, which boots the page
// for that university (src/universityBoot.js) and lands on its form.
const isPicker = universityConfig.neutral === true
// A university picked among several: « Changer d'université » brings the
// list back. One university on the server (self-hosted): nothing to change.
const canChangeUniversity = !isPicker && isMultiUniversity()

const PICKER_ITEM_CLASS = 'group box-border flex w-full min-h-[60px] items-center gap-4 rounded-full border border-border-input bg-widget-bg px-5 py-3 text-left text-text font-body transition-[border-color,background-color] duration-150 hover:border-text-30 focus-visible:border-text-60'

function UniversityPicker() {
  const universities = getListedUniversities()

  return (
    <nav className="mt-6 flex w-full flex-col gap-3" aria-label="Universités">
      {universities.map((entry) => (
        <a key={entry.id} className={PICKER_ITEM_CLASS} href={`/${entry.slug}`}>
          <span className="flex h-9 w-[92px] shrink-0 items-center justify-center">
            {entry.logoUrl ? (
              <img className="block max-h-9 w-auto max-w-[92px] object-contain dark:invert" src={entry.logoUrl} alt="" />
            ) : null}
          </span>
          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.25]">{entry.name}</span>
          <Icon icon="carbon:arrow-right" className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </a>
      ))}
      {universities.length === 0 ? (
        <p className="m-0 text-sm font-medium text-text-muted font-body">Aucune université disponible pour le moment</p>
      ) : null}
    </nav>
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
  const [renameNoticeOpen, setRenameNoticeOpen] = useState(false)

  function handleDemoLinkClick() {
    setAboutOpen(false)
    onDemoLogin?.()
  }

  return (
    <section className="flex w-full min-h-screen bg-bg" aria-label="Page de connexion">
      <div
        className="login-left-panel relative flex flex-[0_0_min(529px,47vw)] flex-col max-w-[529px] min-w-0 min-h-screen overflow-hidden bg-[#5688af] max-4xl:hidden max-3xl:flex-[0_0_44vw] max-3xl:max-w-[529px]"
      >
        <img
          className="absolute inset-0 block h-full w-full max-w-none object-cover"
          src={loginSky}
          alt=""
          aria-hidden="true"
        />

        <div className="relative z-10 ml-10 flex w-[381px] max-w-[calc(100%_-_80px)] shrink-0 flex-col items-start gap-5 pt-10 max-3xl:ml-8 max-3xl:max-w-[calc(100%_-_64px)]">
          {/* The flower and butterfly overflow the 195×85 logo box. */}
          <div className="relative h-[85px] w-[195px] shrink-0">
            <img
              className="absolute left-[-21px] top-[-15px] block h-[110px] w-[247px] max-w-none"
              src={loginLogo}
              alt={APP_NAME}
              width="247"
              height="110"
            />
          </div>
          <div className="flex w-full flex-col items-start gap-[10px] text-white">
            <h1 className="m-0 w-full text-[clamp(40px,6.7vh,60px)] font-bold leading-[0.9]">Cours, notes et services de ton université</h1>
            <p className="m-0 w-full text-[20px] font-semibold leading-[0.9] font-body">Une solution alternative, libre et ouverte</p>
          </div>
        </div>

        {/* The island shrinks to the space left under the text, so it never
            covers it on short screens. Its clouds are a separate layer sized
            on the panel width, so they always run edge to edge. Geometry
            (in island units, 529 × 488.5): clouds 779 × 524, top 93.5,
            centre 32 right of the island's. */}
        <div className="relative z-0 mt-6 min-h-0 flex-1">
          <div className="absolute inset-x-0 bottom-0 mx-auto aspect-[1058/977] max-h-full">
            <img
              className="absolute top-[19.14%] left-[56.07%] block h-auto max-w-none -translate-x-1/2"
              style={{ width: `calc(${PANEL_WIDTH} * 1.473)` }}
              src={loginClouds}
              alt=""
              aria-hidden="true"
              width="1558"
              height="1048"
            />
            <img
              className="absolute inset-0 block h-full w-full"
              src={loginIsland}
              alt=""
              aria-hidden="true"
              width="1058"
              height="977"
            />
          </div>
        </div>
      </div>

      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        demoLinkLabel="Accéder à la démo"
        onDemoLinkClick={handleDemoLinkClick}
      />

      <RenameNotice visible={renameNoticeOpen} onDismiss={() => setRenameNoticeOpen(false)} />

      <div className="relative isolate flex min-h-screen min-w-0 flex-[1_1_auto] flex-col bg-[#f5f3ed] dark:bg-bg max-4xl:w-full">
        {/* In the flow rather than pinned over the form, so nothing overlaps
            on short or narrow screens. */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-6 max-3xl:px-5 max-3xl:pt-5 max-md:px-4 max-md:pt-4">
          <button
            type="button"
            className="inline-flex h-8 min-w-0 items-center gap-[6px] rounded-full border border-border/70 bg-widget-bg/60 px-3 text-[13px] font-medium leading-none font-body transition-colors duration-120 hover:bg-widget-bg"
            onClick={() => setRenameNoticeOpen(true)}
          >
            <Icon icon="carbon:star" className="h-[14px] w-[14px] shrink-0 text-text-muted" aria-hidden="true" />
            <span
              className="truncate bg-[linear-gradient(90deg,var(--color-text-muted)_0%,var(--color-text)_50%,var(--color-text-muted)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer"
              style={{ animationDuration: '3s' }}
            >
              l'ent devient Tafac !
            </span>
          </button>

          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-widget-bg/60 text-text-muted transition-colors duration-120 hover:bg-widget-bg hover:text-text"
            onClick={() => setAboutOpen(true)}
            aria-label="À propos"
          >
            <Icon icon="carbon:information" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-4 max-3xl:px-5 max-md:justify-start max-md:px-4 max-md:pt-8 max-md:pb-8">
          <div className="flex w-full max-w-[420px] flex-col items-center gap-7 max-md:gap-6">
            {/* The left panel (its app logo and tagline) is hidden below
                4xl: both here instead. */}
            <div className="hidden flex-col items-center gap-3 text-center max-4xl:flex">
              <LogoBut1 className="h-10" />
              <p className="m-0 text-[15px] font-medium leading-[1.25] text-text-muted font-body">Cours, notes et services de ton université</p>
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
                      className="block h-10 w-auto max-w-[180px] object-contain dark:invert"
                      src={universityLogo}
                      alt={universityLogoAlt}
                    />
                  </div>
                ) : null}

                <div className="flex flex-col items-center gap-2 text-text">
                  <h2 className="m-0 text-[32px] leading-none max-md:text-[28px]">Connexion</h2>
                  <p className="m-0 text-[15px] font-medium leading-[1.35] text-text-70 font-body">
                    {isPicker
                      ? 'Choisis ton université'
                      : "Utilise tes codes fournis par ton établissement d'enseignement supérieur"}
                  </p>
                </div>
              </header>

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
                          <Icon icon={showPassword ? 'carbon:view-off' : 'carbon:view'} className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Collapses to nothing when empty: its spacing sits inside
                      the clipped row, so the button doesn't jump. */}
                  <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${errorMessage ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="pt-4" role="alert">
                        <div className={`flex items-start gap-[10px] rounded-[14px] border border-error/20 bg-error-bg px-4 py-3 text-error transition-opacity duration-200 ${errorMessage ? 'opacity-100' : 'opacity-0'}`}>
                          <Icon icon="carbon:warning-filled" className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                          <p className="m-0 text-sm font-semibold leading-[1.3] font-body">{errorMessage}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <LentButton type="submit" className="mt-5 w-full font-bold!" loading={checking}>
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
                  <p className="m-0 mt-5 box-border w-full rounded-[16px] border border-border bg-widget-bg px-4 py-3 text-[13px] font-medium leading-[1.4] text-text-muted font-body">
                    <Icon icon="carbon:locked" className="mr-[6px] inline-block h-[14px] w-[14px] align-[-2px]" aria-hidden="true" />
                    {passwordNote}
                  </p>
                ) : null}

                  {canChangeUniversity ? (
                    <a className={`${LINK_CLASS} mt-5 inline-block`} href={PICKER_PATH}>
                      Changer d'université
                    </a>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 px-6 pb-5 text-center max-3xl:px-5 max-md:px-4">
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
