import { useEffect, useRef } from 'react'
import universityConfig from '@university'
import { copy, copyText, renderCopy } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'
import {
  ChartIcon,
  CheckIcon,
  CodeIcon,
  CookieIcon,
  CrossIcon,
  DatabaseIcon,
  EyeOffIcon,
  IdCardIcon,
  KeyIcon,
  LockIcon,
  PhoneIcon,
  RelayIcon,
  SearchIcon,
  UnlockedIcon,
  UniversityIcon,
} from './SecurityIcons'

const repoUrl = universityConfig.branding.about?.repoUrl

// PLACEHOLDER copy, for the landing page's mockup: to rewrite before launch
// (landingCopy.json, `security`). Every line says only what the code does (server/entAuthApp.js: the login
// route forwards the password and keeps the CAS session, never the password;
// server/sessionCookie.js: the session cookie is AES-256-GCM, HttpOnly, 30
// days at most; docs/ANALYTICS.md: the anonymous statistics). Check it again
// before changing a word.
//
// The diagram's stops, left to right (top to bottom on phones), each but the
// first after a wire and the tokens that travel on it (Wire). Each is a
// cartoon sticker (SecurityIcons), with badges on its corner, which come
// and go with the loop (overrides.css): on the device, the password typed,
// then the locked cookie; on Tafac, the padlock that closes on the session;
// on the university, the check.
// Each actor its colour, carried by what it sends: the device blue, Tafac
// amber (as the key it relays), the university violet (as the session card
// it opens); what's locked is green (--security-accent). On the stickers
// themselves, never a fill behind them.
const TONES = {
  blue: 'text-blue-600 dark:text-blue-300',
  amber: 'text-amber-600 dark:text-amber-300',
  violet: 'text-violet-600 dark:text-violet-300',
  rose: 'text-rose-600 dark:text-rose-300',
  green: 'text-[var(--security-accent)]',
}

const STOPS = [
  {
    id: 'device',
    icon: PhoneIcon,
    iconClassName: 'security-device-icon',
    tone: TONES.blue,
    badges: [
      { icon: KeyIcon, className: 'security-device-key' },
      { icon: CookieIcon, accent: true, className: 'security-device-cookie' },
    ],
    ...copy.security.stops.device,
  },
  {
    id: 'relay',
    icon: RelayIcon,
    iconClassName: 'security-relay-icon',
    tone: TONES.amber,
    badges: [
      { icon: UnlockedIcon, className: 'security-relay-open' },
      { icon: LockIcon, accent: true, className: 'security-relay-locked' },
    ],
    ...copy.security.stops.relay,
    wireTokens: [{ icon: KeyIcon, tone: TONES.amber, travel: 'security-travel-out-a', at: 0.1 }, { icon: LockIcon, tone: TONES.green, travel: 'security-travel-back-a', at: 0.61 }],
  },
  {
    id: 'university',
    icon: UniversityIcon,
    iconClassName: 'security-uni-icon',
    tone: TONES.violet,
    badges: [{ icon: CheckIcon, accent: true, className: 'security-uni-check' }],
    ...copy.security.stops.university,
    wireTokens: [{ icon: KeyIcon, tone: TONES.amber, travel: 'security-travel-out-b', at: 0.23 }, { icon: IdCardIcon, tone: TONES.violet, travel: 'security-travel-back-b', at: 0.46 }],
  },
]

const POINTS = [
  {
    kind: 'no-storage',
    icon: DatabaseIcon,
    tone: TONES.rose,
    badge: { icon: CrossIcon },
    ...copy.security.points.noStorage,
  },
  {
    kind: 'session',
    icon: CookieIcon,
    tone: TONES.green,
    badge: { icon: LockIcon, accent: true },
    ...copy.security.points.session,
  },
  {
    kind: 'stats',
    icon: ChartIcon,
    tone: TONES.blue,
    badge: { icon: EyeOffIcon },
    ...copy.security.points.stats,
  },
  repoUrl
    ? {
        kind: 'source',
        icon: CodeIcon,
        tone: TONES.violet,
        badge: { icon: SearchIcon, className: 'security-point-lens' },
        ...copy.security.points.source,
        link: { href: repoUrl, label: copy.security.points.source.link },
      }
    : null,
].filter(Boolean)

// The parts the intros put forward (**…** in landingCopy.json).
const ACCENT_CLASSES = 'font-semibold text-[var(--security-accent)]'

const CARD_CLASSES = 'border border-white bg-white shadow-[0_1px_3px_rgb(52_18_0/0.06),0_10px_28px_-14px_rgb(52_18_0/0.16)] dark:border-white/10 dark:bg-[#1c1c1c]'

// A round badge on an icon's corner, half outside it: green for what's
// locked or done (the page colour on it), otherwise a card. A ring of the
// card's colour (`ringClassName`) cuts it out of the icon's edge. `icon`:
// one of SecurityIcons, drawn thicker, so small.
function Badge({ icon, accent = false, className = '', ringClassName = '' }) {
  const BadgeIcon = icon
  return (
    <span className={`security-badge absolute inline-flex items-center justify-center rounded-full ${ringClassName} ${accent ? 'bg-[var(--security-accent)] text-bg' : 'bg-white text-text shadow-[0_1px_4px_rgb(52_18_0/0.16)] dark:bg-[#2a2a2a] dark:shadow-none'} ${className}`}>
      <BadgeIcon className="size-[62%]" strokeWidth={4.5} />
    </span>
  )
}

// Marks the element data-offscreen while it's off screen, so its looping
// animations pause there (overrides.css). Straight on the element: no render.
function usePauseOffscreen(ref) {
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      element.toggleAttribute('data-offscreen', !entry.isIntersecting)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
}

// A wire between two stops, with HTTPS under it: across on wide screens, as
// tall as a stop's tile, the dotted line through its middle and on to the
// tiles' edges; on narrow screens, where the stops are one under the other,
// down a column as wide as the tiles, HTTPS beside it. `tokens` travel
// along it, from one stop to the other (the key towards the university,
// the session back), each lighting the wire behind it as it goes (`at`: when
// it sets off, as a share of the loop). Geometry and motion in
// overrides.css (.security-wire).
function Wire({ tokens }) {
  return (
    <div className="security-wire" aria-hidden="true">
      <div className="security-wire-line text-text-30" />
      {tokens.map(({ tone, travel, at }) => (
        <div
          key={`${travel}-glow`}
          style={{ '--security-glow-at': at }}
          className={`security-wire-glow security-loop ${travel.includes('-out-') ? 'security-glow-out' : 'security-glow-back'} ${tone}`}
        />
      ))}
      {tokens.map(({ icon, tone, travel }) => {
        const TokenIcon = icon
        return (
          <div key={travel} className={`security-token security-loop ${travel}`}>
            <span className={`security-token-chip inline-flex size-9 items-center justify-center rounded-full ${CARD_CLASSES} ${tone}`}>
              <TokenIcon className="size-[22px]" strokeWidth={4} />
            </span>
          </div>
        )
      })}
      <span className="security-wire-label inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold leading-4 tracking-wide text-success-text font-body">
        <LockIcon className="size-3" strokeWidth={5} />
        HTTPS
      </span>
    </div>
  )
}

// The landing's security and privacy section, at the end of the page, in a
// rounded green-tinted block, laid out like Papillon's own: the title and
// what it means, the promises side by side as open columns (each its icon
// and badge, which come in once), then the password's part, "Votre mot de passe ne fait que passer", with
// the way it goes (the device, Tafac, the university) as a diagram that
// plays in a loop once on screen: the key travels to the university, which
// checks it, and the session comes back, padlocked by Tafac, to the device.
// The icons are the section's own stickers (SecurityIcons); all decorative
// (aria-hidden): every stop and point says it in words.
// `id` for a link to it (the header's "Confidentialité" still opens the
// privacy modal).
function SecurityShowcase({ className = '' }) {
  const diagramRef = useRef(null)
  const pointsRef = useRef(null)
  const isDiagramRevealed = useRevealOnce(diagramRef)
  const arePointsRevealed = useRevealOnce(pointsRef)
  usePauseOffscreen(diagramRef)

  return (
    <section
      id="confidentialite"
      className={`landing-security scroll-mt-8 flex justify-center px-6 max-md:px-4 ${className}`}
      aria-labelledby="confidentialite-title"
    >
      <div className="flex w-full max-w-[1240px] justify-center rounded-[40px] bg-[var(--security-surface)] px-12 py-20 max-lg:px-6 max-md:rounded-[28px] max-md:px-5 max-md:py-12">
        <div className="flex w-full max-w-[1080px] flex-col items-center text-center">
          <h2 id="confidentialite-title" className="m-0 max-w-[24ch] text-balance text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text">
            {copyText(copy.security.title)}
          </h2>
          <p className="m-0 mt-4 max-w-[64ch] text-balance text-[17px] leading-snug text-text-secondary font-body max-md:text-base">
            {renderCopy(copy.security.intro, { strongClassName: ACCENT_CLASSES })}
          </p>

          <ul
            ref={pointsRef}
            data-revealed={arePointsRevealed || undefined}
            className="security-points m-0 mt-14 grid w-full list-none grid-cols-4 gap-x-8 gap-y-12 p-0 max-4xl:grid-cols-2 max-md:mt-10 max-md:grid-cols-1 max-md:gap-y-10"
          >
            {POINTS.map(({ kind, icon, tone, badge, title, body, link }, index) => {
              const PointIcon = icon
              return (
                <li
                  key={kind}
                  style={{ '--reveal-index': index }}
                  className="security-point flex flex-col items-center gap-3"
                >
                  <span aria-hidden="true" className={`security-point-glyph relative mb-1 inline-flex size-14 shrink-0 items-center justify-center ${tone}`}>
                    <PointIcon className="security-point-icon size-10" strokeWidth={3.5} />
                    <Badge
                      {...badge}
                      className={`security-point-badge -bottom-0.5 -right-0.5 size-6 ${badge.className ?? ''}`}
                      ringClassName="ring-[3px] ring-[var(--security-surface)]"
                    />
                  </span>
                  <h3 className="m-0 max-w-[16ch] text-balance text-[20px] font-bold leading-tight text-text">{copyText(title)}</h3>
                  <p className="m-0 max-w-[30ch] text-balance text-[15px] leading-snug text-text-secondary font-body">{copyText(body)}</p>
                  {link ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold text-text underline decoration-text-30 underline-offset-[3px] transition-colors hover:decoration-text font-body">
                      {copyText(link.label)}
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <h3 id="mot-de-passe" className="m-0 mt-24 max-w-[24ch] scroll-mt-28 text-balance text-[clamp(26px,3vw,36px)] font-bold leading-[1.05] text-text max-md:mt-16">
            {copyText(copy.security.passwordTitle)}
          </h3>
          <p className="m-0 mt-4 max-w-[64ch] text-balance text-[17px] leading-snug text-text-secondary font-body max-md:text-base">
            {renderCopy(copy.security.passwordIntro, { strongClassName: ACCENT_CLASSES })}
          </p>

          <div
            ref={diagramRef}
            data-revealed={isDiagramRevealed || undefined}
            className="security-diagram mt-12 w-full max-lg:mt-8"
          >
            <ol className="m-0 flex list-none items-start p-0 max-lg:flex-col max-lg:items-stretch">
              {STOPS.map(({ id, icon, iconClassName = '', tone, badges, title, body, wireTokens }) => {
                const StopIcon = icon
                return (
                  <li key={id} className="contents">
                    {wireTokens ? <Wire tokens={wireTokens} /> : null}
                    <div className="relative z-10 flex w-[200px] shrink-0 flex-col items-center gap-4 max-4xl:w-[168px] max-lg:w-auto max-lg:flex-row max-lg:gap-4 max-lg:text-left">
                      <span aria-hidden="true" className={`relative inline-flex size-28 shrink-0 items-center justify-center max-lg:size-[76px] ${tone}`}>
                        {/* A ring that ripples out when something arrives. */}
                        <span className={`security-ripple security-loop security-ripple-${id}`} />
                        <span className={`inline-flex ${iconClassName}`}>
                          <StopIcon className="size-14 max-lg:size-9" />
                        </span>
                        {badges.map((badge) => (
                          <Badge
                            key={badge.className}
                            {...badge}
                            className={`security-loop bottom-1.5 right-1.5 size-8 max-lg:bottom-0.5 max-lg:right-0.5 max-lg:size-7 ${badge.className}`}
                            ringClassName="ring-4 ring-[var(--security-surface)] max-lg:ring-[3px]"
                          />
                        ))}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <h4 className="m-0 text-base font-bold leading-tight text-text">{copyText(title)}</h4>
                        <p className="m-0 text-balance text-sm leading-snug text-text-secondary font-body">{copyText(body)}</p>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          <p className="m-0 mt-14 max-w-[60ch] text-balance text-[13px] leading-snug text-text-secondary font-body">
            {copyText(copy.security.disclaimer)}
          </p>
        </div>
      </div>
    </section>
  )
}

export default SecurityShowcase
