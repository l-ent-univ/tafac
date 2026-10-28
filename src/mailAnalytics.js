// Anonymous analytics of the Messagerie (see docs/ANALYTICS.md): what the
// page reports, boiled down to the enums the server's allowlist
// (server/analyticsSchema.js) lets through. Pure, see
// tests/mailAnalytics.test.js.
//
// Never a subject, an address, a name, a folder's name, a search text, a
// file name, a message id nor a count beyond the buckets: only how the
// student got there, how the list loaded, and what was done.

// How the student arrived on the page (page_viewed's `source`).
// - nav / tabbar: the sidebar item, the phone's tab bar;
// - tile: the webmail's app in the app lists;
// - dashboard_card: the dashboard's « Mails récents »;
// - launch_card: the Messagerie's announcement under the widgets;
// - grades: « Écrire au sujet de cette note » (« Mes notes »);
// - history: back, forward or a reload landing on the page.
export const MAIL_PAGE_SOURCES = ['nav', 'tabbar', 'tile', 'dashboard_card', 'launch_card', 'grades', 'history', 'other']

export function toMailPageSource(source) {
  return MAIL_PAGE_SOURCES.includes(source) ? source : 'other'
}

const ERROR_KINDS = ['http_4xx', 'http_5xx', 'network', 'timeout', 'other']

// mail_loaded for the folder the page opens on, from the list's state
// ({ status, messages }, MailPage's): null while it loads (or when the mail
// is off), else { status, errorKind? }. `sessionExpired`: a mail route said
// the session is gone, which is why a list failed.
export function describeMailLoad({ status, messageCount = 0, errorKind = null, sessionExpired = false } = {}) {
  if (status === 'ok') return { status: messageCount > 0 ? 'ok' : 'empty' }
  if (status === 'unauthenticated') return { status: 'session_expired' }
  if (status === 'error') {
    if (sessionExpired) return { status: 'session_expired' }
    return { status: 'error', errorKind: ERROR_KINDS.includes(errorKind) ? errorKind : 'other' }
  }
  return null
}

// A folder as the analytics name it: the system ones by kind, any other
// is just `folder` (never its name).
const FOLDER_KINDS = ['inbox', 'sent', 'drafts', 'junk', 'trash']

export function toFolderKind(kind) {
  return FOLDER_KINDS.includes(kind) ? kind : 'folder'
}

// The composer's kinds as the analytics name them.
const COMPOSE_KINDS = { new: 'new', reply: 'reply', 'reply-all': 'reply_all', forward: 'forward', draft: 'draft', grade: 'grade' }

export function toComposeKind(kind) {
  return Object.hasOwn(COMPOSE_KINDS, kind) ? COMPOSE_KINDS[kind] : 'new'
}

// A number of files, in buckets.
export function getAttachmentsBucket(count) {
  if (!(count >= 1)) return '0'
  if (count === 1) return '1'
  if (count <= 3) return '2-3'
  return '4+'
}

// A send's outcome for mail_action `sent` — `outcome`: 'sent' (the result
// of sendMail, `partial` when some recipients were refused), 'failed', or
// 'undone' (taken back within the « Annuler » time). `snapshot`: the
// composer as it was sent (state.attachments, state.inlineImages).
export function describeSend(outcome, snapshot, result = null) {
  const result_ = outcome === 'undone' ? 'undone' : outcome === 'failed' ? 'error' : result?.partial ? 'partial' : 'ok'
  const attachments = Array.isArray(snapshot?.state?.attachments) ? snapshot.state.attachments.filter((item) => item.status === 'ready') : []
  const inlineImages = Array.isArray(snapshot?.state?.inlineImages) ? snapshot.state.inlineImages : []
  return {
    result: result_,
    attachments: getAttachmentsBucket(attachments.length),
    inline_images: inlineImages.length > 0,
  }
}

// How an action was triggered (`via`).
export const MAIL_ACTION_VIAS = ['toolbar', 'context_menu', 'swipe', 'keyboard']

export function toMailVia(via) {
  return MAIL_ACTION_VIAS.includes(via) ? via : null
}

// The page's removeMessages actions as the analytics name them. « Pas
// indésirable » (`inbox`) is a restore to the inbox.
const REMOVE_ACTIONS = { trash: 'trash', spam: 'spam', inbox: 'restore', restore: 'restore', move: 'move', delete: 'delete_forever' }

export function toRemoveAction(action) {
  return Object.hasOwn(REMOVE_ACTIONS, action) ? REMOVE_ACTIONS[action] : null
}

// Reports once per burst of typing rather than once per keystroke: the
// search is reported `delayMs` after the last change, with the scope the
// text had by then ('local' while it only filters the loaded mails,
// 'server' once the server is asked too). An emptied field reports nothing.
// `send(scope)`.
export function createSearchReporter(send, {
  delayMs = 1200,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  let timer = null

  const cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const report = (scope) => {
    cancel()
    if (!scope) return
    timer = setTimer(() => {
      timer = null
      send(scope)
    }, delayMs)
  }

  return { report, cancel }
}
