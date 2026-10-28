import { useEffect, useRef } from 'react'
import { mailAction, saveMailDraft, sendMail } from './entApi'
import { createDraftSaver } from './mailDraftSaver'
import { createSendUid } from './mailSendPayload'
import { createMailSendQueue } from './mailSendQueue'

export { UNDO_SEND_MS } from './mailSendQueue'

// A composer's draft saves (src/mailDraftSaver.js), with the app's requests.
export function newDraftSaver(options = {}) {
  return createDraftSaver({
    ...options,
    save: saveMailDraft,
    discardDraft: (id) => mailAction(id, 'discard'),
  })
}

// The app's one send queue (src/mailSendQueue.js), outliving the mail page.
const queue = createMailSendQueue({ sendMail, createSendUid })
const pageSends = { send: queue.send, undo: queue.undo }

// The tab closing while a mail waits or goes: the browser asks first.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!queue.busy) return
    event.preventDefault()
    event.returnValue = ''
  })
}

// For App's logout: the mail waiting goes first (null), or its failure is
// shown on the mail page instead of the mail being lost (src/mailSendQueue.js).
export const flushMailSends = () => queue.flush()
// Logged out or another student signed in (App, as clearMailReadCache).
export const clearMailSends = () => queue.clear()

// The mail page's sends (src/mailSendQueue.js), its handlers attached while
// it's mounted: `notify(text, options)` its notice, `reopen(snapshot,
// error)`, `onSent(snapshot, result)`. → { send, undo }.
export function useMailSend({ notify, reopen, onSent }) {
  const handlersRef = useRef({ notify, reopen, onSent })
  useEffect(() => {
    handlersRef.current = { notify, reopen, onSent }
  })
  useEffect(() => queue.attach({
    notify: (...args) => handlersRef.current.notify(...args),
    reopen: (...args) => handlersRef.current.reopen(...args),
    onSent: (...args) => handlersRef.current.onSent?.(...args),
  }), [])
  return pageSends
}
