self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Stock Tracker'
  const options = {
    body: payload.body || 'A new portfolio message is available.',
    icon: '/app-icon.svg',
    badge: '/app-icon.svg',
    data: { url: payload.url || '/messages' },
  }

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    updateAppBadge(payload.unreadCount),
    notifyOpenWindows(),
  ]))
})

async function updateAppBadge(count) {
  if (count === undefined) return
  if (!Number.isSafeInteger(count) || count < 0) {
    console.error('[badge] Push included an invalid unread count:', count)
    return
  }
  try {
    if (count === 0) {
      if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge()
    } else if ('setAppBadge' in self.navigator) {
      await self.navigator.setAppBadge(count)
    }
  } catch (error) {
    console.error('[badge] Unable to update the app badge from push:', error)
  }
}

async function notifyOpenWindows() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    client.postMessage({ type: 'messages-updated' })
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destination = new URL(event.notification.data?.url || '/messages', self.location.origin)
  if (destination.origin !== self.location.origin) destination.pathname = '/messages'

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(destination.href)
        return
      }
    }
    await self.clients.openWindow(destination.href)
  })())
})