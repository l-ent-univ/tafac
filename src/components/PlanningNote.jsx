import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { useRef } from 'react'
import { trackPlanningAction } from '../analytics'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import LoadingDots from './LoadingDots'

// The planning service's name (planning.providerName), ADE by default.
const PROVIDER = universityConfig.planning?.providerName ?? 'ADE'
// Where else a student without a timetable there can look (planning.otherTimetables).
const OTHER_TIMETABLES = universityConfig.planning?.otherTimetables ?? []

// What a day without classes says, by its state (usePlanningWeeks'
// statusOn): its icon and title, and in full why and what to do about it.
const NOTES = {
  loaded: { icon: 'carbon:sun', title: 'Aucun cours' },
  loading: { icon: null, title: 'Chargement du planning…' },
  unavailable: {
    icon: 'carbon:cloud-offline',
    title: 'Planning indisponible',
    detail: `${PROVIDER} n’a pas répondu. Vérifie ta connexion, puis réessaie.`,
  },
  'no-timetable': {
    icon: 'carbon:calendar',
    title: 'Pas d’emploi du temps',
    detail: `${PROVIDER} n’a encore aucun cours pour toi cette année. Ton emploi du temps est peut-être ailleurs`,
  },
  unconfigured: {
    icon: 'carbon:events',
    title: 'Choisis ton groupe',
    detail: 'Indique ton groupe de TD/TP dans Mon compte pour voir ton planning.',
  },
}

// A planning's note (a day or a page without classes), in the planning's
// day pages and its list alike. In full, as the pages' empty states
// (PageEmptyState): the icon in a soft disc, the title, why, and the way
// out (Réessayer, Mon compte), announced as it changes. `compact`: a
// column's, beside days with classes, muted and on one line, its way out a
// small link; `stacked`, in a week's narrow column, the icon over the text.
// `text`: in place of the state's title. Without `onRetry` or
// `onOpenAccount`, no button.
function PlanningNote({ kind, text = null, compact = false, stacked = false, onRetry = null, onOpenAccount = null, className = '', style = undefined }) {
  const note = NOTES[kind] ?? NOTES.loading
  const rootRef = useRef(null)
  const title = text ?? note.title
  const icon = note.icon
    ? <Icon icon={note.icon} className={compact ? 'size-4 shrink-0' : 'size-[22px]'} aria-hidden="true" />
    : <LoadingDots label={null} className="shrink-0" />

  const retries = kind === 'unavailable' && Boolean(onRetry)
  const opensAccount = kind === 'unconfigured' && Boolean(onOpenAccount)
  const action = retries
    ? { label: 'Réessayer', icon: 'carbon:renew' }
    : opensAccount ? { label: compact ? 'Mon compte' : 'Ouvrir Mon compte', icon: 'carbon:user-avatar' } : null
  // Retrying swaps the button for the dots: the note keeps the focus, so
  // it isn't lost to the page.
  const handleAction = () => {
    trackPlanningAction(retries ? 'retry' : 'open_account')
    if (!retries) {
      onOpenAccount()
      return
    }
    rootRef.current?.focus({ preventScroll: true })
    onRetry()
  }

  if (compact) {
    return (
      <div ref={rootRef} className={`planning-note is-compact ${stacked ? 'is-stacked' : ''} ${className}`} style={style} tabIndex={-1}>
        <span className="planning-note-line">
          {icon}
          <span>{title}</span>
        </span>
        {action ? (
          <button type="button" className="planning-note-link" onClick={handleAction}>{action.label}</button>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`planning-note is-full ${className}`} style={style} role="status" tabIndex={-1}>
      <span className="planning-note-disc" aria-hidden="true">{icon}</span>
      <p className="m-0 font-body text-[17px] font-semibold leading-[1.2] text-text">{title}</p>
      {note.detail ? (
        <p className="m-0 max-w-[320px] font-body text-[15px] font-medium leading-[1.4] text-text-secondary">{note.detail}</p>
      ) : null}
      {action ? (
        <button type="button" className={`${SECONDARY_BUTTON} planning-note-action mt-1 cursor-pointer`} onClick={handleAction}>
          <Icon icon={action.icon} className="size-4 shrink-0" aria-hidden="true" />
          {action.label}
        </button>
      ) : null}
      {kind === 'no-timetable' && OTHER_TIMETABLES.length > 0 ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {OTHER_TIMETABLES.map((link) => (
            <a key={link.href} className={`${SECONDARY_BUTTON} planning-note-action no-underline`} href={link.href} target="_blank" rel="noopener noreferrer">
              <Icon icon="carbon:launch" className="size-4 shrink-0" aria-hidden="true" />
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default PlanningNote
