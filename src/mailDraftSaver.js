import { buildComposePayload, draftStateKey } from './mailSendPayload.js'

// One draft's saves to the webmail's Drafts folder (POST
// /__ent_auth/mail/draft), for a composer and what comes after it: MailPage
// makes one when a composer opens and keeps it while the mail is being
// sent (src/useMailSend.js), so the composer reopened after an undo or a
// failure saves over the same draft, and a send replaces it (did).
//
// Saves go one after the other, never two at once; one whose content is
// what the last save had (draftStateKey) doesn't go. Once saved, the
// draft's files are parts of it (Zimbra deletes an upload once used): the
// saver keeps, by item key, the part each became (`refs`), which the next
// save and the send name instead (buildComposePayload). `listener(status,
// failure)`: 'saving', 'saved' or 'error', for the composer's quiet line,
// with the failed save's result (saveMailDraft's: an 'upload-expired' one
// names the files to attach again, `aids`). `save(body)`
// and `discardDraft(id)`: the requests (entApi's saveMailDraft, mailAction
// 'discard'), given by src/useMailSend.js.
export function createDraftSaver({ draftId = null, refs = null, save, discardDraft }) {
  let id = draftId
  let savedKey = null
  let status = draftId ? 'saved' : 'idle'
  let chain = Promise.resolve()
  let discarded = false
  const partRefs = new Map(refs ?? [])
  const listeners = new Set()

  const setStatus = (next, failure = null) => {
    status = next
    for (const listener of listeners) listener(next, failure)
  }

  async function run(state) {
    if (discarded) return
    const key = draftStateKey(state)
    if (key === savedKey) return
    const ready = state.attachments.filter((item) => item.status === 'ready')
    setStatus('saving')
    const result = await save(buildComposePayload(state, { refs: partRefs, draftId: id }))
    if (discarded) {
      // Discarded while it was being saved: the draft it made goes too.
      if (result.status === 'ok') void discardDraft(result.draft.id)
      return
    }
    if (result.status !== 'ok') {
      setStatus('error', result)
      return
    }
    id = result.draft.id
    savedKey = key
    result.draft.attachments.forEach((reference, index) => {
      if (reference && ready[index]) partRefs.set(ready[index].key, reference)
    })
    setStatus('saved')
  }

  return {
    get id() {
      return id
    },
    get status() {
      return status
    },
    refs: partRefs,
    // Whether `state` is what the last save had.
    isSaved: (state) => savedKey !== null && draftStateKey(state) === savedKey,
    // Saves `state` after any save still going; resolves once done.
    save(state) {
      chain = chain.then(() => run(state)).catch(() => setStatus('error'))
      return chain
    },
    whenIdle: () => chain,
    // A draft resumed as it was saved: nothing to save until it changes.
    markSaved(state) {
      savedKey = draftStateKey(state)
    },
    // The send's body: the draft's id (replaced once sent) and its parts.
    buildSendPayload: (state, sendUid) => buildComposePayload(state, { refs: partRefs, draftId: id, sendUid }),
    // Sent: the draft is gone with it (did), nothing more to save.
    close() {
      discarded = true
    },
    // « Supprimer »: the saved draft deleted (after a save still going).
    async discard() {
      discarded = true
      await chain
      if (id) await discardDraft(id)
      id = null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
