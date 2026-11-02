import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import appsIcon from '../assets/home-icons/apps.png'
import calendarIcon from '../assets/home-icons/calendar.png'
import gradesIcon from '../assets/home-icons/grades.png'
import homeworkIcon from '../assets/home-icons/homework.png'
import mailIcon from '../assets/home-icons/mail.png'
import menuIcon from '../assets/home-icons/menu.png'
import papillonMark from '../assets/landing/papillon-mark.svg'
import { useAnalyticsAvailable } from '../analytics'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import { CARD_CLASSES, MUTED_FILL_CLASSES, PRESSABLE_ROW_CLASSES } from '../settingsStyles'
import useRepoContributors, { readRepoSlug } from '../useRepoContributors'
import BetaTag from './BetaTag'
import PrivacyModal from './PrivacyModal'
import SettingsGroup, { RowText } from './SettingsGroup'
import CloseButton from './CloseButton'

/* global __BUILD_HASH__ */

const about = universityConfig.branding.about ?? {}
const papillonUrl = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride())

const BUILD_LABEL = import.meta.env.DEV ? 'dev' : `build ${typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'}`

// The row of icons above the name, as « Accueil »'s greeting shows it: each
// tilted its own way, coming into focus one after the other.
const HERO_ICONS = [
  { src: appsIcon, rotate: -9 },
  { src: calendarIcon, rotate: 7 },
  { src: gradesIcon, rotate: -4 },
  { src: homeworkIcon, rotate: 10 },
  { src: mailIcon, rotate: -7 },
  { src: menuIcon, rotate: 6 },
]

const ARROW = <Icon icon="ph:arrow-up-right" className="h-4 w-4 shrink-0 text-text-50" aria-hidden="true" />

// The top: « Accueil »'s tinted band, its icons, the name with « Bêta »,
// the one-line intro, and the build in the corner.
function AboutHero() {
  const { appName } = universityConfig.branding
  return (
    <div className="relative flex flex-col gap-[10px] overflow-hidden modal-inner-corners border border-[color-mix(in_srgb,var(--color-brand)_14%,var(--color-bg))] bg-[color-mix(in_srgb,var(--color-brand)_7%,var(--color-bg))] px-[18px] pb-[18px] pt-[16px] dark:border-[color-mix(in_srgb,#ffffff_11%,var(--color-bg))] dark:bg-[color-mix(in_srgb,#ffffff_5%,var(--color-bg))]">
      <span className="absolute right-[14px] top-[14px] rounded-full bg-white/70 px-[8px] py-[3px] font-mono text-[11px] leading-[1.3] text-text-50 ring-1 ring-inset ring-[var(--color-border)] dark:bg-white/5">
        {BUILD_LABEL}
      </span>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {HERO_ICONS.map(({ src, rotate }, index) => (
          <span key={src} className="home-icon-deal relative shrink-0" style={{ '--i': index, '--r': `${rotate}deg`, transform: 'rotate(var(--r))' }}>
            <img src={src} alt="" width="30" height="30" draggable="false" className="block size-[30px] select-none" />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <h4 className="m-0 font-body text-[24px] font-bold leading-[1.1] tracking-[-0.02em]">{appName}</h4>
        <BetaTag />
      </div>
      {about.intro ? (
        <p className="m-0 max-w-[46ch] font-body text-[15px] font-medium leading-[1.4] text-text-secondary">
          {appName} {about.intro}
        </p>
      ) : null}
    </div>
  )
}

// A row that opens a link, its arrow on the right.
function LinkRow({ href, icon, media = null, label, description, external = true }) {
  return (
    <a
      href={href}
      className={`${PRESSABLE_ROW_CLASSES} no-underline`}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
    >
      <RowText icon={icon} media={media} label={label} description={description} />
      {ARROW}
    </a>
  )
}

// « Tes données »: the disclaimer (who we are, what happens to the
// identifiers) and the anonymous audience, which opens Confidentialité.
function AboutData({ onPrivacyClick }) {
  const isAnalyticsAvailable = useAnalyticsAvailable()
  const [isPrivacyOpen, setPrivacyOpen] = useState(false)
  if (!about.disclaimer && !isAnalyticsAvailable) return null
  return (
    <SettingsGroup title="Tes données">
      {about.disclaimer ? (
        <div className="flex gap-[10px] px-4 py-[13px]">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${MUTED_FILL_CLASSES}`} aria-hidden="true">
            <Icon icon="ph:shield-check" className="h-[17px] w-[17px] text-[var(--color-text)]" />
          </span>
          <p className="m-0 self-center font-body text-[14px] font-medium leading-[1.45] text-text-secondary">{about.disclaimer}</p>
        </div>
      ) : null}
      {isAnalyticsAvailable ? (
        <button
          type="button"
          className={PRESSABLE_ROW_CLASSES}
          onClick={() => (typeof onPrivacyClick === 'function' ? onPrivacyClick() : setPrivacyOpen(true))}
        >
          <RowText icon="ph:chart-line" label="Statistiques anonymes" description="Sans cookie, dans l’UE, sans note ni mail" />
          <Icon icon="ph:caret-right" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />
        </button>
      ) : null}
      <PrivacyModal open={isPrivacyOpen} onClose={() => setPrivacyOpen(false)} />
    </SettingsGroup>
  )
}

function Avatar({ login, size }) {
  return (
    <img
      src={`https://github.com/${login}.png?size=${size * 2}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-full object-cover ${MUTED_FILL_CLASSES}`}
      style={{ width: size, height: size }}
    />
  )
}

// A team member's accent (TAFAC_TEAM's `accent`): their role tag's colour.
const TEAM_ACCENTS = {
  blue: '#2f7cf6',
  red: '#ef4444',
}

// A member of « Équipe » (TAFAC_TEAM): a plain card with the avatar, the
// name, the GitHub login and the role as a tag in their accent. Opens their
// GitHub.
function TeamCard({ member }) {
  const accent = TEAM_ACCENTS[member.accent] ?? null
  return (
    <a
      href={`https://github.com/${member.login}`}
      target="_blank"
      rel="noopener noreferrer"
      style={accent ? { '--accent': accent } : undefined}
      className={`${CARD_CLASSES} group relative flex flex-col items-start gap-[10px] p-[14px] no-underline text-[var(--color-text)] transition-[box-shadow,transform] duration-150 hover:shadow-[0_3px_10px_rgba(0,0,0,0.08)] active:scale-[0.98] motion-reduce:transition-none`}
    >
      <Avatar login={member.login} size={40} />
      <span className="flex min-w-0 max-w-full flex-col gap-[3px]">
        <span className="truncate font-body text-[16px] font-semibold leading-[1.2] tracking-[-0.3px]">{member.name}</span>
        <span className="truncate font-body text-[13px] font-medium leading-[1.2] text-text-60">@{member.login}</span>
      </span>
      {member.role ? (
        <span className={`inline-flex max-w-full items-center gap-[5px] rounded-full py-[4px] pl-[7px] pr-[9px] font-body text-[12px] font-semibold leading-[1.2] ${accent
          ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[color-mix(in_srgb,var(--accent)_75%,black)] dark:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] dark:text-[color-mix(in_srgb,var(--accent)_55%,white)]'
          : `${MUTED_FILL_CLASSES} text-[var(--color-text)]`}`}
        >
          {member.roleIcon ? <Icon icon={member.roleIcon} className="size-[13px] shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">{member.role}</span>
        </span>
      ) : null}
      <span className="absolute right-[12px] top-[12px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">{ARROW}</span>
    </a>
  )
}

// « Équipe » as cards side by side (the university's list), then
// « Contributeurs » as chips: everyone who committed to the repo on GitHub
// but the team, so a new contributor shows up by themselves. Each opens
// the person's GitHub; each part hides when empty.
function AboutPeople() {
  const team = about.team ?? []
  const contributors = useRepoContributors(about.repoUrl, team.map((member) => member.login))
  return (
    <>
      {team.length ? (
        <div className="flex flex-col gap-[7px]">
          <h4 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">Équipe</h4>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {team.map((member) => <TeamCard key={member.login} member={member} />)}
          </div>
        </div>
      ) : null}
      {contributors.length ? (
        <div className="flex flex-col gap-[7px]">
          <h4 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">Contributeurs</h4>
          <div className="flex flex-wrap gap-2">
            {contributors.map((contributor) => (
              <a
                key={contributor.login}
                href={`https://github.com/${contributor.login}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`${contributor.contributions} contribution${contributor.contributions > 1 ? 's' : ''}`}
                className="flex items-center gap-2 rounded-full border border-white bg-white py-[5px] pl-[5px] pr-3 font-body text-[14px] font-medium text-[var(--color-text)] no-underline shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-colors duration-[120ms] hover:bg-[#f8f7f3] dark:border-[var(--color-border)] dark:bg-[var(--color-bg-surface)] dark:hover:bg-[var(--color-bg-subtle)]"
              >
                <Avatar login={contributor.login} size={24} />
                {contributor.login}
              </a>
            ))}
          </div>
          <p className="m-0 px-1 font-body text-[13px] font-medium leading-[1.4] text-text-50">Merci à tous ceux qui ont contribué au code</p>
        </div>
      ) : null}
    </>
  )
}

// À propos, in Réglages and in its own modal (login page, footer). `leading`:
// rows on top of the links' card (Réglages' « Nouveautés »).
// `onPrivacyClick`: Réglages jumps to its Confidentialité section instead
// of opening the privacy modal on top.
export function AboutPage({ leading = null, onPrivacyClick = null, demoLinkLabel = '', onDemoLinkClick = null }) {
  const shouldShowDemoLink = typeof onDemoLinkClick === 'function' && demoLinkLabel.trim()
  const repoSlug = readRepoSlug(about.repoUrl)
  const hasLinks = Boolean(leading || about.repoUrl || papillonUrl || about.contactEmail)
  return (
    <div className="flex flex-col gap-[18px]">
      <AboutHero />
      {hasLinks ? (
        <SettingsGroup>
          {leading}
          {about.contactEmail ? (
            <LinkRow href={`mailto:${about.contactEmail}`} external={false} icon="ph:envelope-simple" label="Contacter l’équipe" description={about.contactEmail} />
          ) : null}
          {about.repoUrl ? (
            <LinkRow href={about.repoUrl} icon="ph:github-logo" label="Code source" description={repoSlug ? `${repoSlug} sur GitHub` : 'Sur GitHub'} />
          ) : null}
          {/* Who makes it (branding.papillon). */}
          {papillonUrl ? (
            <LinkRow
              href={papillonUrl}
              media={(
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${MUTED_FILL_CLASSES}`} aria-hidden="true">
                  {/* Papillon's butterfly in the text colour, as the other rows' icons. */}
                  <span
                    className="size-[18px] bg-[var(--color-text)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
                    style={{ maskImage: `url("${papillonMark}")`, WebkitMaskImage: `url("${papillonMark}")` }}
                  />
                </span>
              )}
              label="Papillon"
              description={`${universityConfig.branding.appName} fait partie de Papillon et est développé par la même équipe`}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      <AboutData onPrivacyClick={onPrivacyClick} />
      <AboutPeople />
      {about.authorLine ? (
        <p className="m-0 px-1 font-body text-[13px] font-medium text-text-50">
          {about.authorUrl ? (
            <a href={about.authorUrl} className="text-text-50 underline underline-offset-2" target="_blank" rel="noopener noreferrer">{about.authorLine}</a>
          ) : about.authorLine}
        </p>
      ) : null}
      {shouldShowDemoLink ? (
        <button
          type="button"
          className="self-start p-0 px-1 border-0 bg-transparent text-text-muted font-body text-[13px] font-medium leading-[1.35] underline underline-offset-2 cursor-pointer transition-colors duration-[120ms] hover:text-text"
          onClick={onDemoLinkClick}
        >
          {demoLinkLabel}
        </button>
      ) : null}
    </div>
  )
}

function AboutModal({
  open,
  onClose,
  demoLinkLabel = '',
  onDemoLinkClick = null,
}) {
  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="weather-modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-backdrop p-5 animate-modal-backdrop-in max-sm:p-[14px]"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="w-[min(440px,100%)] max-h-[calc(100dvh-40px)] overflow-y-auto overscroll-contain modal-corners [--modal-inset:21px] [--modal-inner-radius:20px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] animate-modal-card-in max-sm:max-h-[calc(100dvh-28px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-[15px] p-[21px]">
          <div className="flex items-center justify-between">
            <h2 id="about-modal-title" className="m-0 text-[22px] font-bold leading-[1.1]">
              À propos
            </h2>
            <CloseButton onClick={onClose} />
          </div>

          <AboutPage demoLinkLabel={demoLinkLabel} onDemoLinkClick={onDemoLinkClick} />
        </div>
      </section>
    </div>
  )
}

export default AboutModal
