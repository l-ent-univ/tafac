import { useCallback, useEffect, useRef } from 'react'
import { mailAction, saveMailDraft, sendMail } from './entApi'
import { createDraftSaver } from './mailDraftSaver'
import { createSendUid } from './mailSendPayload'

// The time to take a send back (« Annuler » in the notice), as Apple Mail's
// « Annuler l'envoi »: nothing leaves before it's over.
export const UNDO_SEND_MS = 5000
// A send whose answer never came (the network, not the server) is tried
// once more after this, with the same uid: Zimbra won't send it twice.
const SEND_RETRY_DELAY_MS = 1500

// A composer's draft saves (src/mailDraftSaver.js), with the app's requests.
export function newDraftSaver(options = {}) {
  return createDraftSaver({
    ...options,
    save: saveMailDraft,
    discardDraft: (id) => mailAction(id, 'discard'),
  })
}

// The mail page's sends. `send(snapshot)` (MailComposer's onSend: the
// composer as it was, its `saver` and its draft `state`): the composer
// closes, the draft is saved at once (a tab closed during the wait loses
// nothing: it's in Brouillons), the notice says « Envoi… » with
// « Annuler » for UNDO_SEND_MS, then the mail goes (the draft's parts and
// id, replaced once sent). « Annuler » reopens the composer as it was. A
// failure reopens it too, with why (`reopen(snapshot, error)`). One send
// waits at a time: `send` answers false for another meanwhile. Leaving the
// page during the wait sends it at once; closing the tab asks first.
// `notify(text, options)`: MailPage's notice; `onSent(snapshot, result)`.
export function useMailSend({ notify, reopen, onSent }) {
  const pendingRef = useRef(null)
  const handlersRef = useRef({ notify, reopen, onSent })
  useEffect(() => {
    handlersRef.current = { notify, reopen, onSent }
  })

  const deliver = useCallback(async (pending) => {
    pending.phase = 'sending'
    window.clearTimeout(pending.timer)
    handlersRef.current.notify('Envoi…', { busy: true })
    const { snapshot } = pending
    await snapshot.saver.whenIdle()
    const payload = snapshot.saver.buildSendPayload(snapshot.state, pending.sendUid)
    let result = await sendMail(payload)
    if (result.status === 'error' && result.code === 'network') {
      await new Promise((resolve) => window.setTimeout(resolve, SEND_RETRY_DELAY_MS))
      result = await sendMail(payload)
    }
    if (pendingRef.current === pending) pendingRef.current = null
    if (result.status === 'ok') {
      snapshot.saver.close()
      handlersRef.current.notify(result.partial ? 'Envoyé, sauf à une adresse refusée' : 'Message envoyé')
      handlersRef.current.onSent?.(snapshot, result)
      return
    }
    handlersRef.current.notify(null)
    handlersRef.current.reopen(snapshot, result)
  }, [])

  const undo = useCallback(() => {
    const pending = pendingRef.current
    if (!pending || pending.phase !== 'waiting') return
    window.clearTimeout(pending.timer)
    pendingRef.current = null
    handlersRef.current.notify(null)
    handlersRef.current.reopen(pending.snapshot, null)
  }, [])

  const send = useCallback((snapshot) => {
    if (pendingRef.current) return false
    const pending = { snapshot, sendUid: createSendUid(), phase: 'waiting', timer: null }
    pendingRef.current = pending
    void snapshot.saver.save(snapshot.state)
    pending.timer = window.setTimeout(() => void deliver(pending), UNDO_SEND_MS)
    handlersRef.current.notify('Envoi…', { onUndo: undo, duration: UNDO_SEND_MS, steady: true })
    return true
  }, [deliver, undo])

  // The tab closing while a mail waits or goes: the browser asks first.
  useEffect(() => {
    const guard = (event) => {
      if (!pendingRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  // The page left while a mail waits: it goes now (as it would have).
  useEffect(() => () => {
    const pending = pendingRef.current
    if (pending?.phase === 'waiting') void deliver(pending)
  }, [deliver])

  return { send, undo }
}
