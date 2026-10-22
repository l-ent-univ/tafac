// Bus reminders sent as Web Push notifications (« Bus » page › Rappels).
// The phone works out its own buses from its timetable and hands over, for
// the coming days, only « notify this subscription at 7:22: Ligne A at
// 7:32, trip X at stop Y »: no name, no ENT account, no timetable here.
// Each open of the app replaces the whole list. Kept in
// <dataDir>/transit-push/<universityId>.json, written atomically.
//
// While a reminded bus is coming (40 min before it), its real-time delay is
// watched: a delay of DELAY_ALERT_MIN or more sends one more notification.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import webpush from 'web-push'
import { runTrip, serviceDateKey } from './transitPlanner.js'

const MAX_SUBSCRIPTIONS = 5000
export const MAX_REMINDERS = 40
const DELAY_ALERT_MIN = 4
const WATCH_BEFORE_MS = 40 * 60 * 1000
// A reminder missed by more than this (server down) is dropped, not sent late.
const LATE_LIMIT_MS = 10 * 60 * 1000
const HORIZON_MS = 8 * 24 * 60 * 60 * 1000
const KINDS = new Set(['morning', 'return', 'lastBus'])

// The push services of the browsers: the server only ever posts to these
// (an endpoint is a URL the client gives).
const PUSH_HOST_SUFFIXES = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

export function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port
      && PUSH_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max

// The browser's PushSubscription JSON, or null when it isn't one.
export function readSubscription(value) {
  if (!value || typeof value !== 'object' || !isText(value.endpoint, 1000) || !isAllowedPushEndpoint(value.endpoint)) return null
  const { p256dh, auth } = value.keys ?? {}
  if (!isText(p256dh, 200) || !isText(auth, 100)) return null
  return { endpoint: value.endpoint, keys: { p256dh, auth } }
}

// Reminders as sent by the client, kept only when well formed and within
// the coming days; the rest is dropped silently.
export function readReminders(value, nowMs) {
  if (!Array.isArray(value)) return null
  const reminders = []
  for (const entry of value.slice(0, MAX_REMINDERS)) {
    if (!entry || typeof entry !== 'object' || !isText(entry.id, 80) || !KINDS.has(entry.kind)) continue
    const at = Number(entry.at)
    if (!Number.isFinite(at) || at < nowMs - LATE_LIMIT_MS || at > nowMs + HORIZON_MS) continue
    if (!isText(entry.title, 80) || !isText(entry.body, 200)) continue
    const departAt = Number(entry.departAt)
    reminders.push({
      id: entry.id,
      kind: entry.kind,
      at,
      title: entry.title,
      body: entry.body,
      url: typeof entry.url === 'string' && /^\/[a-z0-9/_-]*$/i.test(entry.url) ? entry.url : '/bus',
      tripId: isText(entry.tripId, 120) ? entry.tripId : null,
      stopId: isText(entry.stopId, 120) ? entry.stopId : null,
      departAt: Number.isFinite(departAt) ? departAt : null,
      line: isText(entry.line, 20) ? entry.line : null,
      sent: false,
      alertedDelayMin: 0,
    })
  }
  return reminders
}

// VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else a pair made once
// and kept in <dataDir>/transit-push/vapid.json (subscriptions are tied to it).
async function loadVapidKeys(dataDir, env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  }
  const filePath = path.join(dataDir, 'transit-push', 'vapid.json')
  try {
    const stored = JSON.parse(await readFile(filePath, 'utf8'))
    if (stored.publicKey && stored.privateKey) return stored
  } catch {
    // First start: make a pair.
  }
  const keys = webpush.generateVAPIDKeys()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(`${filePath}.tmp`, JSON.stringify(keys), 'utf8')
  await rename(`${filePath}.tmp`, filePath)
  return keys
}

function formatTime(epochMs, timeZone) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(epochMs).replace(':', 'h')
}

// The delay (minutes) of the reminded bus at its stop, or null when the
// feed says nothing about it.
function readDelayMin(reminder, network, realtime) {
  if (!realtime || !reminder.tripId || !reminder.stopId || reminder.departAt == null) return null
  const trip = network.trips.get(reminder.tripId)
  if (!trip) return null
  const run = runTrip(trip, serviceDateKey(reminder.departAt, network.timezone), network, realtime)
  if (!run.realtime) return null
  if (run.canceled) return Infinity
  const index = trip.stopTimes.findIndex((stopTime) => stopTime.stopId === reminder.stopId)
  return index >= 0 ? Math.round(run.delays[index] / 60_000) : null
}

export function createTransitPushStore({ universityId, dataDir, feed, subject, env = process.env, logger = console, send = null, now = Date.now }) {
  const filePath = path.join(dataDir, 'transit-push', `${universityId}.json`)
  // endpoint → { subscription, reminders, updatedAt }
  let entries = null
  let vapid = null
  let writing = Promise.resolve()
  let timer = null

  async function load() {
    if (entries) return entries
    try {
      entries = new Map(Object.entries(JSON.parse(await readFile(filePath, 'utf8'))))
    } catch {
      entries = new Map()
    }
    return entries
  }

  function persist() {
    const content = JSON.stringify(Object.fromEntries(entries))
    writing = writing.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(`${filePath}.tmp`, content, 'utf8')
      await rename(`${filePath}.tmp`, filePath)
    }).catch((error) => logger.warn?.(`[transit-push] could not save reminders: ${error.message}`))
    return writing
  }

  async function getVapid() {
    vapid ??= await loadVapidKeys(dataDir, env)
    return vapid
  }

  async function deliver(subscription, payload) {
    if (send) return send(subscription, payload)
    const keys = await getVapid()
    return webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 15 * 60,
      urgency: 'high',
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
    })
  }

  // One pass: due reminders out, delays of coming buses checked, the past
  // dropped. Returns the number of notifications sent.
  async function tick() {
    await load()
    if (!entries.size) return 0
    const current = now()
    const [network, realtime] = await Promise.all([
      feed.getNetwork().catch(() => null),
      feed.getRealtime(),
    ])
    const timeZone = network?.timezone ?? 'Europe/Paris'
    let sentCount = 0
    let changed = false

    for (const [endpoint, entry] of entries) {
      const outgoing = []
      for (const reminder of entry.reminders) {
        const delayMin = network && reminder.departAt != null
          && current >= reminder.departAt - WATCH_BEFORE_MS && current <= reminder.departAt
          ? readDelayMin(reminder, network, realtime)
          : null

        if (!reminder.sent && reminder.at <= current) {
          reminder.sent = true
          changed = true
          if (current - reminder.at <= LATE_LIMIT_MS) {
            let body = reminder.body
            if (delayMin === Infinity) body = `${body} Attention : ce bus est annoncé supprimé.`
            else if (delayMin >= DELAY_ALERT_MIN) {
              body = `${body} En ce moment : ${delayMin} min de retard.`
              reminder.alertedDelayMin = delayMin
            }
            outgoing.push({ title: reminder.title, body, url: reminder.url, tag: reminder.id })
          }
        } else if (reminder.sent && delayMin != null && reminder.departAt > current) {
          // Already reminded: one more notice when the bus is late (again).
          const worse = delayMin === Infinity ? reminder.alertedDelayMin !== Infinity : delayMin >= Math.max(DELAY_ALERT_MIN, reminder.alertedDelayMin + 3)
          if (worse) {
            reminder.alertedDelayMin = delayMin
            changed = true
            const at = formatTime(reminder.departAt, timeZone)
            outgoing.push(delayMin === Infinity
              ? { title: `Bus de ${at} supprimé`, body: `${reminder.line ? `Ligne ${reminder.line} : ` : ''}ce passage est annoncé supprimé. Regarde le suivant.`, url: reminder.url, tag: `${reminder.id}-delay` }
              : { title: `Bus de ${at} en retard`, body: `${reminder.line ? `Ligne ${reminder.line} : ` : ''}${delayMin} min de retard, passage vers ${formatTime(reminder.departAt + delayMin * 60_000, timeZone)}.`, url: reminder.url, tag: `${reminder.id}-delay` })
          }
        }
      }

      const keep = entry.reminders.filter((reminder) => !reminder.sent || (reminder.departAt ?? reminder.at) > current)
      if (keep.length !== entry.reminders.length) { entry.reminders = keep; changed = true }

      for (const payload of outgoing) {
        try {
          await deliver(entry.subscription, payload)
          sentCount += 1
        } catch (error) {
          // 404/410: the subscription is gone (app uninstalled, permission
          // withdrawn).
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            entries.delete(endpoint)
            changed = true
            break
          }
          logger.warn?.(`[transit-push] send failed: ${error?.statusCode ?? error?.message}`)
        }
      }
      if (entries.has(endpoint) && !entry.reminders.length) { entries.delete(endpoint); changed = true }
    }
    if (changed) await persist()
    return sentCount
  }

  return {
    async getPublicKey() {
      return (await getVapid()).publicKey
    },
    // Replaces this subscription's reminders. → false when the store is full.
    async setReminders(subscription, reminders) {
      await load()
      if (!reminders.length) {
        entries.delete(subscription.endpoint)
      } else {
        if (!entries.has(subscription.endpoint) && entries.size >= MAX_SUBSCRIPTIONS) return false
        // A reminder already sent stays sent across a resync.
        const previous = new Map((entries.get(subscription.endpoint)?.reminders ?? []).map((reminder) => [reminder.id, reminder]))
        for (const reminder of reminders) {
          const before = previous.get(reminder.id)
          if (before?.sent) { reminder.sent = true; reminder.alertedDelayMin = before.alertedDelayMin }
        }
        entries.set(subscription.endpoint, { subscription, reminders, updatedAt: now() })
      }
      await persist()
      return true
    },
    async remove(endpoint) {
      await load()
      if (entries.delete(endpoint)) await persist()
    },
    tick,
    start(intervalMs = 30_000) {
      if (timer) return
      timer = setInterval(() => { tick().catch((error) => logger.warn?.(`[transit-push] ${error.message}`)) }, intervalMs)
      timer.unref?.()
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
  }
}
