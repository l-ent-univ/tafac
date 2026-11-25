import { useContext, useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { getMailMessage } from '../entApi'
import { MailForwardedContext } from '../mailForwardedContext'
import { MailBodyFrame } from './MailReader'

// The mail a forward sends on (the mailForwarded node,
// src/mailForwardedNode.js), as the reader shows it: its HTML in the
// reader's sandboxed frame, never in the composer's page. Not editable: the
// server puts it in the mail sent as it was. A resumed draft's is read again
// from the mailbox.
function MailForwardedView() {
  const value = useContext(MailForwardedContext)
  const given = value?.message?.id === value?.messageId && value?.message?.html != null ? value.message : null
  const [loaded, setLoaded] = useState({ id: null, message: null, failed: false })
  const messageId = value?.messageId ?? null

  useEffect(() => {
    if (given || !messageId) return undefined
    let cancelled = false
    getMailMessage(messageId)
      .then((message) => !cancelled && setLoaded({ id: messageId, message, failed: false }))
      .catch(() => !cancelled && setLoaded({ id: messageId, message: null, failed: true }))
    return () => {
      cancelled = true
    }
  }, [given, messageId])

  const message = given ?? (loaded.id === messageId ? loaded.message : null)
  const failed = !given && loaded.id === messageId && loaded.failed
  return (
    <NodeViewWrapper as="div" className="pt-2" contentEditable={false} data-forwarded-mail="">
      {message ? (
        <MailBodyFrame message={message} showRemoteImages={false} title="Message réexpédié" />
      ) : (
        <p className="text-[13px] text-text-muted">{failed ? 'Message réexpédié introuvable' : 'Chargement du message…'}</p>
      )}
    </NodeViewWrapper>
  )
}

export default MailForwardedView
