import { Icon } from '@iconify/react'
import Tooltip from './Tooltip'

// A button in one of the toolbar's pills (.button-group, the app's joined
// buttons, as the Planning's); the composer's toolbar (MailComposer) is
// built of the same.
export const TOOLBAR_BUTTON_CLASSES = 'button-group-item group max-sm:w-9'

// The app's primary button (dark fill, as the composer's send): « Nouveau
// message » over the list (MailPage).
export const PRIMARY_COMPOSE_CLASSES = 'lent-button group inline-flex shrink-0 items-center justify-center gap-2 rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text'

function ToolbarButton({ label, icon, iconClassName = '', onClick, disabled = false, pressed, tooltipSide = 'bottom' }) {
  return (
    <button
      type="button"
      className={TOOLBAR_BUTTON_CLASSES}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {/* The icon gives when pressed, not the button: its tooltip would too. */}
      <Icon icon={icon} className={`size-[18px] shrink-0 ${iconClassName}`} aria-hidden="true" />
      {/* Desktop only: on a phone the bar is at the screen's foot. */}
      <Tooltip title={label} side={tooltipSide} className="max-4xl:hidden" />
    </button>
  )
}

// The reader's actions, grouped as Apple Mail's toolbar, each group a pill
// of the tab bar's glass (.mobile-tab-bar). Writing (`onReply`,
// `onReplyAll`, `onForward`) opens the composer (MailComposer). « Nouveau
// message » isn't about the mail open: it stays over the list (MailPage),
// so the bar fits a phone's width. `message`: the open
// one's { unread, flagged } (a selection's: unread when any is, flagged
// when all are), null while unknown (its actions then wait). `multiple`:
// several mails picked, nothing to reply to. `folderKind`: the folder shown
// (MailPage) — in the junk folder « Indésirable » takes them out of it; in
// the trash « Restaurer » puts them back in the inbox. In both, deleting is
// for good (`onDeleteForever`, after a confirmation), in red. `onMove(event)`
// opens the folder picker under its button (« Déplacer »). Three buttons in
// that group whatever the folder: on a 360 px phone the bar still fits once
// the buttons narrow to 36 px (max-sm). `onClose`: the side panel's own
// close button, at its far end (desktop only: a phone has its back button).
function MailToolbar({ message, multiple = false, folderKind = 'inbox', onReply, onReplyAll, onForward, onTrash, onSpam, onRestore, onDeleteForever, onMove, onToggleUnread, onToggleFlag, onClose = null, className = '' }) {
  const ready = Boolean(message)
  const deleteForever = { id: 'delete-forever', label: 'Supprimer définitivement', icon: 'ph:trash', iconClassName: 'text-[#d1342f] dark:text-[#ff6b63]', onClick: onDeleteForever, disabled: !ready }
  const move = { id: 'move', label: 'Déplacer', icon: 'ph:folder-open', onClick: onMove, disabled: !ready }
  const removeGroup = {
    trash: [
      { id: 'restore', label: 'Restaurer', icon: 'ph:arrow-u-up-left', onClick: onRestore, disabled: !ready },
      deleteForever,
      move,
    ],
    junk: [
      deleteForever,
      { id: 'junk', label: 'Pas indésirable', icon: 'ph:check-circle', onClick: onSpam, disabled: !ready },
      move,
    ],
  }[folderKind] ?? [
    { id: 'trash', label: 'Supprimer', icon: 'ph:trash', onClick: onTrash, disabled: !ready },
    { id: 'junk', label: 'Indésirable', icon: 'ph:prohibit', onClick: onSpam, disabled: !ready },
    move,
  ]
  const groups = [
    [
      { id: 'reply', label: 'Répondre', icon: 'ph:arrow-bend-up-left', onClick: onReply, disabled: multiple },
      { id: 'reply-all', label: 'Répondre à tous', icon: 'ph:arrow-bend-double-up-left', onClick: onReplyAll, disabled: multiple },
      { id: 'forward', label: 'Transférer', icon: 'ph:arrow-bend-up-left', iconClassName: '[transform:scaleX(-1)]', onClick: onForward, disabled: multiple },
    ],
    removeGroup,
    [
      {
        id: 'unread',
        label: message?.unread ? 'Marquer comme lu' : 'Marquer comme non lu',
        icon: message?.unread ? 'ph:envelope-simple' : 'ph:envelope-simple-open',
        onClick: onToggleUnread,
        disabled: !ready,
        pressed: Boolean(message?.unread),
      },
      {
        id: 'flag',
        label: message?.flagged ? 'Retirer le drapeau' : 'Ajouter un drapeau',
        icon: message?.flagged ? 'ph:flag-fill' : 'ph:flag',
        iconClassName: message?.flagged ? 'text-[#f0932b]' : '',
        onClick: onToggleFlag,
        disabled: !ready,
        pressed: Boolean(message?.flagged),
      },
    ],
  ]

  return (
    <div role="toolbar" aria-label="Actions du mail" className={`flex items-center gap-2 4xl:flex-wrap ${className}`}>
      {/* Keyed by place: a folder's own buttons swap in without a remount. */}
      {groups.map((group, index) => (
        <div key={index} className="pointer-events-auto button-group">
          {group.map((item) => (
            // The panel's first and last groups keep their bubble inside it.
            <ToolbarButton key={item.id} {...item} tooltipSide={index === 0 ? 'bottom-start' : index === groups.length - 1 ? 'bottom-end' : 'bottom'} />
          ))}
        </div>
      ))}
      {onClose ? (
        <div className="mail-toolbar-close pointer-events-auto button-group ml-auto">
          <ToolbarButton label="Fermer" icon="ph:x" onClick={onClose} tooltipSide="bottom-end" />
        </div>
      ) : null}
    </div>
  )
}

export default MailToolbar
