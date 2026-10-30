import { useContext } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { MailSignatureContext } from '../mailSignatureContext'
import { signatureClassName } from '../mailSignatureChoice'
import MailSignatureContent from './MailSignatureContent'

// The signature as the text shows it (the mailSignature node,
// src/mailSignatureNode.js): the automatic one or the student's own
// (MailSignatureContent). Not editable: it's filled in, by the server too
// in the mail sent.
function MailSignatureView() {
  const value = useContext(MailSignatureContext)
  if (!value) return <NodeViewWrapper as="div" />
  return (
    <NodeViewWrapper as="div" className={signatureClassName(value)} contentEditable={false} data-mail-signature="">
      <MailSignatureContent value={value} />
    </NodeViewWrapper>
  )
}

export default MailSignatureView
