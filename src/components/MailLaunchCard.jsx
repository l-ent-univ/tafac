import { Icon } from '@iconify/react'
import LaunchCard from './LaunchCard'
import { accentStyle } from '../eventAccents'

// The « Nouveautés » entry this card launches (src/changelog.js, a
// `spotlight` one): see LaunchCard for when it shows.
const ENTRY_ID = 'messagerie'

// The stage's drawing, in the units of the other launch cards' (132 × 66,
// the floor at the bottom): three messages of a list, as the page's rows.
const WIDTH = 132
const HEIGHT = 66
const ROW_X = 10
const ROW_WIDTH = 112
const ROW_HEIGHT = 11
// Example messages, not the student's: the accents in their handing-out
// order, the first one unread.
const EXAMPLE_ROWS = [
  { top: 3, accent: 0, isUnread: true },
  { top: 17, accent: 2, isUnread: false },
  { top: 31, accent: 4, isUnread: false },
]

const x = (value) => `${(value / WIDTH) * 100}%`
const y = (value) => `${(value / HEIGHT) * 100}%`

// The stage: the message list, its rows sliding in one after the other from
// the right (an avatar, a sender line and a subject line), the first
// one's unread dot popping, then the « Messagerie » icon on the floor. All
// CSS (.mail-launch-* and .launch-card-* in overrides.css), the final
// frame as is with reduced motion.
function LaunchList() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      {EXAMPLE_ROWS.map((row, index) => (
        <span
          key={row.top}
          className="mail-launch-row absolute isolate flex items-center gap-[5px] overflow-hidden corners-[4px] border bg-widget-bg px-[5px] max-md:corners-[3px]"
          style={{
            left: x(ROW_X),
            width: x(ROW_WIDTH),
            top: y(row.top),
            height: y(ROW_HEIGHT),
            '--i': index,
            ...accentStyle(row.accent),
          }}
        >
          <span className="planning-accent-fill h-[6px] w-[6px] shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="mail-launch-line h-[2px] w-[46%] rounded-full" />
            <span className="mail-launch-line is-faint h-[2px] w-[72%] rounded-full" />
          </span>
          {row.isUnread ? <span className="mail-launch-unread h-[4px] w-[4px] shrink-0 rounded-full" /> : null}
        </span>
      ))}
    </div>
  )
}

// Launch card for the Messagerie (LaunchCard): a few messages of the list,
// the page's icon standing on the floor. `onOpen`: shows the mail page.
function MailLaunchCard({ onOpen }) {
  return (
    <LaunchCard
      entryId={ENTRY_ID}
      launch="mail"
      title="Tes mails dans l’appli"
      line="Lis, réponds et écris, avec pièces jointes, brouillons et signature"
      ctaLabel="Ouvrir la messagerie"
      closeLabel="Fermer l’annonce de la messagerie"
      onOpen={onOpen}
      stage={(
        <>
          <LaunchList />
          <span className="launch-card-hub absolute left-1/2 top-[71.2%] flex aspect-square w-[22.7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full" aria-hidden="true">
            <span className="launch-card-ripple absolute inset-0 rounded-full" />
            <Icon icon="carbon:email" className="h-[52%] w-[52%]" />
          </span>
        </>
      )}
    />
  )
}

export default MailLaunchCard
