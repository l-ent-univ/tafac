import universityConfig from '@university'
import papillonLogo from '../assets/landing/papillon-logo.svg'
import { getPapillonUrl, readPapillonDebugOverride } from '../papillon'

const papillonUrl = getPapillonUrl(universityConfig.branding, readPapillonDebugOverride())

// « Fait partie de [Papillon] », under Tafac's logo, to Papillon's site
// (Papillon's own logo, from PapillonApp/Papillon's PapillonLogo.tsx).
// Nothing without `branding.papillon`. `size`: 'sm' (in headers) or 'lg'
// (under a big logo); `className`: the text colours, `logoClassName`: the
// logo's (a filter, e.g. white on the sky).
const SIZES = {
  sm: { link: 'gap-1.5 text-xs', logo: 'h-3.5' },
  lg: { link: 'gap-2 text-[17px]', logo: 'h-5' },
}

function PapillonBadge({ size = 'sm', className = '', logoClassName = '' }) {
  if (!papillonUrl) return null
  const sizes = SIZES[size] ?? SIZES.sm

  return (
    <a
      href={papillonUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center ${sizes.link} font-semibold no-underline transition-colors ${className}`}
    >
      Fait partie de
      <img src={papillonLogo} alt="Papillon" width="148" height="32" draggable="false" className={`block ${sizes.logo} w-auto ${logoClassName}`} />
    </a>
  )
}

export default PapillonBadge
