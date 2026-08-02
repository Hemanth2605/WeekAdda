/**
 * Web Push subscribe/unsubscribe for release notifications.
 *
 * Anonymous by construction: a push endpoint is issued by the browser vendor,
 * so nobody signs in and we never learn who the subscriber is. Optional like
 * every other key-gated feature — with no VAPID key the button never appears
 * and nothing else changes. See PUSH-PLAN.md.
 */

import { isApplePortable, isStandalone } from './device'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

/**
 * Whether to offer this at all. Safari on iOS only delivers push to sites
 * added to the Home Screen, so an iPhone visitor browsing normally has no
 * PushManager and is never shown a button that could not work for them.
 */
export const pushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  Boolean(VAPID_PUBLIC_KEY)

/**
 * The one case where notifications are unavailable but the visitor can do
 * something about it: an Apple device browsing in a tab, where Safari withholds
 * PushManager until the site is on the Home Screen. Everyone else who lacks
 * push either has no route to it or already has the bell, and telling them to
 * install something would be noise.
 *
 * Deliberately not shown once standalone: if push is still missing there the
 * device is below iOS 16.4, and "add it to your Home Screen" would be advice
 * about a thing already done.
 */
export const pushNeedsHomeScreen = !pushSupported && isApplePortable && !isStandalone

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes. Backed by an
 * explicit ArrayBuffer so the result is a BufferSource — a plain Uint8Array
 * may be backed by a SharedArrayBuffer as far as the types are concerned.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/**
 * A registration whose worker is actually *active*.
 *
 * `register()` resolves as soon as the registration object exists — its worker
 * is typically still `installing`, and `pushManager.subscribe()` on one of
 * those throws "Subscription failed - no active Service Worker". This file is
 * the only place that registers the worker and it does so at click time, so
 * the *first* subscribe on any browser lost that race every time; the second
 * click worked, because by then the worker had activated on its own. `sw.js`
 * calls skipWaiting/claim, which makes activation prompt but not instant —
 * something still has to wait for it.
 *
 * The worker's own state is watched rather than going straight to
 * `navigator.serviceWorker.ready`, because `ready` never settles when an
 * install fails: `redundant` is reported as a failure instead of hanging the
 * button forever. The timeout is the last resort for a browser that does
 * neither.
 */
const WORKER_START_TIMEOUT = 10_000

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js')
  if (reg.active) return reg

  const pending = reg.installing ?? reg.waiting
  if (pending) {
    await new Promise<void>((resolve, reject) => {
      const settle = () => {
        if (pending.state === 'activated') {
          pending.removeEventListener('statechange', settle)
          resolve()
        } else if (pending.state === 'redundant') {
          pending.removeEventListener('statechange', settle)
          reject(new Error('The notifications helper could not start in this browser'))
        }
      }
      pending.addEventListener('statechange', settle)
      settle() // it may have activated between the register and this listener
    })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The notifications helper could not start in this browser')),
          WORKER_START_TIMEOUT
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The current subscription, if this browser already has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

export class PushDenied extends Error {}

/**
 * Ask the browser, then tell the server. Only ever called from a click — a
 * permission prompt on page load gets reflexively blocked, and a block is
 * effectively permanent because undoing it means digging through site settings.
 */
export async function subscribe(languages: string[]): Promise<void> {
  if (!pushSupported) throw new Error('Notifications are not supported in this browser')
  if (languages.length === 0) throw new Error('Pick at least one language')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushDenied('Notifications are blocked for this site')
  }

  const reg = await registration()
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))

  // Their timezone decides *when* they hear from us — 9 in the morning where
  // they are, rather than 9 in the morning where the server is
  let timezone: string | undefined
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timezone = undefined // server falls back to India
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), languages, timezone }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Could not save your subscription')
  }
}

/** Drop it both sides; a failure server-side still unsubscribes the browser. */
export async function unsubscribe(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const { endpoint } = sub.toJSON()
  await sub.unsubscribe()
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    // The browser has already stopped delivering; a stale row is harmless and
    // gets cleaned up the first time a send to it returns 410
  }
}
