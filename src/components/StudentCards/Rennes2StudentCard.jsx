import { useId } from 'react'
import universityLogo from '../../assets/uni_logos/univ-rennes2-blue.svg'

// Placeholder logo (blue square with a "2") when `logoSrc` is null.
function FallbackLogo({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="56" height="56" rx="6" fill="#0a8fc7" />
      <text x="28" y="43" textAnchor="middle" fontSize="42" fontWeight="700" fill="#fff">2</text>
    </g>
  )
}

/**
 * Student card, model 2 (light card, photo on the right, the university's logo in blue).
 * Every value comes from the props; the fields always show, even when empty.
 */
export default function Rennes2StudentCard({
  year = '',
  studentNumber = '',
  nationalNumber = '',
  lastName = '',
  firstName = '',
  birthDate = '',
  birthPlace = '',
  formation = '',
  socialSecurityNote = '',
  photoSrc = null,
  logoSrc = universityLogo,
  className = '',
}) {
  const uid = useId().replace(/:/g, '')
  const LABEL_X = 52
  const VALUE_X = 215
  const rows = [
    { y: 128, label: 'Année', value: year, bold: true },
    { y: 172, label: 'N Rennes2 :', value: studentNumber, bold: true },
    { y: 222, label: 'N National :', value: nationalNumber },
    { y: 272, label: 'Nom :', value: lastName.toUpperCase(), bold: true },
    { y: 322, label: 'Prénom :', value: firstName.toUpperCase(), bold: true },
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
        <clipPath id={`${uid}-photo`}>
          <rect x="648" y="68" width="168" height="218" />
        </clipPath>
      </defs>

      {/* Card + inner frame */}
      <rect width="856" height="540" rx="32" fill="#fff" />
      <rect x="20" y="20" width="816" height="500" rx="24" fill="#f6f6f4" stroke="#e3e3df" strokeWidth="2" />

      {/* Fields */}
      {rows.map((row) => (
        <g key={row.label}>
          <text x={LABEL_X} y={row.y} fontSize="24" fontWeight={row.bold ? 700 : 400} fill="#222">{row.label}</text>
          <text x={VALUE_X} y={row.y} fontSize="26" fontWeight="700" fill="#111">{row.value}</text>
        </g>
      ))}

      {/* Birth */}
      <text x={LABEL_X} y="378" fontSize="24" fill="#222">Né(e) le</text>
      <text x={VALUE_X} y="378" fontSize="24" fill="#222">{birthDate}</text>
      <text x="395" y="382" fontSize="24" fill="#222">à</text>
      <text x="440" y="378" fontSize="24" fill="#222">{birthPlace.toUpperCase()}</text>

      {/* Note + formation */}
      {socialSecurityNote ? (
        <text x={LABEL_X} y="446" fontSize="22" fill="#333">{socialSecurityNote}</text>
      ) : null}
      <text x="110" y="488" fontSize="22" fill="#333">{formation}</text>

      {/* Photo */}
      <rect x="640" y="60" width="184" height="234" fill="#fff" stroke="#dcdcd8" strokeWidth="2" />
      <rect x="648" y="68" width="168" height="218" fill="#d9d9d9" />
      {photoSrc ? (
        <image
          href={photoSrc}
          x="648"
          y="68"
          width="168"
          height="218"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${uid}-photo)`}
        />
      ) : (
        <g fill="#9a9a9a" clipPath={`url(#${uid}-photo)`}>
          <circle cx="732" cy="150" r="36" />
          <ellipse cx="732" cy="270" rx="66" ry="58" />
        </g>
      )}

      {/* Logo, under the photo */}
      {logoSrc ? (
        <image href={logoSrc} x="640" y="318" width="184" height="174" preserveAspectRatio="xMidYMid meet" />
      ) : (
        <FallbackLogo x={704} y={377} />
      )}
    </svg>
  )
}