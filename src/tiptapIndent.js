import { Extension } from '@tiptap/react'

// Paragraph indentation for the mail composer (MailComposer), which Tiptap
// doesn't have: a paragraph or a heading takes an indent level, drawn as a
// left margin in steps (and read back from one, for a draft's text pasted
// or reloaded). In a list, the format bar nests items instead (Tiptap's own
// sinkListItem / liftListItem); here, the text around lists.

export const INDENT_STEP_PX = 32
export const MAX_INDENT = 6
const INDENTED_TYPES = ['paragraph', 'heading']

// Each indentable block the selection touches, one step in or out, within
// 0…MAX_INDENT. Whether any of them can move (a dry run when there's no
// dispatch, for the button's state).
function shiftIndent(delta) {
  return ({ state, tr, dispatch }) => {
    const { from, to } = state.selection
    let changed = false
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!INDENTED_TYPES.includes(node.type.name)) return true
      const current = node.attrs.indent ?? 0
      const next = Math.max(0, Math.min(MAX_INDENT, current + delta))
      if (next !== current) {
        changed = true
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
      }
      return false
    })
    return changed
  }
}

export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: INDENTED_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Math.max(0, Math.min(MAX_INDENT, Math.round((parseFloat(element.style.marginLeft) || 0) / INDENT_STEP_PX))),
            renderHTML: (attributes) => (attributes.indent ? { style: `margin-left: ${attributes.indent * INDENT_STEP_PX}px` } : {}),
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      indent: () => shiftIndent(1),
      outdent: () => shiftIndent(-1),
    }
  },

  // As Apple Mail's: ⌘] in, ⌘[ out (in a list, its items).
  addKeyboardShortcuts() {
    const run = (inList, outside) => () => (this.editor.isActive('listItem') ? inList() : outside())
    return {
      'Mod-]': run(() => this.editor.commands.sinkListItem('listItem'), () => this.editor.commands.indent()),
      'Mod-[': run(() => this.editor.commands.liftListItem('listItem'), () => this.editor.commands.outdent()),
    }
  },
})
