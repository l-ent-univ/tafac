// Failures counted per key (an address, a login) over a window, and a short
// block once there are too many. In memory: a restart forgets them.
//
// A failure may carry a tag (whose failure it was), so that it can be
// forgiven on its own later (forgive) without the key's other failures
// going with it.

export interface FailureWindowOptions {
  // Failures older than this start a new count.
  windowMs: number
  // How long the key waits once it has `maxFailures`.
  blockMs: number
  maxFailures: number
  now?: () => number
}

export interface BlockStatus {
  retryAfterMs: number
  retryAfterSeconds: number
}

interface Entry {
  firstFailureAt: number
  blockedUntil: number
  count: number
  byTag: Map<string, number>
}

export interface FailureWindow {
  // The key's block, if it is waiting.
  status(key: string): BlockStatus | null
  // One more failure; the block it brought, if any.
  record(key: string, tag?: string): BlockStatus | null
  // Takes back the failures recorded with that tag.
  forgive(key: string, tag: string): void
  clear(key: string): void
}

const MAX_TAG_LENGTH = 256

export function createFailureWindow({ windowMs, blockMs, maxFailures, now = Date.now }: FailureWindowOptions): FailureWindow {
  const entries = new Map<string, Entry>()

  function prune(): void {
    const current = now()
    for (const [key, entry] of entries) {
      if (entry.blockedUntil > current) continue
      if (current - entry.firstFailureAt > windowMs) entries.delete(key)
    }
  }

  function status(key: string): BlockStatus | null {
    if (!key) return null
    prune()
    const entry = entries.get(key)
    if (!entry?.blockedUntil) return null

    const retryAfterMs = entry.blockedUntil - now()
    if (retryAfterMs <= 0) {
      entries.delete(key)
      return null
    }
    return { retryAfterMs, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }

  function record(key: string, tag = ''): BlockStatus | null {
    if (!key) return null
    prune()

    const current = now()
    let entry = entries.get(key)
    if (!entry || current - entry.firstFailureAt > windowMs) {
      entry = { firstFailureAt: current, blockedUntil: 0, count: 0, byTag: new Map() }
      entries.set(key, entry)
    }

    const boundedTag = tag.slice(0, MAX_TAG_LENGTH)
    entry.count += 1
    entry.byTag.set(boundedTag, (entry.byTag.get(boundedTag) ?? 0) + 1)
    if (entry.count >= maxFailures) entry.blockedUntil = current + blockMs

    return status(key)
  }

  function forgive(key: string, tag: string): void {
    const entry = entries.get(key)
    const boundedTag = tag.slice(0, MAX_TAG_LENGTH)
    const forgiven = entry?.byTag.get(boundedTag)
    if (!entry || !forgiven) return

    entry.byTag.delete(boundedTag)
    entry.count -= forgiven
    if (entry.count <= 0 && entry.blockedUntil <= now()) entries.delete(key)
  }

  return { status, record, forgive, clear: (key) => { entries.delete(key) } }
}
