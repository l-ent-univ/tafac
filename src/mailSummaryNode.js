import { Node } from '@tiptap/react'

// A summary box inside the composer's text (a grade's, src/gradeMail.js):
// rows of a label and its value, read and sent as text, not typed into (the
// student writes around it, or takes it out whole). In the HTML a table of
// th/td rows (server/mailSend.js styles it inline for the mail sent and
// writes it as « label : value » lines in its text version).
export const MAX_SUMMARY_ROWS = 12

// The rows of a table read back (a resumed draft: Zimbra may have dropped
// its data-mail-summary): each row's header and cell texts. Null when it
// isn't a summary's shape (a row that isn't one th and one td).
export function readSummaryRows(table) {
  const rows = []
  for (const row of table.querySelectorAll('tr')) {
    const cells = [...row.children]
    if (cells.length !== 2 || cells[0].tagName !== 'TH' || cells[1].tagName !== 'TD') return null
    const label = cells[0].textContent.replace(/\s+/g, ' ').trim()
    const value = cells[1].textContent.replace(/\s+/g, ' ').trim()
    if (label || value) rows.push({ label, value })
  }
  return rows.length && rows.length <= MAX_SUMMARY_ROWS ? rows : null
}

export const MailSummary = Node.create({
  name: 'mailSummary',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      rows: { default: [], parseHTML: (element) => readSummaryRows(element) ?? [], renderHTML: () => ({}) },
    }
  },

  parseHTML() {
    return [{ tag: 'table', getAttrs: (element) => (readSummaryRows(element) ? null : false) }]
  },

  renderHTML({ node }) {
    const rows = Array.isArray(node.attrs.rows) ? node.attrs.rows : []
    return ['table', { 'data-mail-summary': '' }, ['tbody', ...rows.map((row) => ['tr', ['th', String(row.label ?? '')], ['td', String(row.value ?? '')]])]]
  },
})
