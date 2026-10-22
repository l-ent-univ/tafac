// Bus reminders (server/transitPush.js), imported by the app's service
// worker (vite.config.js › workbox.importScripts): shows each push, and a
// tap opens the app on the page the reminder points to.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Bus', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Bus', {
    body: data.body || '',
    tag: data.tag,
    renotify: Boolean(data.tag),
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/bus' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/bus', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (open) {
      return open.navigate(url).then((client) => (client ?? open).focus())
    }
    return self.clients.openWindow(url)
  }))
})
