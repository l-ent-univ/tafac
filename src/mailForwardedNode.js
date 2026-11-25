import { Node, ReactNodeViewRenderer } from '@tiptap/react'
import MailForwardedView from './components/MailForwardedView'

// The mail a forward sends on, as it was: one block at the end of the text,
// shown (MailForwardedView) but not typed into. Its HTML, styles and all,
// never enters the editor, which would keep only its text: the server puts
// it in the mail in place of this placeholder (server/mailSend.js's
// buildMailHtml), read again from the mailbox.
export const MailForwarded = Node.create({
  name: 'mailForwarded',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  parseHTML() {
    // Before the blockquote it is one of.
    return [{ tag: 'blockquote[data-forwarded-mail]', priority: 100 }]
  },

  renderHTML() {
    return ['blockquote', { 'data-forwarded-mail': '' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MailForwardedView)
  },
})
