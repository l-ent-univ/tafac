import { Node, ReactNodeViewRenderer } from '@tiptap/react'
import MailSignatureView from './components/MailSignatureView'

// The automatic signature inside the composer's text: one block, filled in
// (MailSignatureView reads its lines from MailSignatureContext), not typed
// into. Under the student's text and above a reply's quote, as Apple Mail
// places it; the composer's « Signature » choice puts it in or takes it out.
export const MailSignature = Node.create({
  name: 'mailSignature',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-mail-signature]' }]
  },

  renderHTML() {
    return ['div', { 'data-mail-signature': '' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MailSignatureView)
  },
})
