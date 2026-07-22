import {
  queryReleases,
  queryCricket,
  aggregateClicks,
  ReleaseCache,
  CricketCache,
  Click,
} from './queries'

/**
 * Cloudflare Worker entry: serves /api/* from the Supabase-stored caches that
 * the daily GitHub Actions sweep writes. Static assets (the built frontend)
 * are served by Cloudflare's asset handling — only /api/* reaches this code
 * (see wrangler.jsonc run_worker_first). Must stay free of Node-only imports.
 */

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

const EMPTY_RELEASES: ReleaseCache = {
  fetchedAt: '1970-01-01T00:00:00.000Z',
  source: 'sample',
  releases: [],
  ott: [],
  ottUpcoming: [],
}

const EMPTY_CRICKET: CricketCache = {
  fetchedAt: '1970-01-01T00:00:00.000Z',
  source: 'sample',
  matches: [],
}

// Per-isolate memory cache: most requests are served without touching
// Supabase; data refreshes within TTL_MS of a sweep.
const TTL_MS = 5 * 60_000
const memory = new Map<string, { at: number; value: unknown }>()

function sb(env: Env, restPath: string, init?: RequestInit) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${restPath}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  })
}

async function loadCache<T>(env: Env, key: string, empty: T): Promise<T> {
  const hit = memory.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  try {
    const res = await sb(env, `caches?key=eq.${key}&select=value`)
    if (!res.ok) throw new Error(`Supabase read failed (${res.status})`)
    const rows = (await res.json()) as Array<{ value: T }>
    const value = rows[0]?.value ?? empty
    memory.set(key, { at: Date.now(), value })
    return value
  } catch (err) {
    console.warn(`Cache read for "${key}" failed:`, err)
    // A stale copy beats an empty page if Supabase hiccups
    return (hit?.value as T) ?? empty
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const url = new URL(request.url)
    const query = Object.fromEntries(url.searchParams)

    if (url.pathname === '/api/health') {
      return json({ status: 'ok', service: 'WeekAdda API' })
    }

    if (url.pathname === '/api/releases' && request.method === 'GET') {
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      return json(
        queryReleases(data, query, { syncing: false, liveConfigured: data.source === 'tmdb' })
      )
    }

    if (url.pathname === '/api/cricket' && request.method === 'GET') {
      const data = await loadCache(env, 'cricket', EMPTY_CRICKET)
      return json(queryCricket(data, query, { syncing: false }))
    }

    if (url.pathname === '/api/track/click' && request.method === 'POST') {
      let body: Record<string, unknown> = {}
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        // fall through to validation
      }
      const { kind, platform, titleId, title, language } = body
      if (kind !== 'watch' && kind !== 'book' && kind !== 'score') {
        return json({ error: 'kind must be watch, book or score' }, 400)
      }
      if (!platform || !title) {
        return json({ error: 'platform and title are required' }, 400)
      }
      const row = {
        kind,
        platform: String(platform).slice(0, 60),
        title_id: String(titleId ?? '').slice(0, 120),
        title: String(title).slice(0, 200),
        language: String(language ?? '').slice(0, 40),
      }
      // Fire-and-forget like the local JSONL append: respond immediately,
      // finish the insert in the background
      ctx.waitUntil(
        sb(env, 'clicks', { method: 'POST', body: JSON.stringify(row) }).catch(() => {})
      )
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/api/track/stats' && request.method === 'GET') {
      const clicks: Click[] = []
      // PostgREST caps rows per response; page through up to 10k clicks
      for (let page = 0; page < 10; page++) {
        const res = await sb(
          env,
          `clicks?select=ts,kind,platform,title_id,title,language&order=id.asc&limit=1000&offset=${page * 1000}`
        )
        if (!res.ok) break
        const rows = (await res.json()) as Array<{
          ts: string
          kind: Click['kind']
          platform: string
          title_id: string | null
          title: string
          language: string | null
        }>
        for (const r of rows) {
          clicks.push({
            ts: r.ts,
            kind: r.kind,
            platform: r.platform,
            titleId: r.title_id ?? '',
            title: r.title,
            language: r.language ?? '',
          })
        }
        if (rows.length < 1000) break
      }
      return json(aggregateClicks(clicks))
    }

    return json({ error: 'Not found' }, 404)
  },
}
