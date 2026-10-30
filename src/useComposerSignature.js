import { useEffect, useMemo, useRef } from 'react'
import { pickShownSignature } from './mailSignatureChoice'
import { setMailSignatureEnabled, useMailSignaturePrefs, useMailSignatures } from './mailSignatureStore'

// The composer's signature: the choices of Réglages › Messagerie (shared,
// src/mailSignatureStore.js), what the text shows of it, what a send names.
// `autoSignature`: the automatic one's lines (App's sender.signature; none
// without a name). `identityId`, `reply`: the draft's « De : » and whether
// it answers a mail (the webmail's reply signature then).
// → { on, kind, available, value (MailSignatureContext's), setOn, payload }.
export function useComposerSignature({ autoSignature, identityId, reply }) {
  const { enabled, kind } = useMailSignaturePrefs()
  // The automatic one needs its lines; the student's own always has a
  // place (an empty one says so in the text, nothing goes).
  const available = kind !== 'auto' || Boolean(autoSignature)
  const on = enabled && available
  const remote = useMailSignatures({ enabled: kind !== 'auto' })
  const shown = kind === 'auto' ? null : pickShownSignature(remote.data, kind, { identityId, reply })
  const status = remote.status
  const value = useMemo(() => (available ? {
    kind,
    auto: autoSignature,
    own: { status, signature: shown },
  } : null), [available, kind, autoSignature, status, shown])
  // Only the kind and the automatic one's two short choices: the server
  // builds the signature, or reads the student's own from the webmail.
  const payload = useMemo(() => ({
    include: on,
    mode: kind,
    ...(kind === 'auto' ? { group: autoSignature?.group ?? '', establishment: autoSignature?.establishmentId ?? '' } : null),
  }), [on, kind, autoSignature])
  return { on, kind, available, value, setOn: setMailSignatureEnabled, payload }
}

// The signature node in or out of the editor's text as `on` changes (here
// or in Réglages): in, under the text written, above a reply's quote (before
// the blank line and the header introducing it), or at the end. Not when
// the composer opens: its text was made with it already.
export function useSignatureNodeSync(editorRef, editor, on) {
  const appliedRef = useRef(on)
  useEffect(() => {
    if (!editor || appliedRef.current === on) return
    appliedRef.current = on
    // Out of React's commit: Tiptap draws the node's view with flushSync,
    // which React refuses from inside an effect.
    queueMicrotask(() => syncSignatureNode(editorRef.current, on))
  }, [editorRef, editor, on])
}

export function syncSignatureNode(editor, on) {
  if (!editor || editor.isDestroyed) return
  const { doc } = editor.state
  const signatures = []
  let quoteIndex = -1
  let offset = 0
  doc.forEach((node, nodeOffset, index) => {
    if (node.type.name === 'mailSignature') signatures.push({ from: nodeOffset, to: nodeOffset + node.nodeSize })
    if (node.type.name === 'blockquote') quoteIndex = index
    offset = nodeOffset + node.nodeSize
  })
  if (!on) {
    if (!signatures.length) return
    const tr = editor.state.tr
    for (const range of signatures.reverse()) tr.delete(range.from, range.to)
    editor.view.dispatch(tr)
    return
  }
  if (signatures.length) return
  let at = offset
  if (quoteIndex >= 1) {
    // Before the header, and before the empty line above it if there's one.
    let headerIndex = quoteIndex - 1
    if (headerIndex >= 1 && doc.child(headerIndex - 1).type.name === 'paragraph' && doc.child(headerIndex - 1).content.size === 0) headerIndex -= 1
    at = 0
    for (let index = 0; index < headerIndex; index += 1) at += doc.child(index).nodeSize
  }
  editor.chain().insertContentAt(at, { type: 'mailSignature' }).run()
}
