import { createElement, Fragment, useMemo } from 'react'

// A webmail signature's HTML, drawn in the app's own page (the composer's
// text, Réglages' preview). The server cleaned it already
// (server/mailSignature.js); it's read again here through the same short
// allowlist, as React elements: never set as HTML. A DOMParser document is
// inert (no script runs, no image loads); only these tags, links to http(s)
// and mailto (opening in a new tab), and a few inline styles come out.
const TAGS = new Set(['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li'])
const STYLES = {
  color: ['color', /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,]+\)|[a-z]{3,20})$/i],
  'font-weight': ['fontWeight', /^(?:bold|bolder|normal|[1-9]00)$/],
  'font-style': ['fontStyle', /^(?:italic|normal)$/],
  'text-decoration': ['textDecoration', /^(?:underline|line-through|none)$/],
  'font-size': ['fontSize', /^(?:[89]|[12]\d|3[0-2])(?:\.\d+)?(?:px|pt)$/],
}
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i
const MAX_NODES = 2000

function readStyle(element) {
  const style = {}
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const at = declaration.indexOf(':')
    if (at < 0) continue
    const rule = STYLES[declaration.slice(0, at).trim().toLowerCase()]
    const value = declaration.slice(at + 1).trim()
    if (rule && rule[1].test(value)) style[rule[0]] = value
  }
  return Object.keys(style).length ? style : undefined
}

function toElements(nodes, budget) {
  const out = []
  nodes.forEach((node, index) => {
    if (budget.left-- <= 0) return
    if (node.nodeType === 3) {
      out.push(node.data)
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName.toLowerCase()
    const children = toElements([...node.childNodes], budget)
    if (!TAGS.has(tag)) {
      // Not ours: its text only.
      if (children.length) out.push(createElement(Fragment, { key: index }, ...children))
      return
    }
    if (tag === 'br') {
      out.push(createElement('br', { key: index }))
      return
    }
    const props = { key: index, style: readStyle(node) }
    if (tag === 'a') {
      const href = (node.getAttribute('href') ?? '').trim()
      if (SAFE_HREF.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' })
    }
    out.push(createElement(tag, props, ...children))
  })
  return out
}

function MailSignatureHtml({ html, className = '' }) {
  const content = useMemo(() => {
    if (!html || typeof DOMParser === 'undefined') return null
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    return toElements([...body.childNodes], { left: MAX_NODES })
  }, [html])
  return <div className={`mail-signature-html ${className}`}>{content}</div>
}

export default MailSignatureHtml
