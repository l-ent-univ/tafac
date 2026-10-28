import { getMailMessage, getMailThread } from './entApi'

// Mails and threads already read (or looked at: a row's hover preloads
// it), kept for the page's life so opening one again is instant: no
// skeleton, no flash. The newest ones only. A request under way is shared.
const READ_CACHE_LIMIT = 40
export const messageCache = new Map()
export const threadCache = new Map()
// Bumped by clearMailReadCache: a request sent before it doesn't fill the
// emptied cache when it lands.
let generation = 0

// Logging out doesn't reload the page: what the previous student read must
// not show (instantly, from here) to whoever signs in next. Called on logout
// and whenever the signed-in user changes (App).
export function clearMailReadCache() {
  generation += 1
  messageCache.clear()
  threadCache.clear()
}

export function remember(cache, key, value) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > READ_CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

export function settledValue(cache, key) {
  const entry = cache.get(key)
  return entry && !(entry instanceof Promise) ? entry : null
}

export function loadMessage(id) {
  const known = messageCache.get(id)
  if (known) return known instanceof Promise ? known : Promise.resolve(known)
  const sentIn = generation
  const request = getMailMessage(id)
    .then((message) => {
      if (sentIn === generation) remember(messageCache, id, message)
      return message
    })
    .catch((error) => {
      if (messageCache.get(id) === request) messageCache.delete(id)
      throw error
    })
  messageCache.set(id, request)
  return request
}

export const threadKey = (id, folder) => `${folder ?? ''}:${id}`

export function fetchThread(id, folder) {
  const key = threadKey(id, folder)
  const sentIn = generation
  const request = getMailThread(id, { folder })
    .then((messages) => {
      if (sentIn === generation) remember(threadCache, key, messages)
      return messages
    })
    .catch((error) => {
      if (threadCache.get(key) === request) threadCache.delete(key)
      throw error
    })
  if (!settledValue(threadCache, key)) threadCache.set(key, request)
  return request
}

// What a thread opens with: its newest mail and its unread ones.
export function initiallyOpen(messages) {
  const newest = messages[messages.length - 1]
  return messages.filter((message) => message.unread || message === newest).map((message) => message.id)
}

// A thread that can show at once: its list known and the mails it opens with
// too. A hovered row only fetched the list, so its thread still waits for
// those bodies (one skeleton, not one per mail). Null otherwise.
export function readyThread(id, folder) {
  const messages = settledValue(threadCache, threadKey(id, folder))
  if (!messages) return null
  return initiallyOpen(messages).every((messageId) => settledValue(messageCache, messageId)) ? messages : null
}

// A thread's list of mails, fetched ahead (a list row's hover). Only the
// list: the bodies wait for the click (MailThread loads the ones it opens
// with before showing), so sweeping the pointer down the inbox costs one
// small request per row rather than a body per mail. Every student reaches
// Partage from the server's one address, which is worth sparing. Failures
// stay silent: the click asks again.
export function prefetchMailThread(id, folder) {
  if (threadCache.has(threadKey(id, folder))) return
  void fetchThread(id, folder).catch(() => {})
}
