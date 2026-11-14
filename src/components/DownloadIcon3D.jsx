import { useId } from 'react'

// « Mise à jour nécessaire »'s icon, drawn like the home's 3D icons
// (src/assets/home-icons-3d): soft, inflated shapes in glossy colour, lit
// from the top left. Plain SVG: each shape is filled flat, then a filter
// blurs its outline into a height map and lights it (diffuse for the
// volume, specular for the shine), so the edges round off like a puffed
// object. A white tray (the envelope's white) and the calendar's red-orange
// arrow dipping into it, its shadow on the tray, the whole on a soft shadow.
function DownloadIcon3D({ size = 88, className = '' }) {
  const id = useId().replace(/:/g, '')
  const puff = `${id}-puff`
  const arrowFill = `${id}-arrow`
  const trayFill = `${id}-tray`
  const slotFill = `${id}-slot`
  const soft = `${id}-soft`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={arrowFill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a52" />
          <stop offset="0.55" stopColor="#ff5a2a" />
          <stop offset="1" stopColor="#e9380f" />
        </linearGradient>
        <linearGradient id={trayFill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e4e3e8" />
        </linearGradient>
        <linearGradient id={slotFill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9b8c0" />
          <stop offset="1" stopColor="#dcdbe1" />
        </linearGradient>
        <filter id={puff} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="height" />
          <feDiffuseLighting in="height" surfaceScale="5" diffuseConstant="1.22" lightingColor="#ffffff" result="volume">
            <feDistantLight azimuth="235" elevation="55" />
          </feDiffuseLighting>
          <feComposite in="SourceGraphic" in2="volume" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="shaded" />
          <feSpecularLighting in="height" surfaceScale="5" specularConstant="0.85" specularExponent="22" lightingColor="#ffffff" result="shine">
            <fePointLight x="36" y="4" z="140" />
          </feSpecularLighting>
          <feComposite in="shine" in2="SourceAlpha" operator="in" result="shineInside" />
          <feComposite in="shaded" in2="shineInside" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" result="lit" />
          <feComposite in="lit" in2="SourceAlpha" operator="in" />
        </filter>
        <filter id={soft} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* The shadow on the ground. */}
      <ellipse cx="80" cy="143" rx="54" ry="8" fill="#2a1a12" opacity="0.2" filter={`url(#${soft})`} />

      {/* The tray, and the slot the arrow goes in. */}
      <rect x="16" y="86" width="128" height="52" rx="24" fill={`url(#${trayFill})`} filter={`url(#${puff})`} />
      <rect x="44" y="96" width="72" height="14" rx="7" fill={`url(#${slotFill})`} opacity="0.85" />

      {/* The arrow's shadow on the tray, then the arrow. */}
      <path
        d="M80 34 L80 70 M52 74 L80 102 L108 74"
        stroke="#3a1608"
        strokeOpacity="0.28"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(3 7)"
        filter={`url(#${soft})`}
      />
      <g filter={`url(#${puff})`}>
        <path
          d="M80 22 L80 66 M50 70 L80 100 L110 70"
          stroke={`url(#${arrowFill})`}
          strokeWidth="30"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M50 70 L80 100 L110 70 Z" fill={`url(#${arrowFill})`} />
      </g>
    </svg>
  )
}

export default DownloadIcon3D
