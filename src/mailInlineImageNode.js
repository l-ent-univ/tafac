import { Node, ReactNodeViewRenderer } from '@tiptap/react'
import MailInlineImageView from './components/MailInlineImageView'

// An image inside the composer's text (src/mailInlineImages.js): one block,
// a reference to the composer's item by its cid, never a source (the HTML
// has no src: the server puts the part's cid: in its place). Removed like
// any block (selected, Backspace) or by its own button.
export const MailInlineImage = Node.create({
  name: 'mailInlineImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    const number = (name) => ({
      default: null,
      parseHTML: (element) => Number(element.getAttribute(name)) || null,
      renderHTML: (attributes) => (attributes[name] ? { [name]: String(attributes[name]) } : {}),
    })
    return {
      cid: { default: null, parseHTML: (element) => element.getAttribute('data-inline-cid'), renderHTML: (attributes) => ({ 'data-inline-cid': attributes.cid }) },
      alt: { default: '', parseHTML: (element) => element.getAttribute('alt') ?? '', renderHTML: (attributes) => (attributes.alt ? { alt: attributes.alt } : {}) },
      width: number('width'),
      height: number('height'),
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-inline-cid]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MailInlineImageView)
  },
})
