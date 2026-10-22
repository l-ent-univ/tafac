import { useEffect } from 'react'
import { ENT_AUTH_PREFIX } from './entApi'
import { buildReminders } from './transitDay'
import { fetchTransitNetwork, getTransitCampus, stopName, updateTransitSettings, useTransitSettings } from './transitApi'
import { useDayBuses } from './useDayBuses'

// Bus reminders as push notifications (server/transitPush.js): the phone
// subscribes, then hands over the coming days' reminders it works out
// itself, again at each open of the app. Needs a service worker with push
// (public/transit-sw.js): a production build, and on iPhone the app added
// to the home screen (iOS 16.4+).

const PUSH_URL = `${ENT_AUTH_PREFIX}/transit/push`
const LAST_SYNC_KEY = 'tafac:transit:last-sync'

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(value) {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

async function getSubscription({ create = false } = {}) {
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing || !create) return existing
  const response = await fetch(PUSH_URL, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Rappels indisponibles')
  const { publicKey } = await response.json()
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
}

async function sendReminders(subscription, reminders) {
  const response = await fetch(PUSH_URL, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), reminders }),
  })
  if (!response.ok) throw new Error(`Rappels refusés (${response.status})`)
}

// Asks for the permission and subscribes. → 'on' | 'denied' | throws.
export async function enableReminders() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  await getSubscription({ create: true })
  try { localStorage.removeItem(LAST_SYNC_KEY) } catch { /* storage blocked */ }
  updateTransitSettings({ reminders: true })
  return 'on'
}

export async function disableReminders() {
  updateTransitSettings({ reminders: false })
  const subscription = await getSubscription().catch(() => null)
  if (!subscription) return
  await fetch(PUSH_URL, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}

// Mounted once in the app while signed in: whenever the coming days'
// buses are known (or change), the server gets the new reminders.
export function useTransitReminderSync({ establishment, selection, sessionUser }) {
  const settings = useTransitSettings()
  const buses = useDayBuses({ establishment, selection, sessionUser, enabled: settings.reminders && Boolean(sessionUser) })

  useEffect(() => {
    if (!settings.reminders || buses.status !== 'ok' || !isPushSupported() || Notification.permission !== 'granted') return
    let cancelled = false
    ;(async () => {
      const network = await fetchTransitNetwork()
      const reminders = buildReminders(buses.plans, {
        now: Date.now(),
        stopName: (stopId) => stopName(network, stopId),
        campusLabel: getTransitCampus(establishment)?.label ?? 'le campus',
      })
      const fingerprint = JSON.stringify(reminders.map((reminder) => [reminder.id, reminder.at]))
      let previous = null
      try { previous = localStorage.getItem(LAST_SYNC_KEY) } catch { /* storage blocked */ }
      if (cancelled || previous === fingerprint) return
      const subscription = await getSubscription({ create: true })
      await sendReminders(subscription, reminders)
      try { localStorage.setItem(LAST_SYNC_KEY, fingerprint) } catch { /* storage blocked */ }
    })().catch(() => {})
    return () => { cancelled = true }
  }, [buses, establishment, settings.reminders])
}
