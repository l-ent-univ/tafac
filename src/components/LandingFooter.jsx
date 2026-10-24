import universityConfig from '@university'
import { copy, copyText } from '../landingCopy'
import { scrollToSection } from '../landingMotion'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'
import BetaTag from './BetaTag'
import LogoBut1 from './LogoBut1'
import PapillonBadge from './PapillonBadge'

const repoUrl = universityConfig.branding.about?.repoUrl?.replace(/\/$/, '') ?? null
const papillonUrl = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride())
const LINK_CLASSES = 'border-0 bg-transparent p-0 text-left text-[14px] font-medium text-text-secondary no-underline transition-colors hover:text-text font-body cursor-pointer'
// Buttons take `font: inherit` from index.css, over the utilities.
const BUTTON_CLASSES = `${LINK_CLASSES} text-[14px]! font-medium! font-body!`

function FooterLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>
      {children}
    </a>
  )
}

// The landing page's footer: Tafac (in beta, part of Papillon, an
// independent student project) on the left, links in two columns on the
// right (one under the other on phones), then the year and the licence.
function LandingFooter({ onLogin }) {
  return (
    <footer className="border-t border-border/60 px-6 pt-12 pb-10 max-md:px-4 max-md:pt-10 max-md:pb-8">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10">
        <div className="flex justify-between gap-10 max-md:flex-col">
          <div className="flex max-w-[34ch] flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <LogoBut1 className="h-8" />
              <BetaTag />
            </div>
            <PapillonBadge className="text-text-secondary hover:text-text" logoClassName="dark:[filter:brightness(0)_invert(1)]" />
            <p className="m-0 text-[13px] leading-snug text-text-secondary font-body">
              {copyText(copy.footer.tagline)}
            </p>
          </div>
          <nav aria-label="Liens du pied de page" className="flex gap-16 max-md:gap-12">
            <div className="flex flex-col gap-2.5">
              <p className="m-0 text-[15px] font-bold text-text">{copyText(copy.footer.tafacColumn)}</p>
              <a href="#fonctionnalites" className={LINK_CLASSES} onClick={(event) => scrollToSection(event, 'fonctionnalites')}>
                {copyText(copy.footer.features)}
              </a>
              <a href="#mot-de-passe" className={LINK_CLASSES} onClick={(event) => scrollToSection(event, 'mot-de-passe')}>
                {copyText(copy.footer.privacy)}
              </a>
              <a href="#faq" className={LINK_CLASSES} onClick={(event) => scrollToSection(event, 'faq')}>
                {copyText(copy.footer.faq)}
              </a>
              <button type="button" className={BUTTON_CLASSES} onClick={onLogin}>
                {copyText(copy.footer.login)}
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="m-0 text-[15px] font-bold text-text">{copyText(copy.footer.projectColumn)}</p>
              {repoUrl ? <FooterLink href={repoUrl}>{copyText(copy.footer.code)}</FooterLink> : null}
              {repoUrl ? <FooterLink href={`${repoUrl}/issues`}>{copyText(copy.footer.report)}</FooterLink> : null}
              {papillonUrl ? <FooterLink href={papillonUrl}>{copyText(copy.footer.papillon)}</FooterLink> : null}
            </div>
          </nav>
        </div>
        <p className="m-0 text-[13px] text-text-muted font-body">
          {copyText(copy.footer.legal)}
        </p>
      </div>
    </footer>
  )
}

export default LandingFooter
