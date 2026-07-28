import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { sendReleaseNotifications } from './pushSender'
import type { ReleaseCache } from './queries'

/**
 * The hourly notification run, separate from the sweep.
 *
 * The sweep gathers at 4 AM IST because that is when the sources have settled;
 * nobody wants to be woken then. This runs every hour instead and sends to each
 * subscriber at 9 o'clock in their own timezone, so the same job serves
 * Hyderabad and New Jersey without either being told about the other's morning.
 *
 * It reads the release cache Supabase already holds rather than sweeping again
 * — the data is at most a few hours old and no source needs troubling 24 times
 * a day. See PUSH-PLAN.md.
 */

async function loadReleases(): Promise<ReleaseCache | null> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (url && key) {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/caches?key=eq.releases&select=value`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    )
    if (!res.ok) throw new Error(`Could not read the releases cache (${res.status})`)
    const rows = (await res.json()) as Array<{ value: ReleaseCache }>
    return rows[0]?.value ?? null
  }

  // Local dev: whatever the agent last wrote to disk
  const file = path.join(__dirname, '..', 'cache', 'releases.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as ReleaseCache
}

async function main() {
  const data = await loadReleases()
  if (!data) {
    console.log('ℹ️  No release cache available — nothing to notify about.')
    return
  }
  await sendReleaseNotifications(data)
}

main().catch((err) => {
  // A missed notification is not worth a red build; the next hour tries again
  console.error('⚠️  Notify run failed:', err instanceof Error ? err.message : err)
  process.exit(0)
})
