// The images inside a mail's text (an image of a grade, src/gradeMail.js):
// each one an inline part of the mail (multipart/related), not a file
// attached. Pure, so it can be tested without a DOM.
//
// The editor holds a reference only (the mailInlineImage node: an
// <img data-inline-cid> without a source); the image itself is an item of
// the composer's (useInlineImages): its file uploaded like an attachment
// (an aid), or a part of the saved draft once it's been saved (messageId,
// part), and the URL the composer shows it from. The send names the items
// the text still shows (inlineImageReferences); the server keeps only those
// images and rewrites them to <img src="cid:…"> (server/mailSend.js).

// As the server takes them (server/mailSend.js: MAX_INLINE_IMAGES,
// INLINE_CID_PATTERN).
export const MAX_INLINE_IMAGES = 3
export const INLINE_CID_PATTERN = /^tafac-img-[0-9a-f-]{8,64}@tafac\.fr$/

// A cid for a new image: bare (Zimbra adds the angle brackets of the
// Content-ID itself), unique, of the server's kind.
export function createInlineCid() {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`
  return `tafac-img-${id.toLowerCase()}@tafac.fr`
}

// An item's key, as the draft saver keeps its part (createDraftSaver's
// refs): one per cid.
export const inlineImageKey = (cid) => `inline:${cid}`

// The cids the editor's HTML shows, in order, once each.
export function inlineImageCids(html) {
  const cids = []
  for (const [, cid] of String(html ?? '').matchAll(/data-inline-cid="([^"]+)"/g)) {
    if (INLINE_CID_PATTERN.test(cid) && !cids.includes(cid)) cids.push(cid)
  }
  return cids
}

// What a send or a save names of the images: those the text shows and
// that are ready (an upload still going or failed isn't sent: the server
// drops its <img>), MAX_INLINE_IMAGES at most. `refs`: the draft saver's
// parts by item key, named instead of an upload already used by a save.
// → [{ cid, source, aid | messageId + part, width, height }].
export function inlineImageReferences(items, html, refs = null) {
  const shown = new Set(inlineImageCids(html))
  return (Array.isArray(items) ? items : [])
    .filter((item) => shown.has(item.cid) && item.status === 'ready')
    .slice(0, MAX_INLINE_IMAGES)
    .map((item) => {
      const saved = refs?.get(inlineImageKey(item.cid))
      const reference = saved
        ? { source: 'message', messageId: saved.messageId, part: saved.part }
        : item.source === 'message'
          ? { source: 'message', messageId: item.messageId, part: item.part }
          : { source: 'upload', aid: item.aid }
      return { cid: item.cid, ...reference, width: item.width, height: item.height }
    })
}

// Where a resumed draft's image shows from, as the server gives it: the
// part proxy, or a data: URL (the demo's). Anything else isn't shown.
export function isInlineImageHref(href) {
  return typeof href === 'string' && (/^\/__ent_auth\/mail\/part\?/.test(href) || /^data:image\/(?:png|jpeg|gif);base64,/.test(href))
}

// A resumed draft's images (GET /mail/draft's `inlineImages`) as the
// composer's items: parts of the draft, ready.
export function draftInlineImageItems(draft) {
  return (Array.isArray(draft?.inlineImages) ? draft.inlineImages : [])
    .filter((image) => INLINE_CID_PATTERN.test(image?.cid ?? '') && typeof image.part === 'string')
    .slice(0, MAX_INLINE_IMAGES)
    .map((image) => ({
      key: inlineImageKey(image.cid),
      cid: image.cid,
      source: 'message',
      messageId: draft.id,
      part: image.part,
      name: image.name ?? 'image.png',
      size: Number.isSafeInteger(image.size) ? image.size : null,
      contentType: image.contentType ?? 'image/png',
      width: Number.isSafeInteger(image.width) && image.width > 0 ? image.width : null,
      height: Number.isSafeInteger(image.height) && image.height > 0 ? image.height : null,
      url: isInlineImageHref(image.href) ? image.href : null,
      status: 'ready',
    }))
}
