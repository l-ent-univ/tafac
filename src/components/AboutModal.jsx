import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { useAnalyticsAvailable } from '../analytics'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import { MUTED_FILL_CLASSES, PRESSABLE_ROW_CLASSES } from '../settingsStyles'
import useRepoContributors from '../useRepoContributors'
import BetaTag from './BetaTag'
import PrivacyModal from './PrivacyModal'
import SettingsGroup, { RowText } from './SettingsGroup'
import CloseButton from './CloseButton'

/* global __BUILD_HASH__ */

const about = universityConfig.branding.about ?? {}
const papillonUrl = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride())

// One person, a Réglages row: their GitHub avatar, a name, a line under it,
// opening their GitHub profile.
function PersonRow({ login, name, detail }) {
  return (
    <a
      href={`https://github.com/${login}`}
      className={`${PRESSABLE_ROW_CLASSES} no-underline`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <RowText
        media={(
          <img
            src={`https://github.com/${login}.png?size=64`}
            alt=""
            width="32"
            height="32"
            loading="lazy"
            className={`h-8 w-8 shrink-0 rounded-full object-cover ${MUTED_FILL_CLASSES}`}
          />
        )}
        label={name}
        description={detail}
      />
      <Icon icon="carbon:arrow-up-right" className="h-4 w-4 shrink-0 text-text-50" aria-hidden="true" />
    </a>
  )
}

// « Aide »: write to the team (branding.about.contactEmail), the address
// shown under the button. Hidden without an address.
export function AboutHelp() {
  if (!about.contactEmail) return null
  return (
    <SettingsGroup title="Aide">
      <a href={`mailto:${about.contactEmail}`} className={`${PRESSABLE_ROW_CLASSES} no-underline`}>
        <RowText icon="carbon:email" label="Contacter l’équipe" description={about.contactEmail} />
        <Icon icon="carbon:arrow-up-right" className="h-4 w-4 shrink-0 text-text-50" aria-hidden="true" />
      </a>
    </SettingsGroup>
  )
}

// « Équipe » and « Contributeurs », in the Réglages style and apart from the
// À propos text (their own cards, under it). The team is the university's
// list; the contributors come from the repo on GitHub, everyone who has
// committed to it but the team, so a new contributor shows up by
// themselves. Each part hides when empty.
export function AboutTeam() {
  const team = about.team ?? []
  const contributors = useRepoContributors(about.repoUrl, team.map((member) => member.login))
  if (!team.length && !contributors.length) return null
  return (
    <div className="flex flex-col gap-[18px]">
      {team.length ? (
        <SettingsGroup title="Équipe">
          {team.map((member) => (
            <PersonRow key={member.login} login={member.login} name={member.name} detail={`@${member.login} sur GitHub`} />
          ))}
        </SettingsGroup>
      ) : null}
      {contributors.length ? (
        <SettingsGroup title="Contributeurs" footer="Tous ceux qui ont contribué au code. Merci à eux !">
          {contributors.map((contributor) => (
            <PersonRow
              key={contributor.login}
              login={contributor.login}
              name={contributor.login}
              detail={`${contributor.contributions} contribution${contributor.contributions > 1 ? 's' : ''}`}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </div>
  )
}

// Body of the "À propos" modal, also embedded in Réglages. There,
// `onPrivacyClick` jumps to the Confidentialité section instead of opening
// the privacy modal on top.
// `children`: shown at the end, before the build line (the modal's team).
export function AboutContent({ demoLinkLabel = '', onDemoLinkClick = null, onPrivacyClick = null, children = null }) {
  const shouldShowDemoLink = typeof onDemoLinkClick === 'function' && demoLinkLabel.trim()
  const isAnalyticsAvailable = useAnalyticsAvailable()
  const [isPrivacyOpen, setPrivacyOpen] = useState(false)

  return (
    <div className="flex flex-col gap-3 font-body text-[15px] leading-[1.45]">
      <p className="m-0">
        <strong>{universityConfig.branding.appName}</strong> <BetaTag className="align-[0.1em]" /> {about.intro}
      </p>
      {/* Who makes it (branding.papillon). */}
      {papillonUrl ? (
        <p className="m-0">
          {universityConfig.branding.appName} fait partie de{' '}
          <a
            href={papillonUrl}
            className="text-text underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            Papillon
          </a>
          {' '}et est développé par la même équipe
        </p>
      ) : null}
      {about.disclaimer ? (
        <p className="m-0 text-text-secondary">
          {about.disclaimer}
        </p>
      ) : null}
      {isAnalyticsAvailable ? (
        <p className="m-0 text-text-secondary">
          L'audience est mesurée de façon anonyme et sans cookie, et dans l'UE. Aucune note, aucun mail et aucun identifiant n’est collecté. Cette analyse peut être désactivée à tout moment{' '}
          <button type="button" className="p-0 border-0 bg-transparent font-inherit text-[inherit] text-text underline underline-offset-2 cursor-pointer" onClick={() => (typeof onPrivacyClick === 'function' ? onPrivacyClick() : setPrivacyOpen(true))}>
            En savoir plus
          </button>
        </p>
      ) : null}
      <PrivacyModal open={isPrivacyOpen} onClose={() => setPrivacyOpen(false)} />
      {about.repoUrl ? (
        <p className="m-0">
          Code source disponible sur{' '}
          <a
            href={about.repoUrl}
            className="text-text underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      ) : null}
      {about.authorLine ? (
        <p className="m-0 text-text-muted text-[13px]">
          {about.authorUrl ? (
            <a
              href={about.authorUrl}
              className="text-text-muted underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              {about.authorLine}
            </a>
          ) : about.authorLine}
        </p>
      ) : null}
      {children}
      <p className="m-0 text-text-muted text-[12px] font-mono">
        {import.meta.env.DEV ? 'dev' : `build ${typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'}`}
      </p>
      {shouldShowDemoLink ? (
        <div className="pt-1">
          <button
            type="button"
            className="p-0 border-0 bg-transparent text-text-muted font-inherit text-[13px] font-medium leading-[1.35] underline underline-offset-2 transition-colors duration-[120ms] hover:text-text"
            onClick={onDemoLinkClick}
          >
            {demoLinkLabel}
          </button>
        </div>
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

          <AboutContent demoLinkLabel={demoLinkLabel} onDemoLinkClick={onDemoLinkClick}>
            <AboutHelp />
            <AboutTeam />
          </AboutContent>
        </div>
      </section>
    </div>
  )
}

export default AboutModal
