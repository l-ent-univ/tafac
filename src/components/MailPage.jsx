import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { readHistoryNav, writeHistoryNav } from '../appHistory'
import { getMailFolders, getMailPrefs, getRecentMail, mailAction, mailFolderAction, onMailSessionExpired } from '../entApi'
import LoadingDots from './LoadingDots'
import { MailThread } from './MailReader'
import { fetchThread, loadMessage, prefetchMailThread, settledValue, threadCache, threadKey } from '../mailReadCache'
import MailToolbar from './MailToolbar'
import ContextMenu from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'
import SwipeableRow from './SwipeableRow'
import Tooltip from './Tooltip'
import { getSenderBadgeStyle, getSenderDomainCue, getSenderInitial } from './mailSender'
import PageEmptyState from './PageEmptyState'
import { useListTransitions } from '../useListTransitions'
import { foldMailSearchText, parseMailSearchWords } from '../mailSearch'
import {
  SHIMMER_CLASSES,
  formatReceivedAt,
  getSenderLabel,
  parseDate,
  readStoredHref,
  storeHref,
} from './widgetListUtils'

// The composer and its editor (Tiptap) load the first time one opens: most
// visits only read.
const MailComposer = lazy(() => import('./MailComposer'))

const MAIL_REFRESH_MS = 5 * 60 * 1000
// How often the folders' counts are looked at while the page is shown: a
// change in the shown folder's (a new mail) reloads its list.
const NEW_MAIL_CHECK_MS = 45 * 1000
// The refresh button turns at least this long, so a quick answer still shows.
const REFRESH_MIN_SPIN_MS = 600
// How far below the screen the end of the list starts loading the next page.
const LOAD_MORE_MARGIN = '600px 0px'
// Shared with the "Mails récents" card: the last webmail URL the server gave.
const WEBMAIL_HREF_KEY = 'l-ent:webmail-href'

const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// The reader beside the list (from 4xl) and its width: dragged from its
// left edge and stored for the device, else a share of the window.
const READER_BESIDE_QUERY = '(min-width: 1024px)'
const READER_PANEL_WIDTH = 'clamp(380px, 40vw, 640px)'
const READER_WIDTH_KEY = 'l-ent:mail-reader-width'
const MIN_READER_WIDTH = 360
const MAX_READER_WIDTH = 960
// Room the list keeps beside a dragged reader (its 24px gutters included).
const LIST_MIN_WIDTH = 440
const READER_RIGHT_PX = 12
const READER_KEYBOARD_STEP_PX = 16

const noop = () => {}
// How long the pointer rests on a row before its thread is fetched ahead.
const ROW_PREFETCH_DELAY_MS = 100
// The inbox's folder id, the page's first folder (Zimbra's, as every
// mailbox's: getMailFolders).
const INBOX_FOLDER = '2'
const FOLDER_LABELS = { inbox: 'Réception', sent: 'Envoyés', drafts: 'Brouillons', junk: 'Spam', trash: 'Corbeille' }
const FOLDER_ICONS = { inbox: 'carbon:email', sent: 'carbon:send-alt', drafts: 'carbon:document-blank', junk: 'carbon:misuse-outline', trash: 'carbon:trash-can' }

function getFolderLabel(folder) {
  return FOLDER_LABELS[folder.kind] ?? folder.name
}

// The server search's loading label, naming the folder searched (a
// folder the list doesn't know yet: neutral).
function getSearchingLabel(folderId, folders) {
  if (folderId === INBOX_FOLDER) return 'Recherche dans la boîte de réception'
  const folder = folders?.find((entry) => entry.id === folderId)
  return folder ? `Recherche dans ${getFolderLabel(folder)}` : 'Recherche…'
}

function getFolderIcon(folder) {
  if (FOLDER_ICONS[folder.kind]) return FOLDER_ICONS[folder.kind]
  return /archiv/i.test(folder.name) ? 'carbon:archive' : 'carbon:folder'
}

// Typing stops this long before the server searches the whole inbox.
const SEARCH_DELAY_MS = 300
// `resultsQuery`: the text `messages` answer. While the next text is asked
// (status 'loading'), the previous answer stays, for the list to keep its
// rows still matching instead of dropping them and bringing them back.
const IDLE_SEARCH = { query: '', folder: null, status: 'idle', messages: [], hasMore: false, nextOffset: 0, resultsQuery: '' }

// A mail the search's words are all in (sender, address, subject, preview),
// accents, case and apostrophe styles aside (foldMailSearchText: « etude »
// finds « Étude », « l'examen » finds « l’examen »).
function matchesSearch(message, words) {
  const text = foldMailSearchText([message.from?.name, message.from?.email, message.subject, message.snippet].join(' '))
  return words.every((word) => text.includes(word))
}

// The search's rows, newest first as the server sorts them, each once:
// `primary`'s copy of a mail wins (the server's, the fresher).
function mergeSearchRows(primary, extra) {
  const seen = new Set()
  return [...primary, ...extra]
    .filter((message) => {
      const key = getMessageKey(message)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => String(right.receivedAt ?? '').localeCompare(String(left.receivedAt ?? '')))
}
// Rows without an id (none from Zimbra) by their date and subject.
const getMessageKey = (message) => message.id ?? `${message.receivedAt}-${message.subject}`
// How long the « Mail supprimé · Annuler » notice stays.
const TOAST_MS = 6000
// A mail the page opened by itself (the next one, beside the list, after
// the open one was deleted or put in the junk) counts as read only once it
// has been shown this long: going through a run of deletions leaves the
// ones in between unread, while a mail actually looked at is marked. One the
// student opens (a click, the keyboard, Back or Forward) follows the
// webmail's own setting (zimbraPrefMarkMsgRead, getMailPrefs): at once, after
// N seconds, or never; an auto-opened one waits the longer of the two, and
// « never » holds for both.
const AUTO_OPENED_READ_DELAY_MS = 2000

function readStoredReaderWidth() {
  try {
    const value = Number(JSON.parse(localStorage.getItem(READER_WIDTH_KEY) || 'null')?.value)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function storeReaderWidth(width) {
  try {
    if (width == null) localStorage.removeItem(READER_WIDTH_KEY)
    else localStorage.setItem(READER_WIDTH_KEY, JSON.stringify({ value: width }))
  } catch {
    // Storage unavailable
  }
}

// The widest the reader gets in this window: the list keeps its room.
function maxReaderWidth() {
  const sidebarWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0
  return Math.max(MIN_READER_WIDTH, Math.min(MAX_READER_WIDTH, window.innerWidth - sidebarWidth - LIST_MIN_WIDTH))
}

function clampReaderWidth(width) {
  return Math.round(Math.min(maxReaderWidth(), Math.max(MIN_READER_WIDTH, width)))
}

// The CSS width: a dragged one still gives way to the list in a narrower
// window (as clampReaderWidth does under the pointer).
function readerWidthCss(width) {
  if (width == null) return READER_PANEL_WIDTH
  return `clamp(${MIN_READER_WIDTH}px, min(${width}px, 100vw - var(--sidebar-width, 280px) - ${LIST_MIN_WIDTH}px), ${MAX_READER_WIDTH}px)`
}

// Thin strip on the reader panel's left edge, as the sidebar's on its right
// (Sidebar's SidebarResizeHandle): drag to resize, double-click for the
// default width, or the arrow keys. Stored on release.
function MailReaderResizeHandle({ width, onWidthChange, onResizingChange }) {
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])
  // Closed mid-drag (Escape): the page's resize cursor goes with it.
  useEffect(() => {
    if (!isDragging) return undefined
    return () => {
      document.documentElement.classList.remove('sidebar-resizing')
      onResizingChange(false)
    }
  }, [isDragging, onResizingChange])

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsDragging(true)
    onResizingChange(true)
    document.documentElement.classList.add('sidebar-resizing')
  }

  const handlePointerMove = (event) => {
    if (!isDragging) return
    const next = clampReaderWidth(window.innerWidth - READER_RIGHT_PX - event.clientX)
    widthRef.current = next
    onWidthChange(next)
  }

  const endDragging = (event) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsDragging(false)
    onResizingChange(false)
    document.documentElement.classList.remove('sidebar-resizing')
    onWidthChange(widthRef.current, { persist: true })
  }

  // The panel's measured width when none is stored (a share of the window).
  const currentWidth = (target) => widthRef.current ?? target.closest('section')?.querySelector('.mail-reader-panel')?.getBoundingClientRect().width ?? MIN_READER_WIDTH

  const handleKeyDown = (event) => {
    const step = { ArrowLeft: READER_KEYBOARD_STEP_PX, ArrowRight: -READER_KEYBOARD_STEP_PX }[event.key]
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onWidthChange(event.key === 'Home' ? MIN_READER_WIDTH : maxReaderWidth(), { persist: true })
      return
    }
    if (!step) return
    event.preventDefault()
    onWidthChange(clampReaderWidth(currentWidth(event.currentTarget) + step), { persist: true })
  }

  return (
    <div
      className="group hidden 4xl:block fixed top-6 bottom-6 z-30 w-3 translate-x-1/2"
      style={{ right: `calc(${READER_RIGHT_PX}px + var(--mail-reader-width))` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur du mail"
        aria-valuemin={MIN_READER_WIDTH}
        aria-valuemax={MAX_READER_WIDTH}
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        title="Glisser pour redimensionner, double-clic pour rétablir"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDragging}
        onPointerCancel={endDragging}
        onDoubleClick={() => onWidthChange(null, { persist: true })}
        onKeyDown={handleKeyDown}
        className="flex h-full w-full justify-center cursor-col-resize touch-none outline-none"
      >
        <span
          aria-hidden="true"
          className={`sidebar-handle-tint h-full w-[3px] rounded-full transition-opacity duration-150 ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}
        />
      </div>
    </div>
  )
}

// A plain list: no card, a hairline under each row but the last.
const ROW_CLASSES = 'min-w-0 border-b border-border last:border-b-0'
const ITEM_CLASSES = 'mail-list-item flex flex-col gap-[3px] min-w-0 py-3'

// `more` after `list`, minus the messages already in it (a mail arriving
// between two pages shifts the offsets by one).
function appendMessages(list, more) {
  const ids = new Set(list.map((message) => message.id))
  return [...list, ...more.filter((message) => !ids.has(message.id))]
}

// The notice after an action, fixed at the screen's foot over the list's
// column (between the sidebar and, when open, the reader's panel; above the
// tab bar on a phone, and the reader's toolbar when a mail is open), with
// its « Annuler » when the action can be undone: a stroke goes round that
// button as the time to undo runs out (paused under the pointer), and the
// notice closes once it has (`onExpire`). It rises in and sinks out
// (.mail-toast-in, .mail-toast-out): the last one is kept while it leaves.
function MailToast({ toast, onExpire, readerOpen }) {
  const [shown, setShown] = useState(toast)
  if (toast && toast !== shown) setShown(toast)
  const leaving = !toast && Boolean(shown)

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 bottom-6 4xl:left-[calc(var(--sidebar-width,280px)+12px)] ${readerOpen ? '4xl:right-[calc(var(--mail-reader-width)+24px)] max-4xl:bottom-[calc(env(safe-area-inset-bottom)+148px)]' : 'max-4xl:bottom-[calc(env(safe-area-inset-bottom)+96px)]'}`}
      role="status"
    >
      {shown ? (
        <div
          key={shown.key}
          className={`mail-toast ${leaving ? 'mail-toast-out' : 'mail-toast-in'} pointer-events-auto select-none flex max-w-full items-center gap-3 rounded-full bg-black py-1.5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:bg-white dark:text-black ${shown.onUndo ? 'pl-4 pr-1.5' : 'px-4 min-h-[39px]'}`}
          inert={leaving || undefined}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && leaving) setShown(null)
          }}
        >
          <span className="text-[13px] font-medium leading-tight whitespace-nowrap">{shown.text}</span>
          {shown.onUndo ? (
            <button
              type="button"
              className="relative inline-flex h-7 shrink-0 items-center rounded-full border-0 bg-white/15 px-3 text-inherit cursor-pointer transition-[background-color] duration-120 hover:bg-white/25 dark:bg-black/10 dark:hover:bg-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white dark:focus-visible:outline-black"
              onClick={shown.onUndo}
            >
              <span className="text-[13px] font-semibold leading-none">Annuler</span>
              <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
                <rect
                  className="mail-toast-ring fill-none stroke-white dark:stroke-black"
                  pathLength="1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  style={{ '--toast-duration': `${TOAST_MS}ms` }}
                  onAnimationEnd={(event) => {
                    event.stopPropagation()
                    onExpire()
                  }}
                />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// « Se reconnecter »: App signs the student out and opens its login page,
// the one way back to a webmail session (the server's CAS sign-in is what
// expired, or the app's own session).
function SignInAgainButton({ onClick }) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center px-3 py-2 border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text cursor-pointer transition-[background-color] duration-120 ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text"
      onClick={onClick}
    >
      {/* On a span: index.css gives buttons the inherited font. */}
      <span className="text-[13px] font-semibold leading-none">Se reconnecter</span>
    </button>
  )
}

// Over a list already loaded when the session has expired meanwhile: that
// list stays to be read, the notice says why nothing more will load (rather
// than « Mails indisponibles », which reads as an outage).
function MailSessionNotice({ onSignInAgain, className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-[14px] bg-bg-subtle px-4 py-3 ${className}`} role="status">
      <Icon icon="carbon:locked" className="size-[18px] shrink-0 text-text-muted" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="m-0 text-[14px] font-semibold leading-tight text-text">Session expirée</p>
        <p className="m-0 text-[13px] font-medium leading-snug text-text-muted">Reconnecte-toi pour retrouver tes mails</p>
      </div>
      {onSignInAgain ? <SignInAgainButton onClick={onSignInAgain} /> : null}
    </div>
  )
}

// The pills are the system folders at the top of the tree (Réception,
// Envoyés…). Everything else — the student's own folders, the sub-folders a
// filter made in the inbox (« Réception / Moodle ») — is in the last pill's
// « Dossiers » menu, so a big tree doesn't flood the row.
function isPillFolder(folder) {
  return folder.kind !== 'folder' && !folder.parentId
}

// The top-level folder a folder sits under (itself at the top): its kind
// says whether its unread mails call for reading, and where mail can be
// moved.
function getFolderRoot(folder, byId) {
  let current = folder
  for (let step = 0; current?.parentId && byId.has(current.parentId) && step < 16; step += 1) current = byId.get(current.parentId)
  return current
}

// A folder's place in the tree, for its tooltip: « Réception / Moodle / L2 ».
function getFolderPath(folder, folders) {
  const byId = new Map(folders.map((entry) => [entry.id, entry]))
  const names = []
  let current = folder
  for (let step = 0; current && step < 16; step += 1) {
    names.unshift(getFolderLabel(current))
    current = current.parentId ? byId.get(current.parentId) : null
  }
  return names.join(' / ')
}

// Unread mails in Envoyés, Brouillons or the Corbeille (or a folder under
// them) don't call for reading: no dot for them.
const QUIET_FOLDER_KINDS = new Set(['sent', 'drafts', 'trash'])
function isQuietFolder(folder, byId) {
  return QUIET_FOLDER_KINDS.has(getFolderRoot(folder, byId)?.kind)
}

// The « Dossiers » menu's tree: the student's folders, and a system folder
// only as the parent of some (Réception above its Moodle). Parents come
// before their children (the server's order), indented by `depth`.
function getMenuFolders(folders) {
  const parents = new Set(folders.map((folder) => folder.parentId).filter(Boolean))
  return folders.filter((folder) => !isPillFolder(folder) || parents.has(folder.id))
}

// Where « Déplacer » can file mail: the tree but for Brouillons, the junk
// folder and the Corbeille and what's under them (each has its own action:
// Indésirable, Supprimer).
const NO_MOVE_FOLDER_KINDS = new Set(['drafts', 'junk', 'trash'])
function getMoveTargetFolders(folders) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  return folders.filter((folder) => !NO_MOVE_FOLDER_KINDS.has(getFolderRoot(folder, byId)?.kind))
}

// A long press on a touch screen stands for the right click (as on the
// list's rows, SwipeableRow), opening a pill's menu; the click that follows
// the press is dropped. One press at a time: the state is shared.
const PILL_LONG_PRESS_MS = 500
const PILL_LONG_PRESS_SLOP_PX = 8

function usePillLongPress(onLongPress) {
  const pressRef = useRef(null)
  // The latest callback, for a timer started a render earlier.
  const onLongPressRef = useRef(onLongPress)
  useEffect(() => {
    onLongPressRef.current = onLongPress
  }, [onLongPress])
  useEffect(() => () => window.clearTimeout(pressRef.current?.timer), [])
  return (key) => ({
    onPointerDown: (event) => {
      window.clearTimeout(pressRef.current?.timer)
      if (event.pointerType === 'mouse') {
        pressRef.current = null
        return
      }
      const press = { key, x: event.clientX, y: event.clientY, fired: false, timer: null }
      press.timer = window.setTimeout(() => {
        press.fired = true
        onLongPressRef.current?.(key, { clientX: press.x, clientY: press.y })
      }, PILL_LONG_PRESS_MS)
      pressRef.current = press
    },
    onPointerMove: (event) => {
      const press = pressRef.current
      if (press && !press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PILL_LONG_PRESS_SLOP_PX) {
        window.clearTimeout(press.timer)
        pressRef.current = null
      }
    },
    onPointerUp: () => window.clearTimeout(pressRef.current?.timer),
    onPointerCancel: () => window.clearTimeout(pressRef.current?.timer),
    // Whether the click after a press is the press's own (then dropped).
    consumeClick: () => {
      const fired = pressRef.current?.key === key && pressRef.current.fired
      if (fired) pressRef.current = null
      return fired
    },
    // Android opens the context menu on a long press too: the press has
    // already opened the pill's.
    pressFired: () => pressRef.current?.key === key && pressRef.current.fired,
  })
}

const PILL_CLASSES = 'mail-folder-pill group relative inline-flex h-10 min-w-0 basis-0 select-none items-center justify-center gap-2 rounded-full border-0 px-3 cursor-pointer [-webkit-touch-callout:none] transition-[flex-grow,background-color,color] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text max-md:basis-11 max-md:px-0'

// The mailbox's folders as Apple Mail's category pills: each an icon, the
// one shown a dark pill wider than the others with its name (they ease
// between the two). On a phone the others keep 44px and it takes the rest,
// so its name fits however many folders there are. A dot on a folder holding unread mails (not Envoyés,
// Brouillons or Corbeille, whose unread ones don't call for reading).
// The last pill, « Dossiers » (when the student has folders of their own or
// sub-folders), opens the tree's menu (`onOpenMenu(rect)`, under the pill);
// while one of those folders is shown, it's the dark pill, with that
// folder's name and its path as a tooltip, and its dot is any of them
// holding unread mails. A right click or a long press on a pill opens that
// folder's menu (`onFolderMenu(id, point)`: « Tout marquer comme lu »…; on
// « Dossiers », the shown folder's if it's one of the menu's, else the menu).
function MailFolderPills({ folders, currentId, currentUnread, onSelect, onOpenMenu, onFolderMenu }) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pills = folders.filter(isPillFolder)
  const menuFolders = folders.filter((folder) => !isPillFolder(folder))
  const unreadOf = (folder) => (folder.id === currentId && currentUnread != null ? currentUnread : folder.unread)
  const currentMenuFolder = menuFolders.find((folder) => folder.id === currentId) ?? null
  const menuUnread = menuFolders.some((folder) => folder.kind === 'folder' && unreadOf(folder) > 0 && !isQuietFolder(folder, byId))
  const longPress = usePillLongPress((key, point) => {
    if (key === '__folders') {
      if (currentMenuFolder) onFolderMenu?.(currentMenuFolder.id, point)
      else onOpenMenu?.({ left: point.clientX, top: point.clientY, bottom: point.clientY })
      return
    }
    onFolderMenu?.(key, point)
  })

  const pillProps = (key, onClick) => {
    const press = longPress(key)
    return {
      onPointerDown: press.onPointerDown,
      onPointerMove: press.onPointerMove,
      onPointerUp: press.onPointerUp,
      onPointerCancel: press.onPointerCancel,
      onClick: (event) => {
        if (press.consumeClick()) return
        onClick(event)
      },
      onContextMenu: (event) => {
        event.preventDefault()
        if (press.pressFired()) return
        if (key === '__folders') {
          if (currentMenuFolder) onFolderMenu?.(currentMenuFolder.id, event)
          else onOpenMenu?.(event.currentTarget.getBoundingClientRect())
          return
        }
        onFolderMenu?.(key, event)
      },
    }
  }

  const currentFolderLabel = currentMenuFolder ? getFolderLabel(currentMenuFolder) : 'Dossiers'
  const currentFolderUnread = currentMenuFolder ? unreadOf(currentMenuFolder) : 0

  return (
    <nav className="relative flex min-w-0 items-center gap-1" aria-label="Dossiers">
      {pills.map((folder) => {
        const current = folder.id === currentId
        const label = getFolderLabel(folder)
        const unread = unreadOf(folder)
        const dot = unread > 0 && !QUIET_FOLDER_KINDS.has(folder.kind)
        return (
          <button
            key={folder.id}
            type="button"
            className={`${PILL_CLASSES} ${current ? 'grow-[2.6] bg-text text-bg max-md:grow max-md:px-4' : 'grow bg-transparent text-text-muted hover:bg-bg-muted max-md:grow-0'}`}
            aria-current={current || undefined}
            aria-label={unread > 0 && dot ? `${label}, ${unread} non lu${unread > 1 ? 's' : ''}` : label}
            {...pillProps(folder.id, () => onSelect(folder.id))}
          >
            <span className="relative inline-flex shrink-0">
              <Icon icon={getFolderIcon(folder)} className="size-[18px]" aria-hidden="true" />
              {dot ? <span className={`mail-unread-dot absolute -right-[3px] -top-[2px] size-[7px] rounded-full ${current ? 'ring-2 ring-text' : ''}`} aria-hidden="true" /> : null}
            </span>
            <span
              className={`min-w-0 overflow-hidden whitespace-nowrap text-ellipsis transition-[max-width,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${current ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0'}`}
              aria-hidden="true"
            >
              <span className="text-[14px] font-semibold leading-none">{label}</span>
            </span>
            {current ? null : <Tooltip title={label} side="bottom" className="max-4xl:hidden" />}
          </button>
        )
      })}
      {menuFolders.length ? (
        <button
          type="button"
          className={`${PILL_CLASSES} ${currentMenuFolder ? 'grow-[2.6] bg-text text-bg max-md:grow max-md:px-4' : 'grow bg-transparent text-text-muted hover:bg-bg-muted max-md:grow-0'}`}
          aria-current={currentMenuFolder ? true : undefined}
          aria-haspopup="menu"
          aria-label={currentMenuFolder
            ? `${currentFolderLabel}${currentFolderUnread > 0 && !isQuietFolder(currentMenuFolder, byId) ? `, ${currentFolderUnread} non lu${currentFolderUnread > 1 ? 's' : ''}` : ''}, autres dossiers`
            : `Dossiers${menuUnread ? ', non lus' : ''}`}
          {...pillProps('__folders', (event) => onOpenMenu?.(event.currentTarget.getBoundingClientRect()))}
        >
          <span className="relative inline-flex shrink-0">
            <Icon icon={currentMenuFolder ? getFolderIcon(currentMenuFolder) : 'carbon:folder'} className="size-[18px]" aria-hidden="true" />
            {menuUnread ? <span className={`mail-unread-dot absolute -right-[3px] -top-[2px] size-[7px] rounded-full ${currentMenuFolder ? 'ring-2 ring-text' : ''}`} aria-hidden="true" /> : null}
          </span>
          <span
            className={`min-w-0 overflow-hidden whitespace-nowrap text-ellipsis transition-[max-width,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${currentMenuFolder ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0'}`}
            aria-hidden="true"
          >
            <span className="text-[14px] font-semibold leading-none">{currentFolderLabel}</span>
          </span>
          <Icon icon="carbon:chevron-down" className="size-[12px] shrink-0 -ml-1 max-md:hidden" aria-hidden="true" />
          <Tooltip title={currentMenuFolder ? getFolderPath(currentMenuFolder, folders) : 'Dossiers'} side="bottom-end" className="max-4xl:hidden" />
        </button>
      ) : null}
    </nav>
  )
}

// The search over the list, of the reader toolbar's glass and height (the
// two line up from 4xl). Escape empties it.
function MailSearchField({ value, onChange, className = '' }) {
  return (
    <div className={`mobile-tab-bar flex h-11 min-w-0 items-center gap-2 rounded-full pl-4 pr-[5px] text-[15px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text/20 ${className}`}>
      <Icon icon="carbon:search" className="size-[17px] shrink-0 text-text-muted" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            onChange('')
          }
        }}
        placeholder="Rechercher"
        aria-label="Rechercher dans les mails"
        className="mail-search-input h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-text placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          className="mobile-tab-bar-item inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text-muted cursor-pointer"
          aria-label="Effacer la recherche"
          onClick={() => onChange('')}
        >
          <Icon icon="carbon:close" className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

// The panel while several mails are picked: how many, as a small stack of
// envelopes, and the way out (Escape works too). The toolbar above acts on
// them all.
function MailSelection({ count, onClear }) {
  return (
    <div className="mail-reader-enter grid justify-items-center gap-4 px-4 pt-16 pb-10 text-center">
      <span className="relative inline-flex size-16 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rotate-[-8deg] rounded-[16px] border border-border bg-bg-subtle" />
        <span className="absolute inset-0 rotate-[5deg] rounded-[16px] border border-border bg-bg-muted" />
        <span className="material relative inline-flex size-16 items-center justify-center rounded-[16px]">
          <Icon icon="carbon:email" className="size-7 text-text-muted" />
        </span>
      </span>
      <p className="m-0 text-[17px] font-semibold leading-tight text-text" role="status">{count} mails sélectionnés</p>
      <button type="button" className="material inline-flex h-9 items-center rounded-full px-4 cursor-pointer" onClick={onClear}>
        <span className="text-[13px] font-semibold leading-none text-text">Désélectionner</span>
      </button>
    </div>
  )
}

function MailListPlaceholder() {
  return (
    <ul className="mail-skeleton-delayed m-0 p-0 list-none grid" role="status" aria-label="Chargement des mails">
      {['w-[34%]', 'w-[26%]', 'w-[40%]', 'w-[30%]'].map((senderWidth) => (
        <li key={senderWidth} className={`${ROW_CLASSES} ${ITEM_CLASSES}`} aria-hidden="true">
          <span className="flex items-center gap-2 h-6">
            <span className={`text-placeholder-shimmer size-6 rounded-[6px] ${SHIMMER_CLASSES}`} />
            <span className={`text-placeholder-shimmer h-2.5 rounded-full ${senderWidth} ${SHIMMER_CLASSES}`} />
          </span>
          <span className={`text-placeholder-shimmer mt-1 h-2.5 w-[58%] rounded-full ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer mt-1 h-2 w-[86%] rounded-full ${SHIMMER_CLASSES}`} />
        </li>
      ))}
    </ul>
  )
}

// One message, after the Ping list item: sender badge, name, address and
// time; the subject with the unread dot; two lines of preview.
// `transition`: the row coming in, going or staying (useListTransitions),
// `onSettled` once it has come in or gone. `onOpen(id, event)`: a click, its
// modifier keys making a selection (MailPage); `onContextMenu(id, event)`:
// a right click. `joinTop`, `joinBottom`: the row above or below is selected
// too, the highlight running on into it (no corners, no line between).
// `showRecipient`: a sent mail or a draft, shown by who it's for.
// `onHover(id)` / `onHover(null)`: the pointer on the row and off it (its
// thread preloaded, MailPage). `swipeActions`: { leading, trailing }, the
// actions a finger swipes out (SwipeableRow); a long press opens the
// right-click menu.
function MailListItem({ message, fallbackHref, now, onOpen, onContextMenu, onHover, swipeActions = null, showRecipient = false, selected = false, joinTop = false, joinBottom = false, transition = 'present', onSettled }) {
  const href = message.href || fallbackHref
  const person = showRecipient && message.to ? message.to : message.from
  const sender = showRecipient && message.to ? `À ${getSenderLabel(person)}` : getSenderLabel(person)
  const email = person?.email?.trim() || null
  // A sender outside the university's domains: their domain after the name
  // (mailSender.js), so a name borrowed from the university stands out.
  // Not for a sent mail's recipient, who the student wrote to.
  const senderDomain = showRecipient ? null : getSenderDomainCue(person)
  const subject = message.subject?.trim() || '(Sans objet)'
  const snippet = message.snippet?.trim() || ''
  const receivedAt = parseDate(message.receivedAt)
  const timeLabel = formatReceivedAt(receivedAt, now)
  const unread = Boolean(message.unread)
  const ariaLabel = `${unread ? 'Non lu, ' : ''}${sender}${senderDomain ? ` ${senderDomain}` : ''} : ${subject}${timeLabel ? `, ${timeLabel}` : ''}`
  const badgeStyle = getSenderBadgeStyle((email || sender).toLowerCase())

  const content = (
    <>
      <span className="flex items-center justify-between gap-3 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[13px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
            style={badgeStyle ?? undefined}
            aria-hidden="true"
          >
            {getSenderInitial(getSenderLabel(person))}
          </span>
          <span className={`min-w-0 truncate text-[13px] leading-[1.3] font-semibold ${unread ? 'text-text-70' : 'text-text-muted'}`}>{sender}</span>
          {senderDomain ? (
            <span className="-ml-[3px] max-w-[55%] shrink-0 truncate text-[12px] leading-[1.3] font-medium text-text-muted" aria-hidden="true">{senderDomain}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-[6px]">
          {message.flagged ? <Icon icon="carbon:flag-filled" className="size-3 text-[#f0932b]" aria-label="Drapeau" /> : null}
          <span className={`text-[12px] leading-none tabular-nums font-medium ${unread ? 'text-text-70' : 'text-text-muted'}`}>{timeLabel}</span>
        </span>
      </span>
      <span className="flex items-center gap-[7px] min-w-0">
        <span className={`min-w-0 truncate text-[14px] leading-[1.3] ${unread ? 'font-semibold text-text' : 'font-medium text-text-70'}`}>{subject}</span>
        {/* A thread's size, as Apple Mail's. */}
        {message.count > 1 ? (
          <span className="shrink-0 rounded-full bg-bg-muted px-[6px] text-[11.5px] font-semibold leading-[17px] text-text-muted tabular-nums" aria-label={`${message.count} mails`}>{message.count}</span>
        ) : null}
        {unread ? <span className="mail-unread-dot size-[6px] shrink-0 rounded-full" aria-hidden="true" /> : null}
      </span>
      {snippet ? (
        <span className="line-clamp-2 break-words text-[13px] leading-[1.4] font-normal text-text-muted">{snippet}</span>
      ) : null}
    </>
  )

  const row = {
    className: `${ROW_CLASSES} ${transition === 'enter' ? 'mail-row-enter' : transition === 'exit' ? 'mail-row-exit' : ''}`,
    inert: transition === 'exit' || undefined,
    onAnimationEnd: transition === 'present'
      ? undefined
      : (event) => {
          if (event.target === event.currentTarget) onSettled?.()
        },
  }

  // A message with an id opens in the reader (MailReader), the others in
  // the webmail.
  if (onOpen && message.id) {
    return (
      <li {...row}>
        {/* Swiped with a finger for its actions (`swipeActions`: { leading,
            trailing }), held for its menu: iOS has no right click. The
            hover tint bleeds into the page's side padding, as far as the
            swipe's room. */}
        <SwipeableRow
          className="-mx-3"
          leading={swipeActions?.leading}
          trailing={swipeActions?.trailing}
          exiting={transition === 'exit'}
          onLongPress={onContextMenu ? (point) => onContextMenu(message.id, { ...point, preventDefault() {} }) : undefined}
        >
        <button
          type="button"
          className={`${ITEM_CLASSES} w-full px-3 rounded-[10px] ${joinTop ? 'rounded-t-none' : ''} ${joinBottom ? 'rounded-b-none -mb-px relative' : ''} text-left border-0 cursor-pointer ${selected ? 'bg-bg-subtle' : 'bg-transparent'} text-inherit transition-[background-color] duration-[120ms] ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`}
          aria-label={ariaLabel}
          aria-current={selected || undefined}
          data-mail-id={message.id}
          // Shift-click picks a range: no text selection along with it.
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault()
          }}
          onClick={(event) => onOpen(message.id, event)}
          onContextMenu={onContextMenu ? (event) => onContextMenu(message.id, event) : undefined}
          onPointerEnter={onHover ? (event) => event.pointerType === 'mouse' && onHover(message.id) : undefined}
          onPointerLeave={onHover ? () => onHover(null) : undefined}
        >
          {content}
        </button>
        </SwipeableRow>
      </li>
    )
  }

  if (!href) {
    return <li className={`${ROW_CLASSES} ${ITEM_CLASSES}`} aria-label={ariaLabel}>{content}</li>
  }

  return (
    <li {...row}>
      {/* The hover tint bleeds into the page's side padding. */}
      <a
        className={`${ITEM_CLASSES} -mx-3 px-3 rounded-[10px] no-underline text-inherit transition-[background-color] duration-[120ms] ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        title={receivedAt ? `${sender} — ${subject}\n${fullDateFormatter.format(receivedAt)}` : `${sender} — ${subject}`}
      >
        {content}
      </a>
    </li>
  )
}

// The in-app mail page (the « Messagerie » tab, « Mail » in the tab bar): the
// inbox as an endless list, newest first, each message opening in the reader
// (its own history entry: Back returns to the list, on the row it came
// from). Older pages load as the end of the list nears the screen.
// `onSignInAgain`: the « Se reconnecter » of an expired session (App's
// sign-out, then its login page).
// `sender`: the student's { name, email } (App's account), the composer's
// « De : ».
function MailPage({ onReaderOpenChange, onSignInAgain, sender = null }) {
  // nextOffset: where the next page starts on the server.
  // `folder`: the folder the list is of (the one shown until another's
  // first page arrives).
  const [state, setState] = useState({ status: 'loading', folder: INBOX_FOLDER, unreadCount: null, webmailHref: null, messages: [], hasMore: false, nextOffset: 0 })
  const [moreStatus, setMoreStatus] = useState('idle')
  // The reader's copy of the open message's state, for one not in the list.
  const [loadedMessage, setLoadedMessage] = useState(null)
  // { key, text, onUndo }: the notice after an action (MailToast).
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  // A mail route answered that the session is gone (entApi's
  // onMailSessionExpired: a 401, or the list's { authenticated: false }).
  // The list already loaded stays, under a « Session expirée » notice, and
  // the actions' failures say so; a list loaded again clears it. The ref:
  // read by those failures, set before mailAction's answer reaches them.
  const [isSessionExpired, setIsSessionExpired] = useState(false)
  const sessionExpiredRef = useRef(false)
  useEffect(() => onMailSessionExpired(() => {
    sessionExpiredRef.current = true
    setIsSessionExpired(true)
  }), [])
  // The message shown in the reader, from the history entry (a reload keeps it).
  const [openId, setOpenId] = useState(() => readHistoryNav().mail)
  const openIdRef = useRef(openId)
  useEffect(() => {
    openIdRef.current = openId
  }, [openId])
  // The mail the page opened by itself (removeMessages), read only after
  // AUTO_OPENED_READ_DELAY_MS; `pendingReadRef`: its unread mails waiting
  // for that, { threadId, ids, timer }.
  const autoOpenedIdRef = useRef(null)
  const pendingReadRef = useRef(null)
  // The webmail's « mark as read » setting, in seconds (-1 never, 0 at
  // once): read once when the page opens, at once until it's known.
  const markReadDelayRef = useRef(0)
  // The composer's attachment limits, from the same answer (null until it
  // comes: the composer has a fallback, the server checks again).
  const [attachmentLimits, setAttachmentLimits] = useState(null)
  useEffect(() => {
    let cancelled = false
    void getMailPrefs().then(({ markRead, attachments }) => {
      if (cancelled) return
      markReadDelayRef.current = markRead
      setAttachmentLimits(attachments)
    })
    return () => {
      cancelled = true
    }
  }, [])
  // Mails picked with ⌘/Ctrl or Shift: from two on, the panel and the
  // actions are theirs (MailSelection). `selectionAnchorRef`: where a
  // Shift-click range starts.
  const [selectedIds, setSelectedIds] = useState([])
  const selectionAnchorRef = useRef(null)
  // { x, y, ids }: the right-click menu on the list, and what it acts on.
  const [contextMenu, setContextMenu] = useState(null)
  // { kind: 'folders' | 'move', x, y, above, ids }: the folder tree as a
  // menu — « Dossiers » (a folder to show) or « Déplacer vers » (a folder to
  // file `ids` in); `above`: it opens upwards from (x, y), over the phone's
  // toolbar at the screen's foot.
  const [folderMenu, setFolderMenu] = useState(null)
  // { x, y, folderId }: a folder pill's own menu (right click, long press).
  const [pillMenu, setPillMenu] = useState(null)
  // What waits for « Supprimer » in the confirmation dialog: { kind:
  // 'delete', ids } (mails for good) or { kind: 'empty', folder } (the
  // trash or the junk folder emptied).
  const [confirmation, setConfirmation] = useState(null)
  // The search field's text. The list first keeps the loaded mails it
  // matches, then the server's matches over the whole inbox (`search`, for
  // the text it was asked: { query, status, messages, hasMore, nextOffset }).
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState(IDLE_SEARCH)
  // The mailbox's folders (pills over the list) and the one shown; the ref
  // drops an answer for a folder left meanwhile.
  const [folders, setFolders] = useState(null)
  const [folderId, setFolderId] = useState(INBOX_FOLDER)
  const folderIdRef = useRef(INBOX_FOLDER)
  const folderKind = folders?.find((folder) => folder.id === folderId)?.kind ?? 'inbox'
  const folderParam = folderId === INBOX_FOLDER ? null : folderId
  // The message in the side panel, kept while it slides out after closing.
  const [panelId, setPanelId] = useState(openId)
  // A mail opened once: coming back to the list (on a phone) slides it in,
  // arriving on the page doesn't.
  const [hasOpenedMail, setHasOpenedMail] = useState(Boolean(openId))
  if (openId && !hasOpenedMail) setHasOpenedMail(true)
  const [readerWidth, setReaderWidth] = useState(readStoredReaderWidth)
  const [isResizingReader, setIsResizingReader] = useState(false)
  const handleReaderWidthChange = useCallback((width, { persist = false } = {}) => {
    setReaderWidth(width)
    if (persist) storeReaderWidth(width)
  }, [])
  if (openId && openId !== panelId) setPanelId(openId)
  const searchWords = foldMailSearchText(query).split(/\s+/).filter(Boolean)
  const searchText = query.trim()
  const isSearching = searchWords.length > 0
  // The server is asked only once a word has two letters or digits
  // (parseMailSearchWords, the server's own rule): « a » filters the loaded
  // list alone, rather than a prefix search for a* over the whole mailbox.
  const canSearchServer = parseMailSearchWords(searchText).length > 0
  const isSearchCurrent = search.query === searchText && search.folder === folderParam
  const hasServerResults = isSearching && canSearchServer && isSearchCurrent && search.status === 'ok'
  const isSearchFailed = isSearching && canSearchServer && isSearchCurrent && search.status === 'error'
  // Local matches shown, the server's on their way (the typing pause too).
  const isSearchPending = isSearching && canSearchServer && !hasServerResults && !isSearchFailed
  // The two searches don't find the same mails: the local one looks for the
  // text anywhere in the loaded rows (« odle » finds Moodle), the server's
  // for word prefixes, but in the text of every mail. Swapping one list for
  // the other made rows vanish, and come back a keystroke later. So the list
  // is always their union, newest first:
  // - the loaded mails matching (they do match what's typed), of the folder
  //   shown — not the one being left, while its list stays dimmed;
  // - the server's answer for this text, once it's there;
  // - meanwhile, its answer for the previous text, when one text extends
  //   the other (« exam » → « exame », or back): prefix results of the
  //   longer text are results of the shorter one, so those rows stay until
  //   the new answer says which go. For an unrelated text, only its rows
  //   matching locally stay.
  // Each row keeps its place by date, so an answer only adds rows in theirs
  // and drops rows that no longer match: none leaves and returns.
  const searchFolded = searchWords.join(' ')
  const visibleMessages = useMemo(() => {
    if (!isSearching) return state.messages
    const local = state.messages.filter((message) => matchesSearch(message, searchWords))
    if (hasServerResults) {
      return state.folder === folderId ? mergeSearchRows(search.messages, local) : search.messages
    }
    const previous = search.folder === folderParam ? search.messages : []
    const answered = foldMailSearchText(search.resultsQuery).trim()
    const typed = foldMailSearchText(searchText)
    const related = Boolean(answered) && (typed.startsWith(answered) || answered.startsWith(typed))
    return mergeSearchRows(related ? previous : previous.filter((message) => matchesSearch(message, searchWords)), local)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the words, by their text
  }, [state.messages, state.folder, folderId, folderParam, search.messages, search.folder, search.resultsQuery, isSearching, hasServerResults, searchText, searchFolded])
  const isFolderSwitching = state.folder !== folderId
  const listFolderKind = folders?.find((folder) => folder.id === state.folder)?.kind ?? 'inbox'
  const listHasMore = !isFolderSwitching && (isSearching ? hasServerResults && search.hasMore : state.hasMore)
  // Only the ones still shown (a refresh, a deletion, the search).
  const selection = selectedIds.filter((id) => visibleMessages.some((entry) => entry.id === id))
  const isMultiple = selection.length >= 2
  const isPanelClosing = !openId && Boolean(panelId) && !isMultiple
  const panelRef = useRef(null)
  // The list's header stuck at the top (its blur showing): once the
  // section's top is scrolled out of view.
  const headerSentinelRef = useRef(null)
  const [isHeaderStuck, setIsHeaderStuck] = useState(false)
  useEffect(() => {
    const sentinel = headerSentinelRef.current
    if (!sentinel) return undefined
    const observer = new IntersectionObserver(([entry]) => setIsHeaderStuck(!entry.isIntersecting))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])
  // Another mail picked in the list: the panel starts again at its top.
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
  }, [panelId])
  const lastOpenedRef = useRef(null)
  const sectionRef = useRef(null)
  const [storedWebmailHref, setStoredWebmailHref] = useState(() => readStoredHref(WEBMAIL_HREF_KEY))
  const [now, setNow] = useState(() => new Date())
  const lastLoadAtRef = useRef(0)
  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const listEndRef = useRef(null)

  const loadMail = useCallback(async ({ background = false, fresh = false } = {}) => {
    const folder = folderIdRef.current
    if (loadingRef.current === folder) return
    loadingRef.current = folder

    try {
      const result = await getRecentMail({ folder: folder === INBOX_FOLDER ? null : folder, fresh })
      if (folderIdRef.current !== folder) return
      lastLoadAtRef.current = Date.now()
      setNow(new Date())
      if (result.webmailHref) {
        storeHref(WEBMAIL_HREF_KEY, result.webmailHref)
        setStoredWebmailHref(result.webmailHref)
      }
      // A list again: the session is back (or was never gone).
      if (result.status === 'ok') {
        sessionExpiredRef.current = false
        setIsSessionExpired(false)
      }
      setState((current) => {
        // The session gone: the list shown stays (another folder's too,
        // asked for meanwhile), under the « Session expirée » notice.
        if (result.status === 'unauthenticated' && current.status === 'ok') return current
        if (!background || current.status !== 'ok' || current.folder !== folder) return { ...result, folder, nextOffset: result.messages.length }
        // Keep the last good list on a failed background refresh.
        if (result.status === 'error') return current
        // The fresh first page, then the older pages already loaded.
        if (result.status === 'ok' && current.nextOffset > result.messages.length) {
          return { ...result, folder, messages: appendMessages(result.messages, current.messages), hasMore: current.hasMore, nextOffset: current.nextOffset }
        }
        return { ...result, folder, nextOffset: result.messages.length }
      })
    } finally {
      if (loadingRef.current === folder) loadingRef.current = false
    }
  }, [])

  // The folders (their pills' unread dots). Their counts are how a new mail
  // shows: a change in the shown folder's since the last look reloads its
  // list (past the cache), new mails sliding in at the top. Its own
  // actions (read, deleted) change them too: a reload then, harmless.
  const folderSnapshotsRef = useRef({})
  const loadFolders = useCallback(async () => {
    const next = await getMailFolders()
    if (!next?.length) return
    setFolders(next)
    const shown = next.find((folder) => folder.id === folderIdRef.current)
    if (!shown) return
    const snapshot = `${shown.count}:${shown.unread}`
    const previous = folderSnapshotsRef.current[shown.id]
    folderSnapshotsRef.current[shown.id] = snapshot
    if (previous !== undefined && previous !== snapshot) void loadMail({ background: true, fresh: true })
  }, [loadMail])

  // The refresh button: the list, the folders and a running search, anew.
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const refresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setSearchNonce((value) => value + 1)
    const minimumSpin = new Promise((resolve) => { window.setTimeout(resolve, REFRESH_MIN_SPIN_MS) })
    await Promise.all([loadMail({ background: true, fresh: true }), loadFolders(), minimumSpin])
    setIsRefreshing(false)
  }, [isRefreshing, loadMail, loadFolders])

  // A look at the folders every NEW_MAIL_CHECK_MS while the page is shown,
  // and as soon as it's shown again.
  useEffect(() => {
    function checkIfShown() {
      if (document.visibilityState === 'visible') void loadFolders()
    }
    const intervalId = window.setInterval(checkIfShown, NEW_MAIL_CHECK_MS)
    document.addEventListener('visibilitychange', checkIfShown)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', checkIfShown)
    }
  }, [loadFolders])

  // Another folder: the list shown stays, dimmed, until the new one's first
  // page replaces it at once (isFolderSwitching); its search starts over,
  // the open mail stays in the reader.
  const selectFolder = useCallback((id) => {
    if (id === folderIdRef.current) return
    folderIdRef.current = id
    setFolderId(id)
    setSelectedIds([])
    setMoreStatus('idle')
    void loadMail()
  }, [loadMail])

  const { status, hasMore, nextOffset } = state
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || status !== 'ok' || !hasMore || state.folder !== folderIdRef.current) return
    loadingMoreRef.current = true
    setMoreStatus('loading')

    try {
      const folder = folderIdRef.current
      const result = await getRecentMail({ offset: nextOffset, folder: folder === INBOX_FOLDER ? null : folder })
      if (folderIdRef.current !== folder) return
      if (result.status !== 'ok') {
        setMoreStatus('error')
        return
      }
      setState((current) => (current.status === 'ok' && current.nextOffset === nextOffset
        ? {
            ...current,
            messages: appendMessages(current.messages, result.messages),
            // An empty page ends the list, whatever the server says.
            hasMore: result.hasMore && result.messages.length > 0,
            nextOffset: nextOffset + result.messages.length,
          }
        : current))
      setMoreStatus('idle')
    } finally {
      loadingMoreRef.current = false
    }
  }, [status, hasMore, nextOffset, state.folder])

  // The server's search, once the typing pauses (and for a word of two
  // characters or more: canSearchServer). A request the typing has made
  // pointless is aborted; an answer for an older text is dropped all the
  // same. The previous answer, of this folder, stays while this one comes
  // (visibleMessages keeps its rows that still match).
  useEffect(() => {
    if (!searchText || !canSearchServer) {
      setSearch(IDLE_SEARCH)
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearch((current) => {
        const sameFolder = current.folder === folderParam
        return {
          ...IDLE_SEARCH,
          query: searchText,
          folder: folderParam,
          status: 'loading',
          messages: sameFolder ? current.messages : [],
          resultsQuery: sameFolder ? current.resultsQuery : '',
        }
      })
      const result = await getRecentMail({ query: searchText, folder: folderParam, signal: controller.signal })
      if (controller.signal.aborted || result.status === 'aborted') return
      setSearch((current) => {
        if (current.query !== searchText || current.folder !== folderParam) return current
        if (result.status !== 'ok') return { ...current, status: 'error' }
        return {
          query: searchText,
          folder: folderParam,
          status: 'ok',
          messages: result.messages,
          hasMore: result.hasMore && result.messages.length > 0,
          nextOffset: result.messages.length,
          resultsQuery: searchText,
        }
      })
    }, SEARCH_DELAY_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [searchText, canSearchServer, folderParam, searchNonce])

  // The search's next page, as the inbox's (loadMore).
  const loadMoreSearch = useCallback(async () => {
    if (loadingMoreRef.current || search.status !== 'ok' || !search.hasMore) return
    const { query: searched, nextOffset: offset } = search
    loadingMoreRef.current = true
    setMoreStatus('loading')
    try {
      const result = await getRecentMail({ query: searched, offset, folder: folderParam })
      if (result.status !== 'ok') {
        setMoreStatus('error')
        return
      }
      setSearch((current) => (current.query === searched && current.nextOffset === offset
        ? {
            ...current,
            messages: appendMessages(current.messages, result.messages),
            hasMore: result.hasMore && result.messages.length > 0,
            nextOffset: offset + result.messages.length,
          }
        : current))
      setMoreStatus('idle')
    } finally {
      loadingMoreRef.current = false
    }
  }, [search, folderParam])
  const loadMoreShown = isSearching ? loadMoreSearch : loadMore

  // Watched again after each page: if the end of the list is still in
  // reach (a tall screen), the next page follows right away. Searching,
  // only the server's matches page (local ones would read the whole inbox).
  useEffect(() => {
    const listEnd = listEndRef.current
    if (!listEnd || moreStatus !== 'idle' || !listHasMore) return undefined

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreShown()
    }, { rootMargin: LOAD_MORE_MARGIN })
    observer.observe(listEnd)
    return () => observer.disconnect()
  }, [loadMoreShown, moreStatus, listHasMore])

  useEffect(() => {
    void loadMail()
    void loadFolders()
  }, [loadMail, loadFolders])

  useEffect(() => {
    if (state.status === 'loading') return undefined

    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoadAtRef.current >= MAIL_REFRESH_MS) {
        void loadMail({ background: true })
        void loadFolders()
      }
    }

    const intervalId = window.setInterval(refreshIfStale, MAIL_REFRESH_MS)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [loadMail, loadFolders, state.status])

  // A step back when the reader has its entry (forward reopens it);
  // popstate then closes it.
  const closeMail = useCallback(() => {
    if (readHistoryNav().mail === openId) window.history.back()
    else setOpenId(null)
  }, [openId])

  // The open mail's row clicked again closes it (the side panel has no
  // close button).
  const openMail = useCallback((id) => {
    if (id === openId) {
      closeMail()
      return
    }
    lastOpenedRef.current = id
    // The student's own choice: read as soon as it loads.
    autoOpenedIdRef.current = null
    writeHistoryNav({ page: 'mail', mail: id })
    setOpenId(id)
  }, [openId, closeMail])

  // A row clicked: ⌘/Ctrl adds or takes it out of the selection (the open
  // mail its first), Shift picks the range from the last one clicked; a
  // plain click, or a selection down to one, opens that mail.
  const handleRowClick = useCallback((id, event) => {
    const ids = visibleMessages.map((entry) => entry.id)
    let next = null
    if (event?.metaKey || event?.ctrlKey) {
      const base = selection.length ? selection : (openId && openId !== id ? [openId] : [])
      next = base.includes(id) ? base.filter((entry) => entry !== id) : [...base, id]
    } else if (event?.shiftKey) {
      const anchor = selectionAnchorRef.current ?? openId
      const from = ids.indexOf(anchor)
      const to = ids.indexOf(id)
      next = from >= 0 && to >= 0 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
    }
    if (!event?.shiftKey) selectionAnchorRef.current = id

    if (next && next.length >= 2) {
      setSelectedIds(next)
      return
    }
    setSelectedIds([])
    const single = next ? next[0] : id
    if (!single) return
    // Back to the open one (or a plain click on it, leaving a selection): it
    // stays open.
    if ((next || selection.length >= 2) && single === openId) return
    openMail(single)
  }, [visibleMessages, selection, openId, openMail])

  // Escape lets go of a selection.
  useEffect(() => {
    if (!isMultiple) return undefined
    function handleKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setSelectedIds([])
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isMultiple])

  useEffect(() => {
    function handlePopState(event) {
      const { page, mail } = readHistoryNav(event.state)
      if (page !== 'mail') return
      // Back or Forward to a mail is the student's own opening too.
      autoOpenedIdRef.current = null
      setOpenId(mail)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // The reader starts at the top; back on the list, the row it came from is
  // in view and focused.
  const isReaderOpen = Boolean(openId) || isMultiple
  useEffect(() => {
    onReaderOpenChange?.(isReaderOpen)
  }, [isReaderOpen, onReaderOpenChange])
  useEffect(() => () => onReaderOpenChange?.(false), [onReaderOpenChange])

  // From 1024 px the reader is a panel beside the list, which stays put.
  useEffect(() => {
    const beside = window.matchMedia(READER_BESIDE_QUERY).matches
    // No panel to slide out on a narrow screen: the list comes back at once.
    if (!openId && !beside) setPanelId(null)
    if (openId) {
      if (!beside) sectionRef.current?.scrollIntoView({ block: 'start' })
      return
    }
    const id = lastOpenedRef.current
    if (!id) return
    const row = sectionRef.current?.querySelector(`[data-mail-id="${CSS.escape(id)}"]`)
    row?.scrollIntoView({ block: beside ? 'nearest' : 'center' })
    row?.focus({ preventScroll: true })
  }, [openId])

  const showToast = useCallback((text, onUndo = null) => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ key: Date.now(), text, onUndo })
    // With « Annuler », its ring's end closes it (MailToast).
    if (!onUndo) toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])
  // An action's failure notice: « Session expirée » when that's why (the
  // 401 is reported before mailAction answers), else what didn't happen.
  const failureText = useCallback((text) => (sessionExpiredRef.current ? 'Session expirée' : text), [])

  // The composer (MailComposer): { key, kind, message } while one is open,
  // `message` the mail answered or forwarded. One at a time: another asked
  // for while the open one was changed waits for « Supprimer le brouillon ? »
  // (`pendingCompose`). Nothing of it is stored: closed, it's gone.
  const [composer, setComposer] = useState(null)
  const [pendingCompose, setPendingCompose] = useState(null)
  const composerApiRef = useRef(null)
  const showComposer = useCallback((next) => {
    if (composerApiRef.current?.isDirty()) setPendingCompose(next)
    else setComposer(next)
  }, [])
  // A reply is to the thread's newest mail (the one the reader opens on),
  // its body most often already in the reader's cache.
  const startCompose = useCallback(async (kind) => {
    if (kind === 'new') {
      showComposer({ key: Date.now(), kind, message: null })
      return
    }
    const threadId = openIdRef.current
    if (!threadId) return
    try {
      const thread = settledValue(threadCache, threadKey(threadId, folderId)) ?? await fetchThread(threadId, folderId)
      const newest = thread[thread.length - 1]
      const message = await loadMessage(newest?.id ?? threadId)
      showComposer({ key: Date.now(), kind, message })
    } catch {
      showToast(failureText('Le mail n’a pas chargé'))
    }
  }, [folderId, showComposer, showToast, failureText])
  const closeComposer = useCallback(() => setComposer(null), [])
  const confirmPendingCompose = useCallback(() => {
    setComposer(pendingCompose)
    setPendingCompose(null)
  }, [pendingCompose])
  const cancelPendingCompose = useCallback(() => setPendingCompose(null), [])

  // Messages' state, in the list and the reader's copy; the unread count
  // follows. `patch`: an object, or a function of the message giving one.
  const patchMessages = useCallback((ids, patch) => {
    const patchFor = (entry) => (typeof patch === 'function' ? patch(entry) : patch)
    setLoadedMessage((current) => (current && ids.includes(current.id) ? { ...current, ...patchFor(current) } : current))
    setState((current) => {
      let { unreadCount } = current
      const messages = current.messages.map((entry) => {
        if (!ids.includes(entry.id)) return entry
        const next = { ...entry, ...patchFor(entry) }
        if (Boolean(entry.unread) !== Boolean(next.unread) && Number.isFinite(unreadCount)) {
          unreadCount = Math.max(unreadCount + (next.unread ? 1 : -1), 0)
        }
        return next
      })
      return { ...current, unreadCount, messages }
    })
    setSearch((current) => (current.messages.some((entry) => ids.includes(entry.id))
      ? { ...current, messages: current.messages.map((entry) => (ids.includes(entry.id) ? { ...entry, ...patchFor(entry) } : entry)) }
      : current))
  }, [])

  const markThreadRead = useCallback((threadId, unreadIds) => {
    void mailAction(unreadIds, 'read').then((ok) => {
      if (ok) patchMessages([threadId], { unread: false })
    })
  }, [patchMessages])

  const cancelPendingRead = useCallback(() => {
    window.clearTimeout(pendingReadRef.current?.timer)
    pendingReadRef.current = null
  }, [])

  // A thread opened: its unread mails read in the webmail too, then the
  // row — at once, or once it has stayed open as long as the webmail's
  // setting asks (markReadDelayRef) and, for one the page opened itself, at
  // least AUTO_OPENED_READ_DELAY_MS (another mail opened, or the reader
  // closed, before that: it stays unread). The setting at « never »: it
  // stays unread until marked by hand. Its state kept for a thread not in
  // the list (a reload on it): its mails in this folder are what its
  // actions act on.
  const handleThreadLoaded = useCallback((threadId, messages) => {
    const unreadIds = messages.filter((message) => message.unread).map((message) => message.id)
    const isAutoOpened = autoOpenedIdRef.current === threadId
    const pending = pendingReadRef.current?.threadId === threadId ? pendingReadRef.current : null
    const setting = markReadDelayRef.current
    const never = setting < 0
    const delay = Math.max(never ? 0 : setting * 1000, isAutoOpened ? AUTO_OPENED_READ_DELAY_MS : 0)
    setLoadedMessage({
      id: threadId,
      unread: (never || delay > 0) && (unreadIds.length > 0 || Boolean(pending)),
      flagged: messages.some((message) => message.flagged),
      messageIds: messages.filter((message) => !message.folder || message.folder === folderId).map((message) => message.id),
    })
    if (!unreadIds.length || never) return
    if (delay === 0) {
      markThreadRead(threadId, unreadIds)
      return
    }
    // Its fresh list after the cached one: more mails to read at the same
    // moment, the wait not started over.
    if (pending) {
      for (const id of unreadIds) pending.ids.add(id)
      return
    }
    cancelPendingRead()
    const next = { threadId, ids: new Set(unreadIds), timer: null }
    next.timer = window.setTimeout(() => {
      if (pendingReadRef.current !== next) return
      pendingReadRef.current = null
      if (openIdRef.current === threadId) markThreadRead(threadId, [...next.ids])
    }, delay)
    pendingReadRef.current = next
  }, [folderId, markThreadRead, cancelPendingRead])

  // The wait dropped once that mail isn't the one shown any more (another
  // opened, the reader closed, a selection in its place), and on leaving.
  useEffect(() => {
    const pending = pendingReadRef.current
    if (pending && (pending.threadId !== openId || isMultiple)) cancelPendingRead()
  }, [openId, isMultiple, cancelPendingRead])
  useEffect(() => cancelPendingRead, [cancelPendingRead])

  const findMessage = useCallback((id) => state.messages.find((entry) => entry.id === id)
    ?? search.messages.find((entry) => entry.id === id)
    ?? (loadedMessage?.id === id ? loadedMessage : null), [state.messages, search.messages, loadedMessage])

  // The list's rows are threads: the mails an action goes to are theirs (in
  // the folder shown), a row without them (the demo's) its own id.
  const messageIdsOf = useCallback((ids) => [...new Set(ids.flatMap((id) => {
    const listed = findMessage(id)?.messageIds
    return listed?.length ? listed : [id]
  }))], [findMessage])

  // What the toolbar acts on: the selection, else the open mail. As one
  // state: unread when any is, flagged when all are.
  const targetIds = isMultiple ? selection : (openId ? [openId] : [])
  const describeTargets = (ids) => {
    const messages = ids.map(findMessage).filter(Boolean)
    if (!messages.length) return null
    return { unread: messages.some((entry) => entry.unread), flagged: messages.every((entry) => entry.flagged) }
  }
  const targetState = describeTargets(targetIds)

  // Unread or flag, on all of them: shown at once, each put back as it was
  // if the webmail refuses.
  const setMessagesFlag = useCallback((ids, key, value) => {
    if (!ids.length) return
    // Read or unread by hand: the page's own marking, if it was waiting
    // (handleThreadLoaded), no longer has a say.
    if (key === 'unread' && ids.includes(pendingReadRef.current?.threadId)) cancelPendingRead()
    const before = new Map(ids.map((id) => [id, Boolean(findMessage(id)?.[key])]))
    patchMessages(ids, { [key]: value })
    const action = key === 'unread' ? (value ? 'unread' : 'read') : (value ? 'flag' : 'unflag')
    void mailAction(messageIdsOf(ids), action).then((ok) => {
      if (ok) return
      patchMessages(ids, (entry) => ({ [key]: before.get(entry.id) ?? !value }))
      showToast(failureText(key === 'unread' ? 'Le mail n’a pas pu être marqué' : 'Le drapeau n’a pas pu être changé'))
    })
  }, [findMessage, messageIdsOf, patchMessages, showToast, failureText, cancelPendingRead])

  // Trash or junk: out of the list at once, the next mail (or the one above)
  // in the reader if the open one went, and a notice to bring them back to
  // the inbox. The same for the other ways out of a folder: `restore` (from
  // the Corbeille back to the inbox: Zimbra keeps no trace of where a
  // trashed mail was), `move` (to `folder`, named `folderLabel` in the
  // notice) and `delete` (for good, once confirmed: its notice has no
  // « Annuler », there's nothing to bring back).
  const removeMessages = useCallback((ids, action, { folder: target = null, folderLabel = '' } = {}) => {
    if (!ids.length) return
    const removed = state.messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => ids.includes(message.id))
    const removedFromSearch = search.messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => ids.includes(message.id))
    const count = Math.max(removed.length, removedFromSearch.length, ids.length)

    setSelectedIds([])
    setSearch((current) => ({
      ...current,
      messages: current.messages.filter((entry) => !ids.includes(entry.id)),
      nextOffset: Math.max(current.nextOffset - removedFromSearch.length, 0),
    }))
    setState((current) => {
      const unread = current.messages.filter((entry) => ids.includes(entry.id) && entry.unread).length
      return {
        ...current,
        messages: current.messages.filter((entry) => !ids.includes(entry.id)),
        // The server's inbox shrank too: the next page starts earlier.
        nextOffset: Math.max(current.nextOffset - removed.length, 0),
        unreadCount: Number.isFinite(current.unreadCount) ? Math.max(current.unreadCount - unread, 0) : current.unreadCount,
      }
    })
    if (openId && ids.includes(openId)) {
      // The next one shown (the search's), else the one above.
      const shown = visibleMessages.map((entry) => entry.id)
      const indexes = ids.map((id) => shown.indexOf(id)).filter((index) => index >= 0)
      const last = indexes.length ? Math.max(...indexes) : -1
      const first = indexes.length ? Math.min(...indexes) : -1
      const next = visibleMessages.slice(last + 1).find((entry) => !ids.includes(entry.id))
        ?? visibleMessages.slice(0, Math.max(first, 0)).reverse().find((entry) => !ids.includes(entry.id))
      // Beside the list (from 1024 px) the reader goes on to that mail, as
      // Apple Mail does, but leaves it unread for a moment (handleThreadLoaded):
      // it wasn't picked. On a narrower screen, where the reader stands in
      // for the list, back to the list instead, on that mail's row.
      if (next?.id && window.matchMedia(READER_BESIDE_QUERY).matches) {
        lastOpenedRef.current = next.id
        autoOpenedIdRef.current = next.id
        writeHistoryNav({ page: 'mail', mail: next.id }, { replace: true })
        setOpenId(next.id)
      } else {
        lastOpenedRef.current = next?.id ?? null
        closeMail()
      }
    }

    // Each back at its place, in the order they were (in the search's
    // results too, for the same search).
    const searched = search.query
    const restore = () => {
      setSearch((current) => {
        const missing = current.query === searched
          ? removedFromSearch.filter(({ message }) => !current.messages.some((entry) => entry.id === message.id))
          : []
        if (!missing.length) return current
        const messages = [...current.messages]
        for (const { message, index } of missing) messages.splice(Math.min(index, messages.length), 0, message)
        return { ...current, messages, nextOffset: current.nextOffset + missing.length }
      })
      restoreInbox()
    }
    const restoreInbox = () => setState((current) => {
      const missing = removed.filter(({ message }) => !current.messages.some((entry) => entry.id === message.id))
      if (!missing.length) return current
      const messages = [...current.messages]
      for (const { message, index } of missing) messages.splice(Math.min(index, messages.length), 0, message)
      const unread = missing.filter(({ message }) => message.unread).length
      return {
        ...current,
        messages,
        nextOffset: current.nextOffset + missing.length,
        unreadCount: Number.isFinite(current.unreadCount) ? current.unreadCount + unread : current.unreadCount,
      }
    })

    // `inbox`: out of the junk folder (« Pas indésirable »); `restore` is the
    // same move to the inbox, from the Corbeille.
    const plural = count > 1
    const actionIds = messageIdsOf(ids)
    const done = action === 'move'
      ? mailAction(actionIds, 'move', { folder: target })
      : mailAction(actionIds, action === 'restore' ? 'inbox' : action)
    const doneText = {
      trash: plural ? `${count} mails supprimés` : 'Mail supprimé',
      spam: plural ? `${count} mails mis en indésirables` : 'Mail mis en indésirables',
      inbox: plural ? `${count} mails remis dans la réception` : 'Mail remis dans la réception',
      restore: plural ? `${count} mails restaurés` : 'Mail restauré',
      move: plural ? `${count} mails déplacés dans ${folderLabel}` : `Mail déplacé dans ${folderLabel}`,
      delete: plural ? `${count} mails supprimés définitivement` : 'Mail supprimé définitivement',
    }[action]
    const failedText = {
      trash: plural ? 'Les mails n’ont pas pu être supprimés' : 'Le mail n’a pas pu être supprimé',
      spam: plural ? 'Les mails n’ont pas pu être mis en indésirables' : 'Le mail n’a pas pu être mis en indésirables',
      inbox: plural ? 'Les mails n’ont pas pu être remis dans la réception' : 'Le mail n’a pas pu être remis dans la réception',
      restore: plural ? 'Les mails n’ont pas pu être restaurés' : 'Le mail n’a pas pu être restauré',
      move: plural ? 'Les mails n’ont pas pu être déplacés' : 'Le mail n’a pas pu être déplacé',
      delete: plural ? 'Les mails n’ont pas pu être supprimés' : 'Le mail n’a pas pu être supprimé',
    }[action]
    const from = folderIdRef.current
    // Gone for good: a plain notice, its rows back only if the webmail
    // refused.
    if (action === 'delete') {
      showToast(doneText)
      void done.then((ok) => {
        if (ok) return
        if (folderIdRef.current === from) restore()
        showToast(failureText(failedText))
      })
      return
    }
    showToast(doneText, () => {
      setToast(null)
      // After the action itself: undone only once it went through, back to
      // the folder they were in.
      void done.then((ok) => (ok ? mailAction(actionIds, 'move', { folder: from }) : true)).then((ok) => {
        if (!ok) showToast(failureText(plural ? 'Les mails n’ont pas pu être remis' : 'Le mail n’a pas pu être remis'))
        else if (folderIdRef.current === from) restore()
      })
    })
    void done.then((ok) => {
      if (ok) return
      if (folderIdRef.current === from) restore()
      showToast(failureText(failedText))
    })
  }, [state.messages, search, visibleMessages, openId, closeMail, showToast, failureText, messageIdsOf])

  // « Déplacer » picked a folder: the mails filed there, out of this list
  // as a deletion would take them, « Annuler » moving them back.
  const moveMessages = useCallback((ids, target) => {
    const folder = folders?.find((entry) => entry.id === target)
    if (!ids.length || !folder || target === folderIdRef.current) return
    removeMessages(ids, 'move', { folder: target, folderLabel: getFolderLabel(folder) })
  }, [folders, removeMessages])

  // The tree under a pill or a button (`rect`, its box): « Dossiers » to
  // show a folder, « Déplacer vers » to file `ids`. A button in the lower
  // half of the screen (the phone's toolbar) opens it upwards.
  const openFolderMenu = useCallback((kind, rect, ids = []) => {
    const above = rect.top != null && rect.top > window.innerHeight / 2
    setContextMenu(null)
    setPillMenu(null)
    setFolderMenu({ kind, x: rect.left, y: above ? rect.top - 6 : rect.bottom + 6, above, ids })
  }, [])
  const closeFolderMenu = useCallback(() => setFolderMenu(null), [])
  const closePillMenu = useCallback(() => setPillMenu(null), [])
  const handleFolderPillMenu = useCallback((id, point) => {
    setContextMenu(null)
    setFolderMenu(null)
    setPillMenu({ x: point.clientX, y: point.clientY, folderId: id })
  }, [])

  // « Tout marquer comme lu »: every mail of the folder read in the webmail
  // (one FolderActionRequest), shown at once — its rows, its count and its
  // pill's dot — and loaded again from the webmail if it refused.
  const markFolderRead = useCallback((id) => {
    const isShown = state.folder === id
    setFolders((current) => current?.map((folder) => (folder.id === id ? { ...folder, unread: 0 } : folder)) ?? current)
    if (isShown) {
      if (pendingReadRef.current) cancelPendingRead()
      setLoadedMessage((current) => (current ? { ...current, unread: false } : current))
      setState((current) => (current.folder === id
        ? { ...current, unreadCount: Number.isFinite(current.unreadCount) ? 0 : current.unreadCount, messages: current.messages.map((entry) => (entry.unread ? { ...entry, unread: false } : entry)) }
        : current))
      setSearch((current) => (current.folder === (id === INBOX_FOLDER ? null : id)
        ? { ...current, messages: current.messages.map((entry) => (entry.unread ? { ...entry, unread: false } : entry)) }
        : current))
    }
    void mailFolderAction(id, 'read').then((ok) => {
      if (ok) return
      showToast(failureText('Les mails n’ont pas pu être marqués comme lus'))
      if (folderIdRef.current === id) void loadMail({ background: true, fresh: true })
      void loadFolders()
    })
  }, [state.folder, cancelPendingRead, showToast, failureText, loadMail, loadFolders])

  // « Vider la corbeille », « Vider les indésirables » (confirmed first):
  // all of it deleted for good, then the list empty, with a plain notice —
  // nothing to bring back. The trash's sub-folders (folders deleted into it)
  // go along, as in the webmail (the server's `recursive`).
  const emptyFolder = useCallback(async (id) => {
    const kind = folders?.find((folder) => folder.id === id)?.kind
    if (kind !== 'trash' && kind !== 'junk') return
    const ok = await mailFolderAction(id, 'empty')
    if (!ok) {
      showToast(failureText(kind === 'trash' ? 'La corbeille n’a pas pu être vidée' : 'Les indésirables n’ont pas pu être vidés'))
      return
    }
    // Its count at once; the tree (the trash's sub-folders gone) with the
    // next look at the folders, just after.
    setFolders((current) => current?.map((folder) => (folder.id === id ? { ...folder, unread: 0, count: 0 } : folder)) ?? current)
    if (folderIdRef.current === id) {
      setSelectedIds([])
      setState((current) => (current.folder === id ? { ...current, messages: [], hasMore: false, nextOffset: 0, unreadCount: Number.isFinite(current.unreadCount) ? 0 : current.unreadCount } : current))
      setSearch((current) => (current.folder === id ? { ...current, messages: [], hasMore: false, nextOffset: 0 } : current))
      if (openIdRef.current) closeMail()
    }
    showToast(kind === 'trash' ? 'Corbeille vidée' : 'Indésirables vidés')
    void loadFolders()
  }, [folders, showToast, failureText, closeMail, loadFolders])

  // The confirmation dialog's « Supprimer » / « Vider ».
  const confirmPending = useCallback(() => {
    const pending = confirmation
    setConfirmation(null)
    if (pending?.kind === 'delete') removeMessages(pending.ids, 'delete')
    else if (pending?.kind === 'empty') void emptyFolder(pending.folder)
  }, [confirmation, removeMessages, emptyFolder])
  const cancelConfirmation = useCallback(() => setConfirmation(null), [])

  // A row hovered a moment: its thread and the mails it opens with fetched
  // ahead (mailReadCache), so the click opens it at once.
  const hoverTimerRef = useRef(null)
  const handleRowHover = useCallback((id) => {
    window.clearTimeout(hoverTimerRef.current)
    if (!id) return
    hoverTimerRef.current = window.setTimeout(() => prefetchMailThread(id, folderIdRef.current), ROW_PREFETCH_DELAY_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), [])

  // Right click on a row: the menu acts on the selection when the row is in
  // it, else on that row alone.
  const handleRowContextMenu = useCallback((id, event) => {
    event.preventDefault()
    const ids = isMultiple && selection.includes(id) ? selection : [id]
    setContextMenu({ x: event.clientX, y: event.clientY, ids })
  }, [isMultiple, selection])
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const contextMenuItems = (() => {
    if (!contextMenu) return []
    const { ids } = contextMenu
    const described = describeTargets(ids)
    const single = ids.length === 1
    return [
      ...(single && ids[0] !== openId ? [{ id: 'open', label: 'Ouvrir', icon: 'carbon:email', onSelect: () => handleRowClick(ids[0]) }, 'separator'] : []),
      {
        id: 'unread',
        label: described?.unread ? 'Marquer comme lu' : 'Marquer comme non lu',
        icon: described?.unread ? 'carbon:email' : 'carbon:email-new',
        onSelect: () => setMessagesFlag(ids, 'unread', !described?.unread),
      },
      {
        id: 'flag',
        label: described?.flagged ? 'Retirer le drapeau' : 'Ajouter un drapeau',
        icon: described?.flagged ? 'carbon:flag' : 'carbon:flag-filled',
        onSelect: () => setMessagesFlag(ids, 'flagged', !described?.flagged),
      },
      'separator',
      // The folder picker where the menu was (the menu closes first).
      { id: 'move', label: 'Déplacer…', icon: 'carbon:folder-move-to', onSelect: () => openFolderMenu('move', { left: contextMenu.x, top: contextMenu.y, bottom: contextMenu.y }, ids) },
      // The trash: back to the inbox, or gone for good. The junk folder:
      // out of it, or gone for good. Elsewhere: junk, or the trash. Gone for
      // good asks first (ConfirmDialog).
      ...({
        trash: [{ id: 'restore', label: 'Restaurer', icon: 'carbon:undo', onSelect: () => removeMessages(ids, 'restore') }],
        junk: [{ id: 'not-spam', label: 'Pas indésirable', icon: 'carbon:checkmark-outline', onSelect: () => removeMessages(ids, 'inbox') }],
      }[folderKind] ?? [{ id: 'spam', label: 'Indésirable', icon: 'carbon:misuse-outline', onSelect: () => removeMessages(ids, 'spam') }]),
      folderKind === 'trash' || folderKind === 'junk'
        ? { id: 'delete-forever', label: single ? 'Supprimer définitivement' : `Supprimer ${ids.length} mails définitivement`, icon: 'carbon:trash-can', destructive: true, onSelect: () => setConfirmation({ kind: 'delete', ids }) }
        : { id: 'trash', label: single ? 'Supprimer' : `Supprimer ${ids.length} mails`, icon: 'carbon:trash-can', destructive: true, onSelect: () => removeMessages(ids, 'trash') },
    ]
  })()

  // The folder tree as menu items (ContextMenu's `depth`, `detail`,
  // `checked`, `hint`). « Dossiers »: the tree of the menu (getMenuFolders),
  // the one shown ticked, unread counts at the end. « Déplacer vers »: where
  // mail can go (getMoveTargetFolders), the folder it's in greyed out.
  const folderMenuItems = (() => {
    if (!folderMenu || !folders) return []
    const moving = folderMenu.kind === 'move'
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    const shown = moving ? getMoveTargetFolders(folders) : getMenuFolders(folders)
    // Depths as shown: a folder whose parent isn't listed moves up a step.
    const depths = new Map()
    return shown.map((folder) => {
      const depth = folder.parentId && depths.has(folder.parentId) ? depths.get(folder.parentId) + 1 : 0
      depths.set(folder.id, depth)
      const unread = folder.id === state.folder && Number.isFinite(state.unreadCount) ? state.unreadCount : folder.unread
      return {
        id: folder.id,
        label: getFolderLabel(folder),
        icon: getFolderIcon(folder),
        depth,
        hint: getFolderPath(folder, folders),
        detail: !moving && unread > 0 && !isQuietFolder(folder, byId) ? unread : null,
        checked: moving ? undefined : folder.id === folderId,
        disabled: moving && folder.id === folderId,
        onSelect: () => (moving ? moveMessages(folderMenu.ids, folder.id) : selectFolder(folder.id)),
      }
    })
  })()

  // The confirmation's words: how many mails, or which folder.
  const confirmationText = (() => {
    if (confirmation?.kind === 'empty') {
      const trash = folders?.find((folder) => folder.id === confirmation.folder)?.kind === 'trash'
      return trash
        ? { title: 'Vider la corbeille ?', body: 'Tous ses mails seront supprimés définitivement', confirm: 'Vider' }
        : { title: 'Vider les indésirables ?', body: 'Tous ces mails seront supprimés définitivement', confirm: 'Vider' }
    }
    const count = confirmation?.ids?.length ?? 1
    return count > 1
      ? { title: `Supprimer ces ${count} mails définitivement ?`, body: 'Ils ne pourront pas être récupérés', confirm: 'Supprimer' }
      : { title: 'Supprimer ce mail définitivement ?', body: 'Il ne pourra pas être récupéré', confirm: 'Supprimer' }
  })()

  // A folder pill's own menu: all its mails read; the trash and the junk
  // folder emptied for good (asked first).
  const pillMenuItems = (() => {
    const folder = pillMenu && folders?.find((entry) => entry.id === pillMenu.folderId)
    if (!folder) return []
    const unread = folder.id === state.folder && Number.isFinite(state.unreadCount) ? state.unreadCount : folder.unread
    const isEmpty = folder.count === 0 && !(folder.id === state.folder && state.messages.length)
    return [
      { id: 'read-all', label: 'Tout marquer comme lu', icon: 'carbon:email', disabled: !(unread > 0), onSelect: () => markFolderRead(folder.id) },
      ...(folder.kind === 'trash' || folder.kind === 'junk' ? [
        'separator',
        {
          id: 'empty',
          label: folder.kind === 'trash' ? 'Vider la corbeille' : 'Vider les indésirables',
          icon: 'carbon:trash-can',
          destructive: true,
          disabled: isEmpty,
          onSelect: () => setConfirmation({ kind: 'empty', folder: folder.id }),
        },
      ] : []),
    ]
  })()

  // A row's swipe actions on a touch screen (SwipeableRow), as Apple Mail's,
  // each from the row's edge inwards: to the right, read or unread (a long
  // swipe toggles it); to the left, delete (a long swipe deletes, outside
  // the trash), the flag, junk (or out of it, in the junk folder). The same
  // as the right-click menu, which a long press opens for the rest.
  const getRowSwipeActions = (message) => {
    const ids = [message.id]
    return {
      leading: [
        {
          id: 'unread',
          label: message.unread ? 'Lu' : 'Non lu',
          icon: message.unread ? 'carbon:email' : 'carbon:email-new',
          tone: 'blue',
          full: true,
          onSelect: () => setMessagesFlag(ids, 'unread', !message.unread),
        },
      ],
      trailing: [
        // In the trash, back to the inbox instead (gone for good is in the
        // long press's menu: it asks first, which a swipe can't).
        ...(folderKind === 'trash' ? [
          { id: 'restore', label: 'Restaurer', icon: 'carbon:undo', tone: 'blue', full: true, removes: true, onSelect: () => removeMessages(ids, 'restore') },
        ] : [
          { id: 'trash', label: 'Supprimer', icon: 'carbon:trash-can', tone: 'red', full: true, removes: true, onSelect: () => removeMessages(ids, 'trash') },
        ]),
        {
          id: 'flag',
          label: message.flagged ? 'Sans drapeau' : 'Drapeau',
          icon: message.flagged ? 'carbon:flag' : 'carbon:flag-filled',
          tone: 'orange',
          onSelect: () => setMessagesFlag(ids, 'flagged', !message.flagged),
        },
        folderKind === 'junk'
          ? { id: 'not-spam', label: 'Pas indésirable', icon: 'carbon:checkmark-outline', tone: 'gray', removes: true, onSelect: () => removeMessages(ids, 'inbox') }
          : { id: 'spam', label: 'Indésirable', icon: 'carbon:misuse-outline', tone: 'gray', removes: true, onSelect: () => removeMessages(ids, 'spam') },
      ],
    }
  }

  // Rows sliding open or shut as mails come in (a refresh, « Annuler ») or
  // go (deleted, junk).
  // A folder switch swaps the whole list (a fade), not row by row.
  const { entries: listEntries, onSettled: onListEntrySettled } = useListTransitions(visibleMessages, getMessageKey, state.folder)

  // Highlighted rows: the selection, else the open mail (or the one a right
  // click is about). Selected neighbours join into one block.
  const rowSelected = listEntries.map(({ item: message, state: transition }) => transition !== 'exit' && message.id != null && (isMultiple
    ? selection.includes(message.id)
    : message.id === openId || (contextMenu?.ids.length === 1 && contextMenu.ids[0] === message.id)))

  const webmailHref = state.webmailHref || storedWebmailHref

  return (
    <section
      ref={sectionRef}
      className={`relative w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-0 max-md:px-3 max-md:pt-5 max-md:pb-5 ${isResizingReader ? '' : '4xl:transition-[padding-right] 4xl:duration-[340ms] 4xl:ease-[cubic-bezier(0.32,0.72,0,1)]'} ${openId || isMultiple ? '4xl:pr-[calc(var(--mail-reader-width)+24px)]' : ''}`}
      style={{ '--mail-reader-width': readerWidthCss(readerWidth) }}
      aria-labelledby="mail-page-title" aria-busy={state.status === 'loading' || undefined}>
      {/* Under 1024 px the reader takes the list's place; above, it sits in
          a panel on the right, drawn as the sidebar (display: contents drops
          the panel's box on the narrow screens). */}
      {panelId || isMultiple ? (
        <div
          ref={panelRef}
          className={`mail-reader-panel card-corners border max-4xl:contents 4xl:fixed 4xl:top-3 4xl:right-3 4xl:bottom-3 4xl:z-30 4xl:w-[var(--mail-reader-width)] 4xl:overflow-y-auto 4xl:overscroll-contain 4xl:p-5 ${isPanelClosing ? 'is-closing max-4xl:hidden' : ''}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && isPanelClosing) setPanelId(null)
          }}
        >
          {/* Over the panel's top as it scrolls; on a phone, floating just
              above the tab bar (App's page column then leaves room for both
              under the mail's end). */}
          <MailToolbar
            className="mail-toolbar-veil pointer-events-none max-4xl:fixed max-4xl:inset-x-0 max-4xl:bottom-[calc(env(safe-area-inset-bottom)+90px)] max-4xl:z-30 max-4xl:justify-center max-4xl:px-4 max-4xl:animate-modal-card-in 4xl:sticky 4xl:top-0 4xl:z-10 4xl:mb-5"
            message={isPanelClosing ? null : targetState}
            multiple={isMultiple}
            folderKind={folderKind}
            onCompose={() => void startCompose('new')}
            onReply={() => void startCompose('reply')}
            onReplyAll={() => void startCompose('reply-all')}
            onForward={() => void startCompose('forward')}
            onTrash={() => removeMessages(targetIds, 'trash')}
            onSpam={() => removeMessages(targetIds, folderKind === 'junk' ? 'inbox' : 'spam')}
            onRestore={() => removeMessages(targetIds, 'restore')}
            onDeleteForever={() => setConfirmation({ kind: 'delete', ids: targetIds })}
            onMove={(event) => openFolderMenu('move', event.currentTarget.getBoundingClientRect(), targetIds)}
            onToggleUnread={() => setMessagesFlag(targetIds, 'unread', !targetState?.unread)}
            onToggleFlag={() => setMessagesFlag(targetIds, 'flagged', !targetState?.flagged)}
          />
          {/* On a phone the list (and its notice) is hidden behind the
              reader: the notice over the mail then. Beside the list, the
              list's own is in view. */}
          {isSessionExpired && !isPanelClosing ? <MailSessionNotice className="4xl:hidden" onSignInAgain={onSignInAgain} /> : null}
          {isMultiple ? (
            <MailSelection count={selection.length} onClear={() => setSelectedIds([])} />
          ) : panelId ? (
            // Keyed: each mail comes in afresh (its fade, .mail-reader-enter).
            <MailThread
              key={panelId}
              id={panelId}
              folder={folderId}
              backLabel={folders?.find((folder) => folder.id === folderId) ? getFolderLabel(folders.find((folder) => folder.id === folderId)) : 'Réception'}
              webmailHref={webmailHref}
              onBack={isPanelClosing ? noop : closeMail}
              onLoaded={(messages) => handleThreadLoaded(panelId, messages)}
            />
          ) : null}
        </div>
      ) : null}
      {openId || isMultiple ? (
        <MailReaderResizeHandle width={readerWidth} onWidthChange={handleReaderWidthChange} onResizingChange={setIsResizingReader} />
      ) : null}

      <div className={openId || isMultiple ? 'contents max-4xl:hidden' : 'contents'}>
      {/* Above the page's top: the header is stuck once it's scrolled past. */}
      <span ref={headerSentinelRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true" />

      {/* Held at the top as the list scrolls, over a progressive blur (the
          class sheet's, .gd-header-blur) once something passes under it. It
          takes the section's top padding inside (a negative margin back), so
          it keeps it when stuck: at 4xl 33px, level with the reader's
          toolbar (the panel's 12px inset, 1px border and 20px padding). */}
      <div className={`gd-header ${hasOpenedMail ? 'mail-pop-in' : ''} sticky top-0 z-20 -mx-6 -mt-4 grid gap-4 px-6 pt-4 max-md:-mx-3 max-md:-mt-5 max-md:px-3 max-md:pt-5 4xl:mt-0 4xl:pt-[33px] ${isHeaderStuck ? 'is-stuck' : ''}`}>
      <span className="gd-header-blur" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </span>
      {/* The title folds away while searching (the field's focus — not the
          refresh button's — or text in it), the field taking the row. */}
      {/* Above the folder pills (z-10): the refresh button's glass makes its
          own stacking context, so its tooltip couldn't rise over them. */}
      <div className="group relative z-10 flex min-w-0 items-center" data-searching={query ? '' : undefined}>
        <h1
          id="mail-page-title"
          className="m-0 shrink-0 overflow-hidden whitespace-nowrap max-w-[220px] mr-4 max-md:mr-3 leading-[1.15] text-2xl font-bold max-md:text-[22px] max-md:tracking-[-0.01em] transition-[max-width,margin,opacity] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-has-[input:focus]:max-w-0 group-has-[input:focus]:mr-0 group-has-[input:focus]:opacity-0 group-data-searching:max-w-0 group-data-searching:mr-0 group-data-searching:opacity-0"
        >
          Messagerie
        </h1>
        <MailSearchField value={query} onChange={setQuery} className="flex-1" />
        <button
          type="button"
          className="mobile-tab-bar group relative ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text-muted cursor-pointer transition-[color] duration-150 hover:text-text disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text/20"
          aria-label="Actualiser"
          aria-busy={isRefreshing || undefined}
          disabled={isRefreshing}
          onClick={() => void refresh()}
        >
          <Icon icon="carbon:renew" className={`size-[18px] ${isRefreshing ? 'mail-refresh-spin' : ''}`} aria-hidden="true" />
          <Tooltip title="Actualiser" side="bottom-end" className="max-4xl:hidden" />
        </button>
        {/* On a phone the only way to a new mail (the reader's toolbar is
            about the open one there). From 4xl, hidden while the reader's
            panel is open: its toolbar has the same button. */}
        <button
          type="button"
          className={`mobile-tab-bar group relative ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text/20 ${openId || isMultiple ? '4xl:hidden' : ''}`}
          aria-label="Nouveau message"
          onClick={() => void startCompose('new')}
        >
          <Icon icon="carbon:edit" className="size-[18px]" aria-hidden="true" />
          <Tooltip title="Nouveau message" side="bottom-end" className="max-4xl:hidden" />
        </button>
      </div>

      {folders?.length > 1 ? (
        <MailFolderPills
          folders={folders}
          currentId={folderId}
          // The shown folder's count, fresher than the folders' (read, unread).
          currentUnread={Number.isFinite(state.unreadCount) ? state.unreadCount : null}
          onSelect={selectFolder}
          onOpenMenu={(rect) => openFolderMenu('folders', rect)}
          onFolderMenu={handleFolderPillMenu}
        />
      ) : null}
      </div>

      {/* Over the list already loaded, which stays to be read (with no list,
          the whole-page state below says it instead). */}
      {isSessionExpired && state.status === 'ok' ? <MailSessionNotice onSignInAgain={onSignInAgain} /> : null}

      {state.status === 'loading' ? <MailListPlaceholder /> : null}

      {state.status === 'ok' && visibleMessages.length === 0 && isSearching && !isSearchPending ? (
        <p className="m-0 py-10 text-center text-[14px] font-medium text-text-muted" role="status">Aucun mail ne correspond</p>
      ) : null}

      {/* The trash and the junk folder can be emptied for good from here (and
          from their pill's menu), once asked. */}
      {state.status === 'ok' && (listFolderKind === 'trash' || listFolderKind === 'junk') && state.messages.length > 0 && !isSearching && !isFolderSwitching ? (
        <div className="flex justify-end -mb-2">
          <button
            type="button"
            className="material inline-flex h-8 items-center gap-1.5 rounded-full px-3 cursor-pointer"
            onClick={() => setConfirmation({ kind: 'empty', folder: state.folder })}
          >
            {/* The red on the icon and the text: .material sets the button's
                colour outside Tailwind's layers. */}
            <Icon icon="carbon:trash-can" className="size-[14px] shrink-0 text-[#d1342f] dark:text-[#ff6b63]" aria-hidden="true" />
            <span className="text-[13px] font-semibold leading-none text-[#d1342f] dark:text-[#ff6b63]">{listFolderKind === 'trash' ? 'Vider la corbeille' : 'Vider les indésirables'}</span>
          </button>
        </div>
      ) : null}

      {state.status === 'ok' && visibleMessages.length > 0 ? (
        <div className={`${hasOpenedMail ? 'mail-pop-in' : ''} grid min-w-0`}>
          <ul
            key={state.folder}
            className={`mail-list-swap m-0 p-0 list-none grid transition-opacity duration-200 ease-out ${isFolderSwitching ? 'pointer-events-none opacity-40' : ''}`}
            aria-label={folders?.find((folder) => folder.id === state.folder) ? getFolderLabel(folders.find((folder) => folder.id === state.folder)) : 'Boîte de réception'}
            aria-busy={isFolderSwitching || undefined}
          >
            {listEntries.map(({ key, item: message, state: transition }, index) => (
              <MailListItem
                key={key}
                message={message}
                fallbackHref={webmailHref}
                now={now}
                onOpen={handleRowClick}
                onContextMenu={handleRowContextMenu}
                swipeActions={message.id ? getRowSwipeActions(message) : null}
                onHover={handleRowHover}
                showRecipient={folderKind === 'sent' || folderKind === 'drafts'}
                selected={rowSelected[index]}
                joinTop={rowSelected[index] && rowSelected[index - 1]}
                joinBottom={rowSelected[index] && rowSelected[index + 1]}
                transition={transition}
                onSettled={() => onListEntrySettled(key)}
              />
            ))}
          </ul>
          {listHasMore ? (
            <div ref={listEndRef} className="flex min-h-14 items-center justify-center gap-3 border-t border-border py-4 text-text-muted">
              {moreStatus === 'error' ? (
                <>
                  <span className="text-[13px] font-medium">Les mails plus anciens n’ont pas chargé</span>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center px-3 py-2 border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text-secondary cursor-pointer transition-[background-color] duration-120 ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text"
                    onClick={() => setMoreStatus('idle')}
                  >
                    {/* The font on a span: index.css gives buttons `font: inherit`, outside Tailwind's layers. */}
                    <span className="text-[13px] font-medium leading-none">Réessayer</span>
                  </button>
                </>
              ) : (
                <LoadingDots label="Chargement des mails plus anciens" />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {isSearchPending && state.status === 'ok' ? (
        <div className="mail-skeleton-delayed flex min-h-14 items-center justify-center text-text-muted">
          <LoadingDots label={getSearchingLabel(folderId, folders)} />
        </div>
      ) : null}

      {isSearchFailed && state.status === 'ok' ? (
        <p className="m-0 py-3 text-center text-[13px] font-medium text-text-muted" role="status">La recherche n’a porté que sur les mails déjà chargés</p>
      ) : null}

      {state.status === 'ok' && state.messages.length === 0 && !isSearching ? (
        // Of the folder whose list it stands for, dimmed as that list while
        // another loads.
        <div key={state.folder} className={`mail-list-swap transition-opacity duration-200 ease-out ${isFolderSwitching ? 'opacity-40' : ''}`}>
          <PageEmptyState icon="carbon:checkmark-outline" title="Aucun mail">{listFolderKind === 'inbox' ? 'Ta boîte de réception est vide' : 'Ce dossier est vide'}</PageEmptyState>
        </div>
      ) : null}

      {/* No list to keep: an expired session (said so, with the way back
          in) or the mail not answering. A failed first load counts as the
          former when another mail route said the session is gone. */}
      {state.status === 'unauthenticated' || (state.status === 'error' && isSessionExpired) ? (
        <PageEmptyState
          icon="carbon:locked"
          title="Session expirée"
          action={onSignInAgain ? <SignInAgainButton onClick={onSignInAgain} /> : null}
        >
          Reconnecte-toi pour retrouver tes mails
        </PageEmptyState>
      ) : state.status === 'error' || state.status === 'disabled' ? (
        <PageEmptyState icon="carbon:email" title="Mails indisponibles">La messagerie ne répond pas, réessaie dans un moment</PageEmptyState>
      ) : null}
      </div>

      <MailToast toast={toast} onExpire={() => setToast(null)} readerOpen={Boolean(openId) || isMultiple} />
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.ids.length > 1 ? `${contextMenu.ids.length} mails` : null}
          label={contextMenu.ids.length > 1 ? `Actions pour ${contextMenu.ids.length} mails` : 'Actions pour ce mail'}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}
      {folderMenu ? (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          above={folderMenu.above}
          title={folderMenu.kind === 'move' ? 'Déplacer vers' : 'Dossiers'}
          label={folderMenu.kind === 'move' ? 'Déplacer vers un dossier' : 'Dossiers'}
          items={folderMenuItems}
          onClose={closeFolderMenu}
        />
      ) : null}
      {pillMenu && pillMenuItems.length ? (
        <ContextMenu
          x={pillMenu.x}
          y={pillMenu.y}
          title={folders?.find((folder) => folder.id === pillMenu.folderId) ? getFolderLabel(folders.find((folder) => folder.id === pillMenu.folderId)) : null}
          label="Actions du dossier"
          items={pillMenuItems}
          onClose={closePillMenu}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmationText.title}
        confirmLabel={confirmationText.confirm}
        destructive
        onConfirm={confirmPending}
        onCancel={cancelConfirmation}
      >
        {confirmationText.body}
      </ConfirmDialog>
      {composer ? (
        <Suspense fallback={null}>
          <MailComposer
            key={composer.key}
            initialKind={composer.kind}
            message={composer.message}
            sender={sender}
            attachmentLimits={attachmentLimits}
            ref={composerApiRef}
            onClose={closeComposer}
          />
        </Suspense>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingCompose)}
        title="Supprimer le brouillon ?"
        confirmLabel="Supprimer"
        destructive
        onConfirm={confirmPendingCompose}
        onCancel={cancelPendingCompose}
      >
        Le message en cours sera remplacé
      </ConfirmDialog>
    </section>
  )
}

export default MailPage
