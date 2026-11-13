// The picture over the code field of a two-factor login, one per way of
// getting the code: an authenticator application, a SMS, a mail. Drawn in
// the look of the home icons (soft gradients, a hairline rim, a shadow on
// the ground) but as SVG, so each part moves on its own: the phone's timer
// runs down and its code comes anew, the bubble's dots type, the envelope's
// flap closes under its seal. The motion is in overrides.css (« Login:
// one-time code »); `state` is what the form is doing ('idle', 'sending',
// 'checking', 'refused') and `sent` adds the tick of a code on its way.
// `beat` counts the digits typed: the icon hops at each one.
// A refused code turns each one red, a cross where its detail was: the
// phone's screen, the bubble, the envelope's seal.
//
// One icon of a kind shows at a time: the gradients' ids are plain.

// The cross of a refused code, `reach` out from its centre on each side.
function Cross({ cx, cy, reach, width }) {
  return (
    <path
      className="otp-icon__no"
      d={`M${cx - reach} ${cy - reach}L${cx + reach} ${cy + reach}M${cx + reach} ${cy - reach}L${cx - reach} ${cy + reach}`}
      fill="none"
      stroke="#fff"
      strokeWidth={width}
      strokeLinecap="round"
    />
  )
}

function AppArt({ refused }) {
  return (
    <>
      <defs>
        <linearGradient id="otpi-app-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dedee7" />
        </linearGradient>
        <linearGradient id="otpi-app-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ad6ff" />
          <stop offset="1" stopColor="#2b59ff" />
        </linearGradient>
        <linearGradient id="otpi-app-screen-no" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffa696" />
          <stop offset="1" stopColor="#d91f16" />
        </linearGradient>
      </defs>
      <rect x="32" y="11" width="56" height="94" rx="14" fill="url(#otpi-app-body)" stroke="#c5c5d0" />
      <rect
        x="37"
        y="17"
        width="46"
        height="82"
        rx="9.5"
        fill={refused ? 'url(#otpi-app-screen-no)' : 'url(#otpi-app-screen)'}
        stroke={refused ? '#a30f0a' : '#2247cf'}
        strokeOpacity="0.45"
      />
      <path d="M37 26.5Q37 17 46.5 17H73.5Q83 17 83 26.5V38Q60 45.5 37 38Z" fill="#fff" opacity="0.2" />
      {refused ? (
        <Cross cx={60} cy={55} reach={10} width={5.4} />
      ) : (
        <>
          {/* The code's timer: a ring that runs down, then starts over. */}
          <circle cx="60" cy="46" r="11.5" fill="none" stroke="#fff" strokeOpacity="0.32" strokeWidth="4.2" />
          <circle
            className="otp-app__ring"
            cx="60"
            cy="46"
            r="11.5"
            fill="none"
            stroke="#fff"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeDasharray="72.26"
            transform="rotate(-90 60 46)"
          />
          {/* The six digits, as dots, in two groups of three like the field. */}
          <rect x="39.5" y="68.5" width="41" height="14" rx="7" fill="#fff" opacity="0.2" />
          {[43.1, 49.7, 56.3, 63.7, 70.3, 76.9].map((x, index) => (
            <circle key={x} className="otp-app__dot" style={{ '--i': index }} cx={x} cy="75.5" r="2.8" fill="#fff" />
          ))}
        </>
      )}
      <rect x="52" y="91.5" width="16" height="2.6" rx="1.3" fill="#fff" opacity="0.55" />
    </>
  )
}

function SmsArt({ refused }) {
  return (
    <>
      <defs>
        <linearGradient id="otpi-sms-bubble" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8faaf" />
          <stop offset="1" stopColor="#16b24a" />
        </linearGradient>
        <linearGradient id="otpi-sms-bubble-no" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffab9c" />
          <stop offset="1" stopColor="#d91f16" />
        </linearGradient>
        <linearGradient id="otpi-sms-dot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3f9e8" />
        </linearGradient>
      </defs>
      <path
        d="M35 22H85A21 21 0 0 1 106 43V63A21 21 0 0 1 85 84H52C46 92 37 98 25 99.5C31 94.5 33.5 89 33.8 83.9C22.6 83.3 14 74.2 14 63V43A21 21 0 0 1 35 22Z"
        fill={refused ? 'url(#otpi-sms-bubble-no)' : 'url(#otpi-sms-bubble)'}
        stroke={refused ? '#a30f0a' : '#0f9440'}
        strokeOpacity="0.55"
        strokeLinejoin="round"
      />
      <path d="M22 45Q22 29.5 37 29.5H83Q98 29.5 98 45Q60 53.5 22 45Z" fill="#fff" opacity="0.26" />
      {refused ? (
        <Cross cx={60} cy={54} reach={11} width={6.4} />
      ) : (
        [39, 60, 81].map((x, index) => (
          <g key={x} className="otp-sms__dot" style={{ '--i': index }}>
            <circle cx={x} cy="55.4" r="6.8" fill="#0c7a33" opacity="0.35" />
            <circle cx={x} cy="54" r="6.8" fill="url(#otpi-sms-dot)" />
          </g>
        ))
      )}
    </>
  )
}

function MailArt({ refused }) {
  return (
    <>
      <defs>
        <linearGradient id="otpi-mail-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e2ea" />
        </linearGradient>
        <linearGradient id="otpi-mail-flap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eeeef4" />
        </linearGradient>
        <radialGradient id="otpi-mail-seal" cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ff7a45" />
          <stop offset="0.55" stopColor="#e02100" />
          <stop offset="1" stopColor="#a50000" />
        </radialGradient>
      </defs>
      <rect x="13" y="27" width="94" height="68" rx="14" fill="url(#otpi-mail-paper)" stroke="#c9c9d4" />
      <path d="M17.5 90.5L51 63.5M102.5 90.5L69 63.5" fill="none" stroke="#d6d6e0" strokeWidth="1.3" strokeLinecap="round" />
      <path
        className="otp-mail__flap"
        d="M14.6 34.2Q16.5 28 24 28H96Q103.5 28 105.4 34.2L65 62.6Q60 66 55 62.6Z"
        fill="url(#otpi-mail-flap)"
        stroke="#cdcdd8"
        strokeLinejoin="round"
      />
      {refused ? (
        // The seal, grown, a cross on it.
        <g className="otp-mail__seal">
          <circle cx="60" cy="62" r="16.5" fill="url(#otpi-mail-seal)" stroke="#8f0000" strokeOpacity="0.55" strokeWidth="0.8" />
          <Cross cx={60} cy={62} reach={6.2} width={4.4} />
        </g>
      ) : (
        <g className="otp-mail__seal">
          <circle cx="60" cy="62" r="12" fill="url(#otpi-mail-seal)" stroke="#8f0000" strokeOpacity="0.55" strokeWidth="0.8" />
          <circle cx="60" cy="62" r="6.4" fill="#c21300" stroke="#8f0000" strokeOpacity="0.45" strokeWidth="0.8" />
          <ellipse cx="57.5" cy="59.6" rx="3" ry="1.9" fill="#fff" opacity="0.35" transform="rotate(-28 57.5 59.6)" />
        </g>
      )}
    </>
  )
}

// Each art, and how wide its shadow lies on the ground.
const ARTS = {
  app: { Art: AppArt, shadow: 25 },
  sms: { Art: SmsArt, shadow: 34 },
  mail: { Art: MailArt, shadow: 38 },
}

function OtpMethodIcon({ method = 'app', state = 'idle', sent = false, beat = 0, className = '' }) {
  const { Art, shadow } = ARTS[method] ?? ARTS.app
  const refused = state === 'refused'

  return (
    <div
      className={`otp-icon ${className}`}
      data-method={method}
      data-state={state}
      // Two names for the same hop, taken in turn: a new one starts it over.
      data-beat={beat > 0 ? (beat % 2 ? 'a' : 'b') : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" focusable="false">
        <defs>
          <radialGradient id="otpi-shadow">
            <stop offset="0" stopColor="#000" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="otpi-badge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#74e89a" />
            <stop offset="1" stopColor="#0d9a45" />
          </linearGradient>
        </defs>
        <ellipse className="otp-icon__shadow" cx="60" cy="109" rx={shadow} ry="5.5" fill="url(#otpi-shadow)" />
        {/* On its way (sending): the lines it leaves behind. */}
        <path className="otp-icon__speed" d="M2 50H12M-2 62H9M3 74H12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <g className="otp-icon__state">
          <g className="otp-icon__art">
            <Art refused={refused} />
          </g>
        </g>
        {sent && !refused ? (
          <g className="otp-icon__badge">
            <circle cx="95" cy="93" r="13.5" fill="url(#otpi-badge)" stroke="var(--otp-icon-ground, #fff)" strokeWidth="2.5" />
            <path d="M88.6 93.4L93.3 98L101.6 88.4" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}
      </svg>
    </div>
  )
}

export default OtpMethodIcon
