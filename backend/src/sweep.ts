import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { syncReleases } from './agent/releaseAgent'
import { syncCricket } from './agent/cricketAgent'

/**
 * One full sweep, then push the caches to Supabase. This is what the daily
 * GitHub Actions job runs (and what you run by hand for an off-schedule sync).
 * Without SUPABASE_* env vars it still sweeps — results just stay on disk,
 * which is the local-dev behaviour.
 */

const CACHE_DIR = path.join(__dirname, '..', 'cache')

async function pushToSupabase(): Promise<void> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.log('ℹ️  SUPABASE_URL / SUPABASE_SERVICE_KEY not set — caches stay on disk only.')
    return
  }

  const rows = []
  for (const name of ['releases', 'cricket'] as const) {
    const file = path.join(CACHE_DIR, `${name}.json`)
    if (!fs.existsSync(file)) continue
    rows.push({
      key: name,
      value: JSON.parse(fs.readFileSync(file, 'utf-8')),
      updated_at: new Date().toISOString(),
    })
  }
  if (rows.length === 0) throw new Error('No cache files found to push')

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/caches`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`)
  }
  console.log(`☁️  Pushed ${rows.map((r) => r.key).join(' + ')} to Supabase`)
}

async function main() {
  const failures: string[] = []

  for (const [name, sync] of [
    ['releases', syncReleases],
    ['cricket', syncCricket],
  ] as const) {
    try {
      await sync()
    } catch (err) {
      failures.push(name)
      console.error(`❌ ${name} sweep failed:`, err instanceof Error ? err.message : err)
    }
  }

  // Push whatever we have — if one sweep failed, the other (and the previous
  // run's data for the failed one) still reaches production.
  await pushToSupabase()

  if (failures.length > 0) {
    console.error(`Sweep finished with failures: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('✅ Sweep complete')
}

main().catch((err) => {
  console.error('❌ Sweep aborted:', err instanceof Error ? err.message : err)
  process.exit(1)
})
