import universityConfig from '@university'
import { resolveLogo } from '../establishmentLogo'
import LogoBut1 from './LogoBut1'

const branding = universityConfig.branding
const lockupAlt = branding.sidebarLogoAlt ?? branding.appName

const VARIANTS = {
  sidebar: {
    lockupLight: 'block h-[58px] w-auto dark:hidden',
    lockupDark: 'hidden h-[58px] w-auto dark:block',
    lent: 'h-10',
    uni: 'h-[24px] w-auto min-w-0 object-contain',
    uniSquare: 'h-9 w-auto min-w-0 object-contain',
    row: 'inline-flex items-center gap-3.5 min-w-0',
  },
  header: {
    lockupLight: 'block w-[290px] h-16 object-contain max-xl:w-[180px] max-xl:h-12 max-md:w-[200px] max-md:h-auto dark:hidden',
    lockupDark: 'hidden w-[290px] h-16 object-contain max-xl:w-[180px] max-xl:h-12 max-md:w-[200px] max-md:h-auto dark:block',
    lent: 'h-16 max-xl:h-12 max-md:h-10',
    // The header sits over the hero photo, so the university logo is shown in
    // white (back to its own colours when the wallpaper is off, see overrides.css).
    uni: 'header-university-logo h-8 w-auto min-w-0 object-contain max-xl:h-6 [filter:brightness(0)_invert(1)_drop-shadow(0_1px_2px_rgba(0,0,0,0.5))_drop-shadow(0_0_10px_rgba(0,0,0,0.35))]',
    uniSquare: 'header-university-logo h-11 w-auto min-w-0 object-contain max-xl:h-9 [filter:brightness(0)_invert(1)_drop-shadow(0_1px_2px_rgba(0,0,0,0.5))_drop-shadow(0_0_10px_rgba(0,0,0,0.35))]',
    row: 'inline-flex items-center gap-4 min-w-0 max-md:gap-3',
    // Over the photo too: the wordmark in white (the mark keeps its colours).
    wordmark: 'header-wordmark',
  },
}

// Combined "Tafac × université" logo shown in the sidebar and header.
// A university can ship bespoke artwork (branding.lockup / lockupDark);
// otherwise the Tafac logo and the university logo are composed side by side.
// `establishment`: the student's; one with a logo of its own (an IUT, see
// src/establishmentLogo.js) has it composed there instead, bespoke artwork
// or not. Its dark version, if any, replaces the inverted one in dark mode.
// The student's choices (Mon compte): `showLogo` false, Tafac's alone;
// `logoSource` 'university', the university's even so.
function UniversityLockup({ variant = 'sidebar', establishment = null, showLogo = true, logoSource = 'establishment' }) {
  const classes = VARIANTS[variant] ?? VARIANTS.sidebar
  const logo = showLogo
    ? resolveLogo(universityConfig, logoSource === 'university' ? null : establishment)
    : null

  if (showLogo && branding.lockup && !logo?.establishment) {
    return (
      <>
        <img src={branding.lockup} alt={lockupAlt} className={classes.lockupLight} />
        <img src={branding.lockupDark ?? branding.lockup} alt={lockupAlt} className={classes.lockupDark} />
      </>
    )
  }

  const uniClasses = logo?.shape === 'square' ? classes.uniSquare : classes.uni
  const alt = logo?.establishment ? logo.alt : lockupAlt

  return (
    <span className={classes.row}>
      <LogoBut1 className={classes.lent} wordmarkClassName={classes.wordmark ?? ''} />
      {logo && logo.srcDark ? (
        <>
          <img src={logo.src} alt={alt} className={`${uniClasses} is-themed block dark:hidden`} />
          <img src={logo.srcDark} alt={alt} className={`${uniClasses} is-themed hidden dark:block`} />
        </>
      ) : logo ? (
        <img src={logo.src} alt={alt} className={`${uniClasses} block ${variant === 'sidebar' ? 'dark:invert' : ''}`} />
      ) : null}
    </span>
  )
}

export default UniversityLockup
