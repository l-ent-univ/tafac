import { useId } from 'react'
import universityLogo from '../../assets/uni_logos/univ-rennes-white.svg'

// Placeholder QR (deterministic pattern, NOT scannable) until a real QR is
// passed through the `qr` prop (e.g. <QRCodeSVG /> from `qrcode.react`).
function PlaceholderQr({ seed, size }) {
  const n = 21
  const cell = size / n
  let s = 0
  for (const ch of String(seed || 'x')) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9)
  const cells = []
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!inFinder(x, y) && rnd() > 0.5) {
        cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} />)
      }
    }
  }
  const finder = (fx, fy) => (
    <g key={`${fx}-${fy}`} transform={`translate(${fx * cell} ${fy * cell})`}>
      <rect width={cell * 7} height={cell * 7} />
      <rect x={cell} y={cell} width={cell * 5} height={cell * 5} fill="#fff" />
      <rect x={cell * 2} y={cell * 2} width={cell * 3} height={cell * 3} />
    </g>
  )
  return (
    <g fill="#111">
      {cells}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </g>
  )
}

function EuFlag({ x, y }) {
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2
    return <circle key={i} cx={20 + Math.cos(a) * 11} cy={14 + Math.sin(a) * 11} r="1.6" fill="#fc0" />
  })
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="40" height="28" fill="#1d3f94" />
      {stars}
    </g>
  )
}

/**
 * Student card, as an SVG (card format, 85.6 × 54 mm).
 * Every value comes from the props.
 */
export default function Rennes1StudentCard({
  year = '',
  studentNumber = '',
  nationalNumber = '',
  lastName = '',
  firstName = '',
  birthDate = '',
  formation = '',
  photoSrc = null,
  qr = null,
  // The Université de Rennes' white logo, on the black banner.
  logoSrc = universityLogo,
  institution = ['Université', 'de Rennes'],
  className = '',
}) {
  const uid = useId().replace(/:/g, '')
  // Clear of the decorative stripes on the left edge.
  const TEXT_X = 102
  // Every field always shows, even when empty (the value follows its label).
  const lines = [
    `N° National : ${nationalNumber}`,
    `Nom : ${lastName}`,
    `Prénom : ${firstName}`,
    `Né(e) le : ${birthDate}`,
    formation,
  ]

  return (
    <svg
      viewBox="0 0 856 540"
      className={className}
      role="img"
      aria-label={`Carte étudiante de ${[firstName, lastName].filter(Boolean).join(' ')}`}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily="Arial, Helvetica, sans-serif"
    >
      <defs>
        <clipPath id={`${uid}-card`}>
          <rect width="856" height="540" rx="36" />
        </clipPath>
        <clipPath id={`${uid}-photo`}>
          <rect x="640" y="40" width="170" height="210" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}-card)`}>
        <rect width="856" height="540" fill="#fff" />

        {/* Black banner + logo */}
        <rect x="40" y="40" width="330" height="125" fill="#000" />
        {logoSrc ? (
          <image
            href={logoSrc}
            x="60"
            y="55"
            width="290"
            height="95"
            preserveAspectRatio="xMinYMid meet"
          />
        ) : (
          <>
            <g transform="translate(70 76)" stroke="#fff" strokeWidth="5" strokeLinecap="round">
              {Array.from({ length: 12 }, (_, i) => (
                <line key={i} x1="0" y1="-14" x2="0" y2="-30" transform={`translate(30 30) rotate(${i * 30})`} />
              ))}
            </g>
            <text x="130" y="100" fill="#fff" fontSize="30" fontWeight="700">{institution[0]}</text>
            <text x="130" y="134" fill="#fff" fontSize="30" fontWeight="700">{institution[1]}</text>
          </>
        )}

        {/* Decorative stripes */}
        <polygon points="40,215 90,250 90,282 40,247" fill="#000" />
        <polygon points="40,300 60,312 40,328" fill="#000" />
        <polygon points="470,540 520,470 556,470 506,540" fill="#000" />
        <polygon points="545,540 595,470 631,470 581,540" fill="#000" />

        {/* Fields */}
        <text x={TEXT_X} y="218" fontSize="32" fontWeight="700" fill="#111">{`Année : ${year}`}</text>
        <text x={TEXT_X} y="256" fontSize="27" fontWeight="700" fill="#111">{`N° Etudiant : ${studentNumber}`}</text>
        {lines.map((line, index) => (
          <text key={index} x={TEXT_X} y={296 + index * 44} fontSize="25" fill="#111" xmlSpace="preserve">{line}</text>
        ))}

        {/* Photo */}
        <rect x="640" y="40" width="170" height="210" fill="#d9d9d9" />
        {photoSrc ? (
          <image
            href={photoSrc}
            x="640"
            y="40"
            width="170"
            height="210"
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${uid}-photo)`}
          />
        ) : (
          <g fill="#9a9a9a" clipPath={`url(#${uid}-photo)`}>
            <circle cx="725" cy="125" r="34" />
            <ellipse cx="725" cy="235" rx="62" ry="55" />
          </g>
        )}

        {/* European Student Card */}
        <EuFlag x="640" y="268" />
        <text x="690" y="280" fontSize="12" fill="#1d3f94">European</text>
        <text x="690" y="295" fontSize="12" fill="#1d3f94">Student Card</text>

        {/* QR */}
        <g transform="translate(650 320)">
          {qr ?? <PlaceholderQr seed={studentNumber} size={150} />}
        </g>
      </g>
    </svg>
  )
}