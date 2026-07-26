import webpush from 'web-push'
import {
  ReleaseCache,
  istDay,
  pushBody,
  pushHeadline,
  todaysReleasesFor,
} from './queries'

/**
 * Sends the release notifications, from inside the daily sweep.
 *
 * It lives here and not in the Worker for two reasons: Web Push needs VAPID
 * signing and payload encryption that `web-push` does in Node, and `worker.ts`
 * must stay free of Node-only imports. The sweep is also simply the right
 * moment — it is holding the fresh data the instant it is written.
 *
 * Optional like Watchmode: without VAPID keys this does nothing at all and the
 * sweep carries on. See PUSH-PLAN.md.
 */

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
  languages: string[]
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

  const today = istDay(new Date().toISOString())
  const res = await sb(
    `push_subscriptions?select=endpoint,p256dh,auth,languages,last_sent_on&limit=5000`
  )
  if (!res.ok) {
    console.warn(`⚠️  Could not read push subscriptions (${res.status})`)
    return
  }
  const subs = (await res.json()) as SubscriptionRow[]
  if (subs.length === 0) return

  let sent = 0
  let quiet = 0
  const expired: string[] = []

  for (const sub of subs) {
    // One a day, whatever else happens
    if (sub.last_sent_on === today) continue

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
        body: JSON.stringify({ last_sent_on: today }),
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
    `🔔 Notifications: ${sent} sent, ${quiet} had nothing in their languages` +
      (expired.length ? `, ${expired.length} expired subscription(s) removed` : '')
  )
}
