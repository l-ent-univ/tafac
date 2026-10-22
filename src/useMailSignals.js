import { useEffect, useState } from 'react'
import universityConfig from '@university'
import { getMailMessage, getMailMessages } from './entApi'
import { detectMailSignals, normalizeText } from './mailSignals'

// The inbox read once for the dashboard, the planning and "Prochain cours"
// together, again after 10 minutes.
const TTL_MS = 10 * 60 * 1000
const MAX_FULL_READS = 12
// Mails that may announce something: read whole before being classed (the
// preview stops at 280 characters, often before the date or the cause).
const MAYBE_SIGNAL = /blocus|bloqu|ferme|greve|mouvement social|preavis|annul|n'aura pas lieu|report|decal|salle|evacu|inaccessible/
// Where a reply quotes the mail before it: its dates aren't this mail's.
const QUOTE_START = /\n\s*(le .{0,120} a ecrit ?:|-+ ?(message d'origine|original message|message transfere) ?-+|de ?: .*\n.*(envoye|date) ?:)/i
let cache = null

function bodyOf(message) {
  const text = message?.bodyText || String(message?.bodyHtml ?? '').replace(/<(br|\/p|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  // Line by line: the quote's start is found by its line.
  const plain = text.split(/\r?\n/).map(normalizeText).join('\n')
  const quote = plain.search(QUOTE_START)
  return (quote > 0 ? plain.slice(0, quote) : plain).slice(0, 4000)
}

async function readSignals(messages) {
  const candidates = messages.filter((message) => MAYBE_SIGNAL.test(normalizeText(`${message.subject} ${message.snippet}`)))
  const read = await Promise.all(candidates.slice(0, MAX_FULL_READS).map((message) => getMailMessage(message.id)
    .then((full) => ({ ...message, snippet: bodyOf(full) || message.snippet }))
    .catch(() => message)))
  return detectMailSignals([...read, ...candidates.slice(MAX_FULL_READS)])
}

function loadSignals() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = {
      at: Date.now(),
      promise: getMailMessages({ limit: 30 })
        .then((result) => (result.status === 'ok' ? readSignals(result.messages) : []))
        .catch(() => []),
    }
  }
  return cache.promise
}

// What the student's mails announce (mailSignals): [] until read, or
// without the mail feature.
export function useMailSignals(enabled = true) {
  const [signals, setSignals] = useState([])
  useEffect(() => {
    if (!enabled || !universityConfig.features?.mail) return undefined
    let alive = true
    loadSignals().then((list) => {
      if (alive) setSignals(list)
    })
    return () => {
      alive = false
    }
  }, [enabled])
  return signals
}
