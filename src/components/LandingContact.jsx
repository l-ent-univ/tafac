import { useRef } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { copy, copyText } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'
import SmoothSurface from './SmoothSurface'

const about = universityConfig.branding.about ?? {}
const team = about.team ?? []
// Questions and bugs go to the repo's issues: the team's only public contact.
const issuesUrl = about.repoUrl ? `${about.repoUrl.replace(/\/$/, '')}/issues` : null

// PLACEHOLDER copy, for the landing page's mockup: to rewrite before launch
// (landingCopy.json, `contact`).
// The last block of the landing page: Tafac is free, who makes it (the team's
// GitHub avatars, as in À propos) and where to reach them. A card that rises
// in once on screen (.landing-contact in overrides.css).
function LandingContact({ className = '' }) {
  const ref = useRef(null)
  const isRevealed = useRevealOnce(ref)

  return (
    <section className={`flex justify-center px-6 max-md:px-4 ${className}`} aria-labelledby="landing-contact-title">
      <div
        ref={ref}
        data-revealed={isRevealed || undefined}
        className="landing-contact flex w-full max-w-[720px] glass-solid glass--quiet border flex-col items-center gap-5 corners-[32px] px-10 py-10 text-center max-md:corners-[28px] max-md:px-5 max-md:py-8"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-[13px] font-bold uppercase tracking-[0.06em] text-success-text">
          <Icon icon="ph:check-circle" className="size-4" aria-hidden="true" />
          {copyText(copy.contact.badge)}
        </span>
        <h2 id="landing-contact-title" className="m-0 max-w-[22ch] text-balance text-[clamp(26px,3vw,36px)] font-bold leading-[1.05] text-text">
          {copyText(copy.contact.title)}
        </h2>
        <p className="m-0 max-w-[48ch] text-balance text-base leading-snug text-text-secondary font-body">
          {copyText(copy.contact.body)}
        </p>
        {team.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap justify-center gap-3 p-0">
            {team.map(({ name, login }) => (
              <li key={login}>
                <a
                  href={`https://github.com/${login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-solid flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-left no-underline"
                >
                  <img
                    src={`https://github.com/${login}.png?size=96`}
                    alt=""
                    width="40"
                    height="40"
                    loading="lazy"
                    className="block size-10 rounded-full bg-bg object-cover"
                  />
                  <span className="flex flex-col">
                    <span className="text-[15px] font-bold leading-tight text-text">{name}</span>
                    <span className="text-[13px] leading-tight text-text-secondary font-body">@{login}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {issuesUrl ? (
          <a
            href={issuesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center gap-2 lent-button relative rounded-full px-6 text-[16px] no-underline"
          >
            <SmoothSurface />
            <Icon icon="ph:github-logo" className="size-5" aria-hidden="true" />
            {copyText(copy.contact.cta)}
          </a>
        ) : null}
      </div>
    </section>
  )
}

export default LandingContact
