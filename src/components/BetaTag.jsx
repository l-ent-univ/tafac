import SmoothSurface from './SmoothSurface'

// « Bêta », beside Tafac's logo or name (landing header, login, À propos).
// In the brand colours with the primary button's texture (.lent-button: a
// dark edge, a white rim, a sharp shadow, on the smooth pill), so it holds
// in dark mode; `onSky`: the glass material instead, on the login page's
// sky. `size`: 'sm' (next to a header-sized logo or a line of text) or 'lg'
// (by the login page's big logo). The same padding on every side.
const SIZES = {
  sm: 'p-[5px] text-[11px]',
  lg: 'p-[7px] text-[13px]',
}

function BetaTag({ size = 'sm', onSky = false, className = '' }) {
  // On the sky: the glass material (.glass), its fill the clear white
  // tint the white letters need.
  const colors = onSky
    ? 'glass rounded-full text-white [--glass-fill:rgb(255_255_255/0.2)]'
    : 'lent-button lent-button--tag rounded-full'

  return (
    <span className={`inline-block shrink-0 font-bold uppercase leading-none tracking-[0.06em] ${colors} ${SIZES[size] ?? SIZES.sm} ${className}`}>
      {onSky ? null : <SmoothSurface />}
      Bêta
    </span>
  )
}

export default BetaTag
