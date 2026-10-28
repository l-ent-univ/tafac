import { fetchThread, loadMessage, settledValue, threadCache, threadKey } from './mailReadCache'
import { buildPrintDocument, getPdfFileName, getPrintSubject } from './mailPrintDocument'

// « Imprimer » and « Enregistrer en PDF » (the mail list's context menu,
// MailPage): a mail, or its whole thread oldest first as the reader shows
// it, in a print document of its own (src/mailPrintDocument.js).
//
// The mails come through the reader's cache (src/mailReadCache.js): what's
// read there is fetched once. Fetching a mail never marks it read (the
// server's GET doesn't; the reader marks a mail read itself once it shows
// it), so printing leaves its unread state as it was.
//
// The document goes in a hidden frame, sandboxed as the reader's: no
// scripts at all, same-origin only so this page can call its print() and
// read its layout (allow-modals: Chrome refuses print() in a sandbox
// otherwise). Never in the app's own page.

// The PDF writer, fetched the first time it's needed (or when the menu that
// offers it opens: on iOS the share sheet must follow the tap closely).
const loadPdfModule = () => import('./mailPdf')
export function preloadMailPdf() {
  void loadPdfModule().catch(() => {})
}

// Bodies fetched a few at a time: a long thread doesn't send a dozen
// requests to Partage at once.
const MESSAGE_CONCURRENCY = 4
// Inline images still loading after this are left out.
const IMAGE_TIMEOUT_MS = 8000

async function loadPrintedMails(id, folder) {
  const thread = settledValue(threadCache, threadKey(id, folder)) ?? await fetchThread(id, folder)
  const rows = thread.length ? thread : [{ id, draft: false }]
  const messages = new Array(rows.length)
  let next = 0
  const worker = async () => {
    while (next < rows.length) {
      const index = next
      next += 1
      messages[index] = await loadMessage(rows[index].id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MESSAGE_CONCURRENCY, rows.length) }, worker))
  return messages.map((message, index) => ({ message, draft: Boolean(rows[index].draft) }))
}

// The frame, off screen rather than display: none (a frame not laid out
// has nothing to print or measure), PDF_FRAME_WIDTH wide so its pixels map
// to the PDF's points. Resolves once its inline images are in.
async function mountPrintFrame(html, width) {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.tabIndex = -1
  frame.title = 'Impression'
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:1200px;border:0;opacity:0;pointer-events:none`
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  frame.srcdoc = html
  document.body.append(frame)
  await loaded
  const doc = frame.contentDocument
  if (!doc?.body) {
    frame.remove()
    throw new Error('Print frame unavailable.')
  }
  const pending = [...doc.images].filter((image) => !image.complete)
  if (pending.length) {
    let timer
    await Promise.race([
      Promise.all(pending.map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', resolve, { once: true })
      }))),
      new Promise((resolve) => {
        timer = window.setTimeout(resolve, IMAGE_TIMEOUT_MS)
      }),
    ])
    window.clearTimeout(timer)
  }
  return frame
}

// The frame of the last print, kept until the dialog is done with it
// (Safari prints after print() returns): removed on afterprint, else by the
// next print.
let printFrame = null

export async function printMail(id, folder) {
  const mails = await loadPrintedMails(id, folder)
  printFrame?.remove()
  const frame = await mountPrintFrame(buildPrintDocument(mails, { origin: window.location.origin }), 800)
  printFrame = frame
  const view = frame.contentWindow
  view.addEventListener('afterprint', () => {
    window.setTimeout(() => {
      frame.remove()
      if (printFrame === frame) printFrame = null
    }, 0)
  }, { once: true })
  view.focus()
  view.print()
}

// iPhone, iPad (which says it's a Mac, with a touch screen).
function isAppleTouchDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// The file handed over: on iOS through the share sheet (« Enregistrer dans
// Fichiers », AirDrop, « Imprimer »), a download there landing in a
// viewer; elsewhere, or when sharing is refused (the tap too long ago), a
// download. 'shared', 'cancelled' or 'downloaded'.
async function deliverFile(blob, name) {
  if (isAppleTouchDevice() && typeof navigator.share === 'function') {
    const file = new File([blob], name, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled'
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

// The PDF, named after the subject (getPdfFileName). What deliverFile did.
export async function saveMailPdf(id, folder) {
  const [mails, { createMailPdf, PDF_FRAME_WIDTH }] = await Promise.all([loadPrintedMails(id, folder), loadPdfModule()])
  const frame = await mountPrintFrame(buildPrintDocument(mails, { origin: window.location.origin }), PDF_FRAME_WIDTH)
  let blob
  try {
    const bodies = frame.contentDocument.querySelectorAll('.tafac-print-body')
    const subject = getPrintSubject(mails[0].message)
    blob = await createMailPdf(mails.map((mail, index) => ({ ...mail, body: bodies[index] ?? null })), frame.contentWindow, { title: subject })
  } finally {
    frame.remove()
  }
  return deliverFile(blob, getPdfFileName(getPrintSubject(mails[0].message)))
}
