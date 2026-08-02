/*
 * WeekAdda service worker — release notifications only.
 *
 * Deliberately not a caching/offline worker: adding one would put a second
 * cache in front of pages the Cloudflare edge already caches, and stale HTML is
 * exactly the class of bug we have spent time chasing. This file exists so the
 * browser has somewhere to deliver a push. See PUSH-PLAN.md.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/*
 * Present so the browser can see one, and doing nothing on purpose.
 *
 * Chrome has wanted a fetch handler before it will treat a site as installable
 * rather than as a home-screen shortcut — the difference between opening in its
 * own window and opening in a browser tab with a URL bar. This satisfies that
 * without becoming the caching worker the file above says it must not be: it
 * never calls event.respondWith(), so every request goes to the network exactly
 * as it would with no service worker at all.
 *
 * Do not grow this into a cache. Serving pages from here would put a second
 * cache in front of the Cloudflare edge, and the stale HTML that follows is the
 * bug class this whole file was written to stay out of.
 */
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    // A push with no readable payload still deserves something sensible
  }
  const title = data.title || 'New releases on WeekAdda'
  const options = {
    body: data.body || 'This week’s arrivals are in.',
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
    tag: 'weekadda-releases', // replaces any earlier one instead of stacking
    data: { url: data.url || '/movies' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/movies'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open WeekAdda tab rather than piling up new ones
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
