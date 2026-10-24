// « Bêta », beside Tafac's logo or name (landing header, login, À propos).
// In the brand colours, so it holds in dark mode; `onSky`: translucent white
// instead, on the login page's sky. `size`: 'sm' (next to a header-sized logo
// or a line of text) or 'lg' (by the login page's big logo).
const SIZES = {
  sm: 'px-2 py-0.5 text-[11px]',
  lg: 'px-2.5 py-1 text-[13px]',
}

function BetaTag({ size = 'sm', onSky = false, className = '' }) {
  const colors = onSky ? 'bg-white/20 text-white ring-1 ring-inset ring-white/45' : 'bg-brand text-bg'

  return (
    <span className={`inline-block shrink-0 rounded-full font-bold uppercase leading-[1.3] tracking-[0.06em] ${colors} ${SIZES[size] ?? SIZES.sm} ${className}`}>
      Bêta
    </span>
  )
}

export default BetaTag
