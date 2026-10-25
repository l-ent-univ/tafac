import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { trackGradesAction } from '../analytics'
import { shadeHex } from '../colorContrast'
import { describeJuryDecision, formatJuryDate, hashNoticeText, readDismissedMessageHash, writeDismissedMessageHash } from '../gradesNotices'

// One notice under the "Mes notes" cards: an icon in a soft disc (or any
// `media`), a bold line with an optional `badge`, an optional text.
// `collapsible` folds a long text to three lines behind "Lire la suite";
// `onDismiss` adds a close button; `tint` washes the card in a colour;
// `onExpand` hears "Lire la suite" unfold it.
// On a phone both buttons reach 44px of touch area past their drawn size.
export function GradesNotice({ icon = null, media = null, tint = null, label, title, badge = null, children = null, collapsible = false, onDismiss = null, onExpand = null }) {
  const bodyId = useId()
  const bodyRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // Only offer "Lire la suite" when three lines don't hold the text (it
  // depends on the width, so it's measured, again on resize). Measured while
  // folded only: unfolded, the button stays to fold it back.
  useEffect(() => {
    const body = bodyRef.current
    if (!collapsible || expanded || !body || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => setOverflowing(body.scrollHeight - body.clientHeight > 1))
    observer.observe(body)
    return () => observer.disconnect()
  }, [collapsible, expanded, children])

  return (
    <div role="note" aria-label={label} className="grades-notice widget-card widget-card-visible relative isolate flex items-start gap-3 card-corners-sm border bg-widget-bg p-3 text-text shadow-md max-md:gap-2.5">
      {tint ? <span className="grades-notice-tint" style={{ backgroundColor: tint }} aria-hidden="true" /> : null}
      {media ?? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-text" aria-hidden="true">
          <Icon icon={icon} className="size-[18px]" />
        </span>
      )}
      <div className={`grid min-w-0 flex-1 justify-items-start gap-0.5 ${media ? 'pt-[3px]' : 'pt-[7px]'}`}>
        <p className="m-0 font-body text-[15px] font-semibold leading-[1.3] text-text [overflow-wrap:anywhere]">
          {title}
          {badge ? <span className="ml-2 inline-block rounded-full border border-border px-1.5 align-[1px] text-[11px] font-semibold leading-[16px] tracking-[0.04em] text-text-muted">{badge}</span> : null}
        </p>
        {children ? (
          // A text's lines become paragraphs; the three-line fold runs across them.
          <div
            ref={bodyRef}
            id={bodyId}
            className={`font-body text-[14px] font-medium leading-[1.45] text-text-secondary [overflow-wrap:anywhere] [&>p+p]:mt-1.5 ${collapsible && !expanded ? 'line-clamp-3' : ''}`}
          >
            {typeof children === 'string'
              ? children.split(/\n+/).map((paragraph, index) => <p key={index} className="m-0">{paragraph}</p>)
              : children}
          </div>
        ) : null}
        {collapsible && (overflowing || expanded) ? (
          <button
            type="button"
            onClick={() => {
              if (!expanded) onExpand?.()
              setExpanded(!expanded)
            }}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="-mx-1 mt-0.5 cursor-pointer corners-[6px] border-0 bg-transparent px-1 py-0.5 text-text underline decoration-text-30 underline-offset-[3px] transition-colors hover:decoration-text max-md:relative max-md:after:absolute max-md:after:-inset-x-2 max-md:after:-inset-y-2.5"
          >
            <span className="font-body text-[13px] font-semibold">{expanded ? 'Réduire' : 'Lire la suite'}</span>
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Masquer ce message"
          className="-mr-0.5 -mt-0.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text-muted transition-colors hover:bg-bg-subtle hover:text-text max-md:relative max-md:after:absolute max-md:after:-inset-1.5"
        >
          <Icon icon="carbon:close" className="size-[18px]" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

// The decision as a coin cut like the UE pieces (UeBadge): its colour, a
// 1px inner edge catching the light (plus-lighter), the same stacked
// shadows down and to the left in a dark shade of the colour, scaled to
// the coin. A soft light on the top left, an engraved rim and an embossed
// glyph give it its relief. Calm colours: green once validated, amber
// while waiting, a warm brown otherwise (never an alarm red), with a glyph
// that reads on them.
const COIN_TONES = {
  positive: { color: '#1E8A4C', ink: '#F0F0F0', relief: 'rgb(0 0 0 / 0.28)', icon: 'carbon:checkmark' },
  pending: { color: '#F5B400', ink: '#3D2D00', relief: 'rgb(255 255 255 / 0.45)', icon: 'carbon:hourglass' },
  neutral: { color: '#7A5A45', ink: '#F0F0F0', relief: 'rgb(0 0 0 / 0.28)', icon: 'carbon:education' },
}
const COIN_SHADOWS = [[-0.5, 0.5, 1, 0.36], [-2, 3, 2, 0.31], [-4.5, 6.5, 3, 0.18], [-8, 12, 3.5, 0.05]]

function JuryCoin({ tone }) {
  const id = useId().replace(/:/g, '')
  const { color, ink, relief, icon } = COIN_TONES[tone] ?? COIN_TONES.neutral
  const shade = shadeHex(color, 0.55)

  return (
    <span className="relative inline-flex size-[46px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 46 46" width="46" height="46" className="absolute inset-0 overflow-visible">
        <defs>
          <filter id={`${id}-shadow`} x="-80%" y="-40%" width="220%" height="220%" colorInterpolationFilters="sRGB">
            {COIN_SHADOWS.map(([dx, dy, blur, opacity], index) => (
              <Fragment key={index}>
                <feGaussianBlur in="SourceAlpha" stdDeviation={blur} />
                <feOffset dx={dx} dy={dy} result={`blur${index}`} />
                <feFlood floodColor={shade} floodOpacity={opacity} />
                <feComposite in2={`blur${index}`} operator="in" result={`shadow${index}`} />
              </Fragment>
            ))}
            <feMerge>
              {COIN_SHADOWS.map((_, index) => <feMergeNode key={index} in={`shadow${COIN_SHADOWS.length - 1 - index}`} />)}
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`${id}-edge`} x1="23" y1="1" x2="23" y2="45" gradientUnits="userSpaceOnUse">
            <stop stopColor="#515151" />
            <stop offset="1" stopColor="#000000" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <circle cx="23" cy="23" r="22" />
          </clipPath>
          <radialGradient id={`${id}-light`} cx="15" cy="11" r="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity="0.3" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-rim`} x1="23" y1="5" x2="23" y2="41" gradientUnits="userSpaceOnUse">
            <stop stopColor="#000000" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <g filter={`url(#${id}-shadow)`}>
          <circle cx="23" cy="23" r="22" fill={color} />
          <circle
            cx="23"
            cy="23"
            r="22"
            fill="none"
            stroke={`url(#${id}-edge)`}
            strokeWidth="2"
            clipPath={`url(#${id}-clip)`}
            style={{ mixBlendMode: 'plus-lighter' }}
          />
          <circle cx="23" cy="23" r="22" fill={`url(#${id}-light)`} />
          <circle cx="23" cy="23" r="17.25" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1.5" />
        </g>
      </svg>
      <Icon icon={icon} className="relative size-[22px]" style={{ color: ink, filter: `drop-shadow(0 1px 0 ${relief})` }} />
    </span>
  )
}

function JuryDecisionNotice({ decision }) {
  const when = formatJuryDate(decision.date)
  const scope = decision.scope === 'year' ? 'ton année' : 'ce semestre'
  const detail = `${decision.label ? 'Décision du jury pour' : 'Pour'} ${scope}${when ? `, le ${when}` : ''}`

  return (
    <GradesNotice
      media={<JuryCoin tone={decision.tone} />}
      tint={(COIN_TONES[decision.tone] ?? COIN_TONES.neutral).color}
      label="Décision du jury"
      title={decision.label ?? `Décision du jury : ${decision.code}`}
      badge={decision.label ? decision.code : null}
    >
      {detail}
    </GradesNotice>
  )
}

// The jury's decision notice is off for now (its codes and wording still
// to check against real decisions); flip to bring it back.
const SHOW_JURY_DECISION = false

// The notices of the semester shown: the jury's decision once it has
// ruled (when SHOW_JURY_DECISION), then the department's message. The
// message can be closed; it stays closed until its text changes.
function GradesNotices({ releve, departmentMessage }) {
  const decision = SHOW_JURY_DECISION ? describeJuryDecision(releve) : null
  const messageHash = departmentMessage ? hashNoticeText(departmentMessage) : null
  const [dismissedHash, setDismissedHash] = useState(readDismissedMessageHash)
  const showMessage = Boolean(messageHash) && messageHash !== dismissedHash

  const dismissMessage = () => {
    writeDismissedMessageHash(messageHash)
    setDismissedHash(messageHash)
  }

  if (!decision && !showMessage) return null

  return (
    <div className="grid gap-3 max-md:gap-2">
      {decision ? <JuryDecisionNotice decision={decision} /> : null}
      {showMessage ? (
        <GradesNotice icon="carbon:bullhorn" label="Message de ton département" title="Message de ton département" collapsible onDismiss={dismissMessage} onExpand={() => trackGradesAction('department_message_expanded')}>
          {departmentMessage}
        </GradesNotice>
      ) : null}
    </div>
  )
}

export default GradesNotices
