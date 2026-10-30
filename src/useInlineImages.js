import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { uploadMailAttachment } from './entApi'

// The images of a composer's text (src/mailInlineImages.js): its items, as
// a send and a draft name them, and what the editor's view shows of them
// (MailInlineImageContext). An item with its file (a grade's image, made in
// « Mes notes ») uploads as the composer opens, as an attachment does
// (POST /mail/upload), one at a time; one Partage refused for its session is
// tried once more; one gone from Partage (`expiredAids`: a failed send's,
// markExpired: a draft save's) uploads again from the file kept. A resumed
// draft's are parts of it already, shown from the server.
// `initialItems`: [{ key, cid, source, file? | aid? | messageId + part,
// name, size, contentType, width, height, status, url? }].
// → { items, context, add(item), markExpired, isUploading(cids) }.
export function useInlineImages(initialItems = null, expiredAids = null) {
  const [items, setItems] = useState(() => {
    const expired = new Set(expiredAids ?? [])
    return (initialItems ?? []).map((item) => {
      const gone = item.source === 'upload' && (item.status !== 'ready' || expired.has(item.aid))
      if (!gone) return item
      return item.file ? { ...item, aid: null, status: 'queued', error: null } : { ...item, status: 'error', error: 'failed' }
    })
  })
  // The files' URLs for the view, made and let go with the composer (an
  // item added later, add's, joins them).
  const [urls, setUrls] = useState(() => new Map())
  const madeUrlsRef = useRef(new Map())
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    const made = new Map()
    for (const item of itemsRef.current) {
      if (item.file) made.set(item.cid, URL.createObjectURL(item.file))
    }
    madeUrlsRef.current = made
    setUrls(new Map(made))
    return () => {
      for (const url of madeUrlsRef.current.values()) URL.revokeObjectURL(url)
      madeUrlsRef.current = new Map()
    }
  }, [])

  // An image put in the text while writing (« Une note… »): its item, its
  // file queued to upload.
  const add = useCallback((item) => {
    if (!item?.cid || !item.file) return
    const url = URL.createObjectURL(item.file)
    madeUrlsRef.current.set(item.cid, url)
    setUrls((current) => new Map(current).set(item.cid, url))
    setItems((current) => [...current.filter((entry) => entry.cid !== item.cid), { ...item, aid: null, status: 'queued', error: null }])
  }, [])

  const update = useCallback((cid, patch) => {
    setItems((current) => current.map((item) => (item.cid === cid ? { ...item, ...patch } : item)))
  }, [])

  // One upload at a time: the next queued item once one ends. Closed, the
  // one going stops.
  const activeRef = useRef(null)
  const retriedRef = useRef(new Set())
  const closedRef = useRef(false)
  useEffect(() => {
    closedRef.current = false
    return () => {
      closedRef.current = true
      activeRef.current?.abort()
      activeRef.current = null
    }
  }, [])
  useEffect(() => {
    if (activeRef.current) return
    const next = items.find((item) => item.status === 'queued' && item.file)
    if (!next) return
    update(next.cid, { status: 'uploading' })
    const upload = uploadMailAttachment(next.file, { name: next.name })
    activeRef.current = upload
    void upload.promise.then((result) => {
      if (activeRef.current === upload) activeRef.current = null
      if (closedRef.current || result.status === 'aborted') return
      if (result.status === 'ok') {
        update(next.cid, { status: 'ready', aid: result.attachment.aid, size: result.attachment.size, error: null })
      } else if (result.code === 'retry' && !retriedRef.current.has(next.cid)) {
        retriedRef.current.add(next.cid)
        update(next.cid, { status: 'queued' })
      } else {
        update(next.cid, { status: 'error', error: result.code })
      }
    })
  }, [items, update])

  const retry = useCallback((cid) => {
    const item = itemsRef.current.find((entry) => entry.cid === cid)
    if (!item?.file || item.status !== 'error') return
    retriedRef.current.delete(cid)
    update(cid, { status: 'queued', error: null })
  }, [update])

  // Uploads Partage no longer has: up again from the file, or failed.
  const markExpired = useCallback((aids) => {
    const expired = new Set(aids)
    setItems((current) => (current.some((item) => item.aid && expired.has(item.aid))
      ? current.map((item) => (item.aid && expired.has(item.aid)
        ? (item.file ? { ...item, aid: null, status: 'queued', error: null } : { ...item, status: 'error', error: 'failed' })
        : item))
      : current))
  }, [])

  const isUploading = useCallback((cids) => itemsRef.current.some((item) => cids.includes(item.cid) && (item.status === 'queued' || item.status === 'uploading')), [])

  const context = useMemo(() => ({
    items: new Map(items.map((item) => [item.cid, { ...item, url: urls.get(item.cid) ?? item.url ?? null }])),
    retry,
  }), [items, urls, retry])

  return { items, context, add, markExpired, isUploading }
}
