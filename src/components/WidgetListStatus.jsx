import { Icon } from '@iconify/react'

// Empty-state body of the list-style cards, centred in the room it's given.
// On the dashboard a failed load hides the card instead; on « Accueil »,
// whose grid keeps its cards, it shows here with `action`
// ({ label, onClick }: « Réessayer »).
function WidgetListStatus({ icon, title, body, action = null }) {
  return (
    <div className="flex-1 flex flex-col justify-center gap-1 min-w-0 min-h-0">
      <div className="flex items-center gap-[7px] min-w-0">
        <Icon icon={icon} className="w-[18px] h-[18px] shrink-0 opacity-70" aria-hidden="true" />
        <span className="m-0 min-w-0 leading-[1.1] text-base font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">{title}</span>
      </div>
      {body ? (
        <p className="m-0 text-sm leading-[1.35] opacity-70 overflow-hidden text-ellipsis whitespace-nowrap" title={body}>{body}</p>
      ) : null}
      {action ? (
        <button
          type="button"
          // Not the card's own click (the webmail, Moodle).
          onClick={(event) => {
            event.stopPropagation()
            action.onClick()
          }}
          className="mt-1 inline-flex shrink-0 cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-body text-[13px] font-semibold text-text-muted underline-offset-2 transition-colors duration-150 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        >
          <Icon icon="ph:arrows-clockwise" className="size-[14px] shrink-0" aria-hidden="true" />
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

export default WidgetListStatus
