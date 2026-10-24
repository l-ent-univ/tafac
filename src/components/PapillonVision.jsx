import { useRef } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import papillonLogo from '../assets/landing/papillon-logo.svg'
import { copy, copyText } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import LogoBut1 from './LogoBut1'

const papillonUrl = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride())

// PLACEHOLDER copy, for the landing page's mockup: to rewrite before launch
// (landingCopy.json, `papillon`).
// The landing page's last block, in Tafac's own look, no card (on the
// page's bottom glow, LandingPage): Tafac's logo and Papillon's side by
// side, what that means (Papillon's association; Tafac made by the same team,
// Tom and Lucas) and a way to Papillon.
// Only while Tafac shows it's part of Papillon (branding.papillon, the one
// switch for every mention); LandingPage falls back on LandingContact
// otherwise. Rises in once on screen (.landing-contact in overrides.css).
function PapillonVision({ className = '' }) {
  const ref = useRef(null)
  const isRevealed = useRevealOnce(ref)

  if (!papillonUrl) return null

  return (
    <section className={`flex justify-center px-6 pt-4 max-md:px-4 max-md:pt-2 ${className}`} aria-labelledby="papillon-vision-title">
      <div
        ref={ref}
        data-revealed={isRevealed || undefined}
        className="landing-contact flex w-full max-w-[880px] flex-col items-center pt-6 pb-14 text-center max-md:pt-4 max-md:pb-10"
      >
        {/* Tafac, "fait partie de", Papillon: the relationship at a glance. */}
        <p className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <LogoBut1 className="h-9 max-md:h-8" />
          <span className="text-[15px] font-semibold text-text-secondary font-body">{copyText(copy.papillon.partOf)}</span>
          <img src={papillonLogo} alt="Papillon" width="148" height="32" draggable="false" className="block h-7 w-auto max-md:h-6" />
        </p>
        <h2 id="papillon-vision-title" className="m-0 mt-8 max-w-[24ch] text-balance text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text max-md:mt-6">
          {copyText(copy.papillon.title)}
        </h2>
        <p className="m-0 mt-4 max-w-[56ch] text-balance text-base leading-snug text-text-secondary font-body">
          {copyText(copy.papillon.body)}
        </p>
        <a
          href={papillonUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex min-h-12 items-center gap-2.5 whitespace-nowrap rounded-full bg-brand px-6 text-[16px] font-semibold text-bg no-underline transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] max-md:gap-2 max-md:px-5 max-md:text-[15px]"
        >
          <Icon icon="carbon:user-multiple" className="size-5" aria-hidden="true" />
          {copyText(copy.papillon.cta)}
        </a>
      </div>
    </section>
  )
}

export default PapillonVision
