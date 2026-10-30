// The mail page's sends, kept at the module's level rather than in the page
// (src/useMailSend.js gives it the app's requests): a send outlives the mail
// page, so one still waiting or going when the student switches pages is
// delivered and its outcome kept for the page's return, and App can deliver
// it before logging out (flush) instead of it going, unseen, after the
// server session is gone.
//
// `send(snapshot)` (MailComposer's onSend: the composer as it was, its
// `saver` and its draft `state`): the draft is saved at once (a tab closed
// during the wait loses nothing: it's in Brouillons), the page's notice says
// « Envoi… » with « Annuler » for UNDO_SEND_MS, then the mail goes (the
// draft's parts and id, replaced once sent). « Annuler » reopens the
// composer as it was. A failure reopens it too, with why. One send waits at
// a time: `send` answers false for another meanwhile.
//
// The page attaches its handlers while mounted (`attach({ notify, reopen,
// onSent })`): `notify(text, options)` its notice, `reopen(snapshot,
// error)`, `onSent(snapshot, result)`. Leaving the page during the wait
// sends the mail at once (the « Annuler » is gone with the page); a failure
// while no page is attached is held and reopened in the composer when the
// page comes back.

// The time to take a send back (« Annuler » in the notice), as Apple Mail's
// « Annuler l'envoi »: nothing leaves before it's over.
export const UNDO_SEND_MS = 5000
// A send whose answer never came (the network, not the server) is tried
// once more after this, with the same uid: the server answers a uid it has
// already sent with its first answer, and Zimbra won't send it twice.
export const SEND_RETRY_DELAY_MS = 1500

// The notice once sent: the addresses refused named (partial: Partage took
// the mail, but not for them).
export function sentNoticeText(result) {
  if (!result?.partial) return 'Message envoyé'
  const invalid = Array.isArray(result.invalid) ? result.invalid.filter(Boolean) : []
  if (!invalid.length) return 'Envoyé, sauf à une adresse refusée'
  if (invalid.length === 1) return `Envoyé, sauf à ${invalid[0]} (adresse refusée)`
  const shown = invalid.slice(0, 3).join(', ')
  return `Envoyé, sauf à ${shown}${invalid.length > 3 ? ` et ${invalid.length - 3} autres` : ''} (adresses refusées)`
}

// `onOutcome(outcome, snapshot, result)`: 'sent' (result ok), 'failed' or
// 'undone', for the anonymous analytics (src/mailAnalytics.js).
export function createMailSendQueue({ sendMail, createSendUid, onOutcome = null, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  // { snapshot, sendUid, phase: 'waiting' | 'sending', timer, delivery }
  let pending = null
  // { snapshot, result }: a failure no page was there to show.
  let held = null
  let page = null
  // Bumped by clear(): a delivery under way when the student logs out (or
  // another one signs in) reports nothing.
  let generation = 0

  async function run(entry) {
    entry.phase = 'sending'
    clearTimer(entry.timer)
    page?.notify('Envoi…', { busy: true })
    const sentIn = generation
    const { snapshot } = entry
    await snapshot.saver.whenIdle()
    const payload = snapshot.saver.buildSendPayload(snapshot.state, entry.sendUid)
    let result = await sendMail(payload)
    if (result.status === 'error' && result.code === 'network') {
      await wait(SEND_RETRY_DELAY_MS)
      result = await sendMail(payload)
    }
    if (sentIn !== generation) return result
    if (pending === entry) pending = null
    if (result.status === 'ok') {
      onOutcome?.('sent', snapshot, result)
      snapshot.saver.close()
      page?.notify(sentNoticeText(result))
      page?.onSent?.(snapshot, result)
      return result
    }
    onOutcome?.('failed', snapshot, result)
    if (page) {
      page.notify(null)
      page.reopen(snapshot, result)
    } else {
      held = { snapshot, result }
    }
    return result
  }

  function deliver(entry) {
    entry.delivery ??= run(entry)
    return entry.delivery
  }

  function undo() {
    const entry = pending
    if (!entry || entry.phase !== 'waiting') return
    clearTimer(entry.timer)
    pending = null
    onOutcome?.('undone', entry.snapshot, null)
    page?.notify(null)
    page?.reopen(entry.snapshot, null)
  }

  function send(snapshot) {
    if (pending || held) return false
    const entry = { snapshot, sendUid: createSendUid(), phase: 'waiting', timer: null, delivery: null }
    pending = entry
    void snapshot.saver.save(snapshot.state)
    entry.timer = setTimer(() => void deliver(entry), UNDO_SEND_MS)
    page?.notify('Envoi…', { onUndo: undo, duration: UNDO_SEND_MS, steady: true })
    return true
  }

  // The mail page mounted. → detach, for its unmount.
  function attach(handlers) {
    page = handlers
    if (held) {
      const failed = held
      held = null
      handlers.reopen(failed.snapshot, failed.result)
    } else if (pending?.phase === 'sending') {
      handlers.notify('Envoi…', { busy: true })
    }
    return () => {
      if (page !== handlers) return
      page = null
      if (pending?.phase === 'waiting') void deliver(pending)
    }
  }

  // Before logging out: the mail waiting goes now, the one going is waited
  // for. → null when nothing failed, else the failure ({ status: 'error',
  // … }), which the composer shows (reopened now on the mail page, or when
  // it next mounts): App stops the logout for it rather than lose the mail.
  async function flush() {
    if (pending) {
      const result = await deliver(pending)
      return result.status === 'ok' ? null : result
    }
    return held ? held.result : null
  }

  // Logged out, or another student signed in: nothing of the previous one's
  // sends is kept, nor reported.
  function clear() {
    generation += 1
    if (pending) clearTimer(pending.timer)
    pending = null
    held = null
  }

  return {
    send,
    undo,
    attach,
    flush,
    clear,
    // A mail waiting or going (the tab's closing asks first).
    get busy() {
      return Boolean(pending)
    },
  }
}
