import { Fragment } from 'react'
import { Icon } from '@iconify/react'
import Tooltip from './Tooltip'

// A button in one of the glass pills; the composer's toolbar
// (MailComposer) is built of the same.
export const TOOLBAR_BUTTON_CLASSES = 'mobile-tab-bar-item group relative inline-flex h-9 w-10 max-sm:w-9 items-center justify-center rounded-full border-0 bg-transparent text-text cursor-pointer transition-[background-color] duration-150 ease-out disabled:cursor-default disabled:opacity-45'

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
      <Icon icon={icon} className={`size-[18px] shrink-0 transition-transform duration-100 ease-out group-active:scale-[0.86] ${iconClassName}`} aria-hidden="true" />
      {/* Desktop only: on a phone the bar is at the screen's foot. */}
      <Tooltip title={label} side={tooltipSide} className="max-4xl:hidden" />
    </button>
  )
}

// The reader's actions, grouped as Apple Mail's toolbar, each group a pill
// of the tab bar's glass (.mobile-tab-bar). Writing (`onCompose`,
// `onReply`, `onReplyAll`, `onForward`) opens the composer (MailComposer),
// which can't send yet. On a phone, without
// « Nouveau message » (not about the mail open), it fits the screen's width. `message`: the open
// one's { unread, flagged } (a selection's: unread when any is, flagged
// when all are), null while unknown (its actions then wait). `multiple`:
// several mails picked, nothing to reply to. `folderKind`: the folder shown
// (MailPage) — in the junk folder « Indésirable » takes them out of it; in
// the trash « Restaurer » puts them back in the inbox. In both, deleting is
// for good (`onDeleteForever`, after a confirmation), in red. `onMove(event)`
// opens the folder picker under its button (« Déplacer »). Three buttons in
// that group whatever the folder: on a 360 px phone the bar still fits once
// the buttons narrow to 36 px (max-sm).
function MailToolbar({ message, multiple = false, folderKind = 'inbox', onCompose, onReply, onReplyAll, onForward, onTrash, onSpam, onRestore, onDeleteForever, onMove, onToggleUnread, onToggleFlag, className = '' }) {
  const ready = Boolean(message)
  const deleteForever = { id: 'delete-forever', label: 'Supprimer définitivement', icon: 'carbon:trash-can', iconClassName: 'text-[#d1342f] dark:text-[#ff6b63]', onClick: onDeleteForever, disabled: !ready }
  const move = { id: 'move', label: 'Déplacer', icon: 'carbon:folder-move-to', onClick: onMove, disabled: !ready }
  const removeGroup = {
    trash: [
      { id: 'restore', label: 'Restaurer', icon: 'carbon:undo', onClick: onRestore, disabled: !ready },
      deleteForever,
      move,
    ],
    junk: [
      deleteForever,
      { id: 'junk', label: 'Pas indésirable', icon: 'carbon:checkmark-outline', onClick: onSpam, disabled: !ready },
      move,
    ],
  }[folderKind] ?? [
    { id: 'trash', label: 'Supprimer', icon: 'carbon:trash-can', onClick: onTrash, disabled: !ready },
    { id: 'junk', label: 'Indésirable', icon: 'carbon:misuse-outline', onClick: onSpam, disabled: !ready },
    move,
  ]
  const groups = [
    [{ id: 'compose', label: 'Nouveau message', icon: 'carbon:edit', onClick: onCompose }],
    [
      { id: 'reply', label: 'Répondre', icon: 'carbon:reply', onClick: onReply, disabled: multiple },
      { id: 'reply-all', label: 'Répondre à tous', icon: 'carbon:reply-all', onClick: onReplyAll, disabled: multiple },
      { id: 'forward', label: 'Transférer', icon: 'carbon:reply', iconClassName: '[transform:scaleX(-1)]', onClick: onForward, disabled: multiple },
    ],
    removeGroup,
    [
      {
        id: 'unread',
        label: message?.unread ? 'Marquer comme lu' : 'Marquer comme non lu',
        icon: message?.unread ? 'carbon:email' : 'carbon:email-new',
        onClick: onToggleUnread,
        disabled: !ready,
        pressed: Boolean(message?.unread),
      },
      {
        id: 'flag',
        label: message?.flagged ? 'Retirer le drapeau' : 'Ajouter un drapeau',
        icon: message?.flagged ? 'carbon:flag-filled' : 'carbon:flag',
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
        <div key={index} className={`mobile-tab-bar pointer-events-auto flex items-center rounded-full p-[3px] ${index === 0 ? 'mr-auto max-4xl:hidden' : ''}`}>
          {group.map((item, itemIndex) => (
            <Fragment key={item.id}>
              {itemIndex > 0 ? <span className="mail-toolbar-divider mx-[1px] h-[18px] w-px shrink-0" aria-hidden="true" /> : null}
              {/* The panel's first and last groups keep their bubble inside it. */}
              <ToolbarButton {...item} tooltipSide={index === 0 ? 'bottom-start' : index === groups.length - 1 ? 'bottom-end' : 'bottom'} />
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

export default MailToolbar
