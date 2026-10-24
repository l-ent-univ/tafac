import { useRef } from 'react'
import betaPhoto from '../assets/landing/beta-photo.webp'
import { copy, copyText, renderCopy } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'
import BetaTag from './BetaTag'

// PLACEHOLDER copy, for the landing page's mockup: to rewrite before launch
// (landingCopy.json, `beta`).
// "Hey, c'est encore en bêta": a word from the team, casual, with a photo
// pinned like a polaroid (tilted, a caption in its margin). Rises in once on
// screen (.landing-contact in overrides.css).
// The caption's link: who's in the photo.
const PHOTO_LINK = 'https://tomthings.fr'

function LandingBeta({ className = '' }) {
  const ref = useRef(null)
  const isRevealed = useRevealOnce(ref)

  return (
    <section className={`flex justify-center px-6 max-md:px-4 ${className}`} aria-labelledby="landing-beta-title">
      <div
        ref={ref}
        data-revealed={isRevealed || undefined}
        className="landing-contact flex w-full max-w-[860px] items-center gap-12 rounded-[32px] border border-white bg-white px-12 py-10 shadow-[0_1px_3px_rgb(52_18_0/0.06),0_10px_28px_-14px_rgb(52_18_0/0.16)] dark:border-white/10 dark:bg-[#1c1c1c] max-md:flex-col max-md:gap-8 max-md:rounded-[28px] max-md:px-5 max-md:py-8 max-md:text-center"
      >
        <figure className="m-0 w-[210px] shrink-0 -rotate-6 rounded-[14px] bg-white p-2.5 pb-0 shadow-[0_2px_6px_rgb(52_18_0/0.1),0_18px_36px_-14px_rgb(52_18_0/0.35)] max-md:w-[180px]">
          <img
            src={betaPhoto}
            alt=""
            width="720"
            height="720"
            loading="lazy"
            draggable="false"
            className="block aspect-square w-full rounded-[8px] object-cover"
          />
          {/* Always on the polaroid's white: its own dark ink in dark mode too. */}
          <figcaption className="flex h-9 items-center justify-center">
            <a
              href={PHOTO_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-[15px] font-bold leading-none text-[#341200]/75 no-underline decoration-[#341200]/40 underline-offset-[3px] transition-colors hover:text-[#341200] hover:underline"
            >
              {copyText(copy.beta.photoCaption)}
            </a>
          </figcaption>
        </figure>
        <div className="flex min-w-0 flex-col items-start gap-3 max-md:items-center">
          <BetaTag size="lg" />
          <h2 id="landing-beta-title" className="m-0 text-balance text-[clamp(28px,3.2vw,38px)] font-bold leading-[1.05] text-text">
            {copyText(copy.beta.title)}
          </h2>
          <p className="m-0 max-w-[40ch] text-balance text-[17px] leading-snug text-text-secondary font-body max-md:text-base">
            {renderCopy(copy.beta.body)}
          </p>
        </div>
      </div>
    </section>
  )
}

export default LandingBeta
