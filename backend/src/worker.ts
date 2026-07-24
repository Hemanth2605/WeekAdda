import {
  queryReleases,
  queryCricket,
  aggregateClicks,
  buildPost,
  findTitle,
  relatedTitles,
  BlogPost,
  ReleaseCache,
  CricketCache,
  Click,
} from './queries'
import {
  buildMoviesSeo,
  buildCricketSeo,
  buildBlogSeo,
  buildTitlePage,
  buildSitemap,
  routeMeta,
} from './seo'

/**
 * Cloudflare Worker entry: serves /api/* from the Supabase-stored caches that
 * the daily GitHub Actions sweep writes. All requests reach this code (see
 * wrangler.jsonc run_worker_first): the legacy workers.dev host is 301-redirected
 * to the canonical domain, /api/* is handled here, and everything else is
 * forwarded to the built frontend via the ASSETS binding (SPA fallback included).
 * Must stay free of Node-only imports.
 */

const CANONICAL_HOST = 'weekadda.com'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  ASSETS: { fetch(request: Request): Promise<Response> }
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

async function loadPosts(env: Env): Promise<{ posts: BlogPost[] }> {
  const hit = memory.get('blog-list')
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as { posts: BlogPost[] }
  const res = await sb(env, 'posts?select=id,ts,author,title,body,tag&order=ts.desc&limit=200')
  const posts = res.ok ? ((await res.json()) as BlogPost[]) : []
  const value = { posts }
  memory.set('blog-list', { at: Date.now(), value })
  return value
}

/** Pages that get a pre-rendered content block inside <div id="root">. */
const SEO_PAGES = new Set(['/', '/movies', '/cricket', '/blog'])

async function seoBlockFor(env: Env, pathname: string): Promise<string> {
  if (pathname === '/cricket') {
    return buildCricketSeo(await loadCache(env, 'cricket', EMPTY_CRICKET))
  }
  if (pathname === '/blog') {
    return buildBlogSeo((await loadPosts(env)).posts)
  }
  return buildMoviesSeo(await loadCache(env, 'releases', EMPTY_RELEASES))
}

const ROOT_SHELL = '<div id="root"></div>'

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

    if (url.hostname.endsWith('.workers.dev')) {
      url.hostname = CANONICAL_HOST
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      return new Response(buildSitemap(data), {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
      })
    }

    if (!url.pathname.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request)
      const isMoviePage = /^\/movie\/[^/]+/.test(url.pathname)
      // Edge pre-render: inject real content into the SPA shell so crawlers
      // see this week's titles. Any hiccup falls back to the untouched page.
      if (
        request.method === 'GET' &&
        (SEO_PAGES.has(url.pathname) || isMoviePage) &&
        (asset.headers.get('Content-Type') ?? '').includes('text/html')
      ) {
        try {
          let block: string
          let status = asset.status
          // Route-specific <title>/description/canonical so crawlers that skip
          // JS rendering don't see the homepage metadata on every route
          let meta: { title: string; description: string } | null
          let canonical: string
          if (isMoviePage) {
            const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
            const page = buildTitlePage(await loadCache(env, 'releases', EMPTY_RELEASES), id)
            if (!page) return asset
            block = page.block
            meta = { title: page.title, description: page.description }
            canonical = page.canonical
          } else {
            block = await seoBlockFor(env, url.pathname)
            meta = routeMeta(url.pathname)
            canonical = `https://weekadda.com${url.pathname}`
          }
          const html = await asset.text()
          const headers = new Headers(asset.headers)
          headers.delete('Content-Length')
          headers.delete('ETag')
          headers.set('Cache-Control', 'no-cache')
          let out = html.includes(ROOT_SHELL)
            ? html.replace(ROOT_SHELL, `<div id="root">${block}</div>`)
            : html
          if (meta) {
            out = out
              .replace(/<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`)
              .replace(
                /(<meta\s+name="description"\s+content=")[\s\S]*?("\s*\/?>)/,
                `$1${meta.description}$2`
              )
              .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
          }
          return new Response(out, { status, headers })
        } catch {
          return env.ASSETS.fetch(request)
        }
      }
      return asset
    }

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

    if (url.pathname.startsWith('/api/title/') && request.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/title/'.length))
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      const found = findTitle(data, id)
      if (!found) return json({ error: 'Title not found' }, 404)
      return json({ release: found.item, status: found.status, related: relatedTitles(data, found.item) })
    }

    if (url.pathname === '/api/cricket' && request.method === 'GET') {
      const data = await loadCache(env, 'cricket', EMPTY_CRICKET)
      return json(queryCricket(data, query, { syncing: false }))
    }

    if (url.pathname === '/api/blog' && request.method === 'GET') {
      return json(await loadPosts(env))
    }

    if (url.pathname === '/api/blog' && request.method === 'POST') {
      let body: unknown = {}
      try {
        body = await request.json()
      } catch {
        // fall through to validation
      }
      const post = buildPost(body)
      if (!post) {
        return json({ error: 'title, body and a tagged movie or match are required' }, 400)
      }
      const insert = await sb(env, 'posts', { method: 'POST', body: JSON.stringify(post) })
      if (!insert.ok) return json({ error: 'Could not publish the post' }, 502)
      memory.delete('blog-list')
      return json(post, 201)
    }

    if (url.pathname === '/api/track/click' && request.method === 'POST') {
      let body: Record<string, unknown> = {}
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        // fall through to validation
      }
      const { kind, platform, titleId, title, language } = body
      if (kind !== 'watch' && kind !== 'book' && kind !== 'score' && kind !== 'share') {
        return json({ error: 'kind must be watch, book, score or share' }, 400)
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
