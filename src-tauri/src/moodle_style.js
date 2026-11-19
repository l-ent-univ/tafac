// Tafac's look over Moodle's pages, in Moodle's view (moodle_style.rs). Run
// by WebKit before the page's own scripts, in its top frame only: frames
// (an embedded video) are left as they are, and so are the university's
// sign-in pages (another host, or Moodle's own /login/).
//
// The style goes in as constructed style sheets (document.adoptedStyleSheets),
// which a page's Content-Security-Policy doesn't govern: no <style> or
// <link> is added, so a policy without 'unsafe-inline' changes nothing.
// The fonts come as bytes (FontFace), not from an address: a policy's
// font-src doesn't apply either.
//
// `config`: { host, css, dark, theme, fonts } from moodle_style.rs. `theme`
// ({ version, dark, tokens }) follows the app's: a newer one comes as a
// `tafac:moodle-theme` event (eval'd by the app), and is kept in
// sessionStorage for the next page of the same tab.
;((config) => {
  'use strict'
  if (window.top !== window || location.protocol !== 'https:' || location.hostname !== config.host) return
  // Files Moodle serves as they are (a teacher's HTML page among them) are
  // the teacher's, not Moodle's. Its sign-in pages are the university's
  // door, as moodle.rs counts them: left as they are too.
  if (/^\/(?:pluginfile|tokenpluginfile|draftfile|brokenfile)\.php\/|^\/(?:webservice|login|auth)\//.test(location.pathname)) return
  if (document.contentType !== 'text/html' || !('adoptedStyleSheets' in Document.prototype)) return

  const KEY = 'tafac:moodle-theme'
  const base = new CSSStyleSheet()
  const theme = new CSSStyleSheet()
  try {
    base.replaceSync(config.css)
  } catch {
    return
  }

  const bytes = (data) => {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data)
    const binary = atob(data)
    const out = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
    return out
  }
  for (const font of config.fonts) {
    try {
      const descriptors = { weight: font.weight, ...(font.range ? { unicodeRange: font.range } : null) }
      document.fonts.add(new FontFace(font.family, bytes(font.data), descriptors))
    } catch {
      // That face falls back to the next of the stack.
    }
  }

  // The app's colours, as `--tafac-<name>`. Only colours: anything else
  // (a value that would close the rule) is left out.
  let version = -1
  const apply = (next) => {
    if (!next || typeof next !== 'object' || !Number.isSafeInteger(next.version) || next.version <= version) return false
    const lines = []
    for (const [name, value] of Object.entries(next.tokens ?? {})) {
      if (/^[a-z][a-z0-9-]*$/.test(name) && typeof value === 'string' && CSS.supports('color', value)) lines.push(`--tafac-${name}: ${value};`)
    }
    try {
      theme.replaceSync(`:root { color-scheme: ${next.dark ? 'dark' : 'light'}; ${lines.join(' ')} }\n${next.dark ? config.dark : ''}`)
    } catch {
      return false
    }
    version = next.version
    return true
  }

  let stored = null
  try {
    stored = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
  } catch {
    // No storage: the theme the view was made with.
  }
  apply(config.theme)
  apply(stored)

  document.addEventListener('tafac:moodle-theme', (event) => {
    if (!apply(event.detail)) return
    try {
      sessionStorage.setItem(KEY, JSON.stringify(event.detail))
    } catch {
      // The next page starts from the view's theme, then this one.
    }
  })

  document.adoptedStyleSheets = [...document.adoptedStyleSheets, base, theme]

  // Not one of Moodle's pages after all (no Moodle layout on its body): the
  // style goes.
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body && ![...document.body.classList].some((name) => name.startsWith('pagelayout-'))) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== base && sheet !== theme)
    }
  }, { once: true })
})
