import webpush from 'web-push'
import {
  NOTIFY_HOUR,
  ReleaseCache,
  isNotifyTime,
  localClock,
  pushBody,
  pushHeadline,
  todaysReleasesFor,
} from './queries'

/**
 * Sends the release notifications.
 *
 * Runs in Node rather than the Worker because Web Push needs VAPID signing and
 * payload encryption that `web-push` does for us, and worker.ts must stay free
 * of Node-only imports.
 *
 * Deliberately *not* part of the sweep any more. The sweep runs at 4 AM IST,
 * which is when the data lands, not when anyone wants to be woken. This is
 * called hourly instead and sends to each subscriber at 9 AM in their own
 * timezone — so Hyderabad hears at breakfast and New Jersey hears at breakfast,
 * about the same day's Indian releases.
 *
 * Optional like Watchmode: without VAPID keys it does nothing at all.
 * See PUSH-PLAN.md.
 */

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
  languages: string[]
  timezone: string | null
  last_sent_on: string | null
}

function sb(path: string, init: RequestInit = {}): Promise<Response> {
  const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_KEY ?? ''
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

export async function sendReleaseNotifications(data: ReleaseCache): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@weekadda.com'
  if (!publicKey || !privateKey) {
    console.log('ℹ️  VAPID keys not set — release notifications skipped.')
    return
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.log('ℹ️  Supabase not configured — release notifications skipped.')
    return
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const res = await sb(
    `push_subscriptions?select=endpoint,p256dh,auth,languages,timezone,last_sent_on&limit=5000`
  )
  if (!res.ok) {
    console.warn(`⚠️  Could not read push subscriptions (${res.status})`)
    return
  }
  const subs = (await res.json()) as SubscriptionRow[]
  if (subs.length === 0) return

  const now = new Date()
  let sent = 0
  let quiet = 0
  let waiting = 0
  const expired: string[] = []

  const utcHour = now.getUTCHours()
  for (const sub of subs) {
    // Their clock, not ours — and a window rather than an instant, because
    // scheduled runs start late often enough to lose a whole day otherwise
    const { day } = localClock(sub.timezone, now)
    if (!isNotifyTime(sub.timezone, utcHour, now)) {
      waiting++
      continue
    }
    // One a day, counted in their day — a person who has already heard at 9 AM
    // must not hear again when the date rolls over in some other timezone
    if (sub.last_sent_on === day) continue

    const items = todaysReleasesFor(data, sub.languages ?? [])
    if (items.length === 0) {
      quiet++
      continue
    }

    const language = items[0].language
    const payload = JSON.stringify({
      title: pushHeadline(items),
      body: pushBody(items),
      url: `/movies?language=${encodeURIComponent(language)}`,
    })

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_sent_on: day }),
      })
    } catch (err) {
      // 404/410 is the browser saying this registration is gone for good —
      // keeping it would mean retrying a dead endpoint every day forever
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) expired.push(sub.endpoint)
      else console.warn(`⚠️  Push failed (${status ?? 'unknown'})`)
    }
  }

  for (const endpoint of expired) {
    await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' })
  }

  console.log(
    `🔔 Notifications: ${sent} sent, ${quiet} had nothing in their languages, ` +
      `${waiting} not at ${NOTIFY_HOUR} o'clock yet` +
      (expired.length ? `, ${expired.length} expired subscription(s) removed` : '')
  )
}
