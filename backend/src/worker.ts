import {
  queryReleases,
  queryCricket,
  aggregateClicks,
  countMembers,
  MemberActivity,
  buildPost,
  findTitle,
  relatedTitles,
  verifyGoogleToken,
  isOwnerEmail,
  sanitizeRating,
  summarizeRatings,
  buildListing,
  liveListings,
  publicListing,
  AddaListing,
  BlogPost,
  ReleaseCache,
  CricketCache,
  Click,
} from './queries'
import {
  buildMoviesSeo,
  buildCricketSeo,
  buildBlogSeo,
  buildAboutSeo,
  buildAddaSeo,
  buildPrivacySeo,
  buildTitlePage,
  buildSitemap,
  routeMeta,
  cricketMeta,
} from './seo'

/**
 * Cloudflare Worker entry: serves /api/* from the Supabase-stored caches that
 * the daily GitHub Actions sweep writes. All requests reach this code (see
 * wrangler.jsonc run_worker_first): the legacy workers.dev host and the www
 * host are redirected to the canonical domain, /api/* is handled here, and
 * everything else is forwarded to the built frontend via the ASSETS binding
 * (SPA fallback included).
 * Must stay free of Node-only imports.
 */

const CANONICAL_HOST = 'weekadda.com'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  /** Google OAuth client id; when set, publishing a blog post requires sign-in */
  GOOGLE_CLIENT_ID?: string
  /**
   * Owner account(s) for the private /stats dashboard, comma-separated.
   * A secret (`wrangler secret put OWNER_EMAIL`), not a var — unlike the client
   * id this is a personal address and the repo is public. Unset = closed.
   */
  OWNER_EMAIL?: string
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

interface RatingRow {
  post_id: string
  user_email: string
  rating: number
}

async function loadRatingRows(env: Env): Promise<RatingRow[]> {
  const hit = memory.get('ratings-list')
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as RatingRow[]
  const res = await sb(env, 'post_ratings?select=post_id,user_email,rating&limit=10000')
  const rows = res.ok ? ((await res.json()) as RatingRow[]) : []
  memory.set('ratings-list', { at: Date.now(), value: rows })
  return rows
}

interface ListingRow {
  id: string
  ts: string
  author: string
  author_email: string
  whatsapp: string | null
  title: string
  details: string
  status: 'open' | 'closed'
}

interface InterestRow {
  listing_id: string
  user_email: string
  name: string
  ts: string
}

const toListing = (r: ListingRow): AddaListing => ({
  id: r.id,
  ts: r.ts,
  author: r.author,
  authorEmail: r.author_email,
  ...(r.whatsapp ? { whatsapp: r.whatsapp } : {}),
  title: r.title,
  details: r.details,
  status: r.status,
})

async function loadAdda(env: Env): Promise<{ listings: AddaListing[]; interests: InterestRow[] }> {
  const hit = memory.get('adda')
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.value as { listings: AddaListing[]; interests: InterestRow[] }
  }
  const [lRes, iRes] = await Promise.all([
    sb(env, 'listings?select=id,ts,author,author_email,whatsapp,title,details,status&order=ts.desc&limit=500'),
    sb(env, 'listing_interests?select=listing_id,user_email,name,ts&limit=5000'),
  ])
  const value = {
    listings: lRes.ok ? ((await lRes.json()) as ListingRow[]).map(toListing) : [],
    interests: iRes.ok ? ((await iRes.json()) as InterestRow[]) : [],
  }
  memory.set('adda', { at: Date.now(), value })
  return value
}

const addaContact = (l: AddaListing) => ({
  name: l.author,
  email: l.authorEmail,
  ...(l.whatsapp ? { whatsapp: l.whatsapp } : {}),
})

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
const SEO_PAGES = new Set(['/', '/movies', '/cricket', '/blog', '/adda', '/about', '/privacy'])

async function seoBlockFor(env: Env, pathname: string): Promise<string> {
  if (pathname === '/cricket') {
    return buildCricketSeo(await loadCache(env, 'cricket', EMPTY_CRICKET))
  }
  if (pathname === '/blog') {
    return buildBlogSeo((await loadPosts(env)).posts)
  }
  if (pathname === '/about') {
    return buildAboutSeo()
  }
  if (pathname === '/adda') {
    const { listings } = await loadAdda(env)
    return buildAddaSeo(liveListings(listings))
  }
  if (pathname === '/privacy') {
    return buildPrivacySeo()
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

    // Everything lives on the bare domain. The www host is not just a duplicate
    // for crawlers: it is a separate origin, so Google refuses to issue a token
    // there (origin_mismatch) and sessionStorage keeps its own empty bucket —
    // which made signed-in clicks record anonymously. One origin, no such class
    // of bug.
    if (url.hostname.endsWith('.workers.dev') || url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST
      // 301 for navigations (crawlers fold the two hosts together), 308 for
      // anything else — a 301 downgrades a POST to GET and drops its body
      const permanent = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308
      return Response.redirect(url.toString(), permanent)
    }

    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      return new Response(buildSitemap(data), {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
      })
    }

    if (!url.pathname.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request)
      // The private owner dashboard is never pre-rendered and never indexed —
      // the header covers crawlers that ignore robots.txt or don't run JS.
      if (url.pathname === '/stats') {
        const headers = new Headers(asset.headers)
        headers.set('X-Robots-Tag', 'noindex, nofollow')
        return new Response(asset.body, { status: asset.status, headers })
      }
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
          // Route-specific <title>/description/canonical (+ Open Graph) so
          // crawlers and shared links don't see the homepage metadata on
          // every route
          let meta: { title: string; description: string; image?: string } | null
          let canonical: string
          if (isMoviePage) {
            const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
            const page = buildTitlePage(await loadCache(env, 'releases', EMPTY_RELEASES), id)
            if (!page) return asset
            block = page.block
            meta = { title: page.title, description: page.description, image: page.image }
            canonical = page.canonical
          } else if (url.pathname === '/cricket') {
            // Title depends on whether India actually play today
            const data = await loadCache(env, 'cricket', EMPTY_CRICKET)
            block = buildCricketSeo(data)
            meta = cricketMeta(data)
            canonical = 'https://weekadda.com/cricket'
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
            const m = meta
            // Function replacements so a literal $ in any title/overview can't
            // be read as a $1/$2 backreference
            const swap = (re: RegExp, value: string) => {
              out = out.replace(re, (_full, p1: string, p2: string) => `${p1}${value}${p2}`)
            }
            out = out.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${m.title}</title>`)
            swap(/(<meta\s+name="description"\s+content=")[\s\S]*?("\s*\/?>)/, m.description)
            swap(/(<link rel="canonical" href=")[^"]*(")/, canonical)
            // Open Graph + Twitter so WhatsApp/social previews match the page
            swap(/(property="og:title" content=")[^"]*(")/, m.title)
            swap(/(property="og:description"\s+content=")[\s\S]*?("\s*\/?>)/, m.description)
            swap(/(property="og:url" content=")[^"]*(")/, canonical)
            swap(/(name="twitter:title" content=")[^"]*(")/, m.title)
            swap(/(name="twitter:description"\s+content=")[\s\S]*?("\s*\/?>)/, m.description)
            if (m.image) {
              const img = m.image.replace(/"/g, '&quot;')
              out = out.replace(
                '</head>',
                `<meta property="og:image" content="${img}" /><meta name="twitter:image" content="${img}" /></head>`
              )
            }
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

    if (url.pathname.startsWith('/api/adda')) {
      const verifyMe = async () => {
        if (!env.GOOGLE_CLIENT_ID) return null
        const authz = request.headers.get('Authorization') ?? ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        return token ? verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      }

      // Open board — public; a token additionally reveals yours + unlocked contacts
      if (url.pathname === '/api/adda' && request.method === 'GET') {
        const me = await verifyMe()
        const { listings, interests } = await loadAdda(env)
        return json({
          listings: liveListings(listings).map((l) => {
            const li = interests.filter((i) => i.listing_id === l.id)
            const mine = Boolean(me && l.authorEmail === me.email)
            const myInterest = me ? li.find((i) => i.user_email === me.email) : undefined
            return {
              ...publicListing(l),
              interestCount: li.length,
              ...(mine
                ? {
                    mine: true,
                    interests: li.map((i) => ({ name: i.name, email: i.user_email, ts: i.ts })),
                  }
                : {}),
              ...(myInterest ? { contact: addaContact(l) } : {}),
            }
          }),
        })
      }

      if (url.pathname === '/api/adda' && request.method === 'POST') {
        const me = await verifyMe()
        if (!me) return json({ error: 'Please sign in with Google to post' }, 401)
        let body: unknown = {}
        try {
          body = await request.json()
        } catch {
          // fall through to validation
        }
        const listing = buildListing(body, me)
        if (!listing) return json({ error: 'A title and a few words of detail are required' }, 400)
        const insert = await sb(env, 'listings', {
          method: 'POST',
          body: JSON.stringify({
            id: listing.id,
            ts: listing.ts,
            author: listing.author,
            author_email: listing.authorEmail,
            whatsapp: listing.whatsapp ?? null,
            title: listing.title,
            details: listing.details,
            status: listing.status,
          }),
        })
        if (!insert.ok) return json({ error: 'Could not post the listing' }, 502)
        memory.delete('adda')
        return json({ ...publicListing(listing), interestCount: 0, mine: true, interests: [] }, 201)
      }

      const interestMatch = url.pathname.match(/^\/api\/adda\/([^/]+)\/(interest|close)$/)
      if (interestMatch && request.method === 'POST') {
        const me = await verifyMe()
        if (!me) return json({ error: 'Please sign in with Google to respond' }, 401)
        const id = decodeURIComponent(interestMatch[1])
        const { listings } = await loadAdda(env)
        const listing = listings.find((l) => l.id === id)
        if (!listing) return json({ error: 'This listing is gone or closed' }, 404)

        if (interestMatch[2] === 'close') {
          if (listing.authorEmail !== me.email) {
            return json({ error: 'Only the poster can close a listing' }, 403)
          }
          const upd = await sb(env, `listings?id=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'closed' }),
          })
          if (!upd.ok) return json({ error: 'Could not close the listing' }, 502)
          memory.delete('adda')
          return json({ ok: true })
        }

        if (listing.status !== 'open') return json({ error: 'This listing is closed' }, 404)
        if (listing.authorEmail === me.email) {
          return json({ error: 'This is your own listing' }, 400)
        }
        const ins = await sb(env, 'listing_interests', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            listing_id: id,
            user_email: me.email,
            name: me.name || me.email,
          }),
        })
        if (!ins.ok) return json({ error: 'Could not record your interest' }, 502)
        memory.delete('adda')
        return json({ contact: addaContact(listing) })
      }

      return json({ error: 'Not found' }, 404)
    }

    if (url.pathname === '/api/blog' && request.method === 'GET') {
      return json(await loadPosts(env))
    }

    if (url.pathname === '/api/blog/mine' && request.method === 'GET') {
      // The signed-in visitor's own posts, matched by verified Google email
      if (!env.GOOGLE_CLIENT_ID) return json({ posts: [] })
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google' }, 401)
      const res = await sb(
        env,
        `posts?author_email=eq.${encodeURIComponent(profile.email)}&select=id,ts,author,title,body,tag&order=ts.desc&limit=200`
      )
      const posts = res.ok ? ((await res.json()) as BlogPost[]) : []
      return json({ posts })
    }

    if (url.pathname === '/api/blog/ratings' && request.method === 'GET') {
      // Rating summaries; with a valid token, includes the viewer's own rating
      let email: string | undefined
      if (env.GOOGLE_CLIENT_ID) {
        const authz = request.headers.get('Authorization') ?? ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        if (token) email = (await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID))?.email
      }
      const rows = await loadRatingRows(env)
      return json({
        ratings: summarizeRatings(
          rows.map((r) => ({ postId: r.post_id, userEmail: r.user_email, rating: r.rating })),
          email
        ),
      })
    }

    if (url.pathname === '/api/blog/rate' && request.method === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in is not configured' }, 401)
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google to rate' }, 401)
      let body: Record<string, unknown> = {}
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        // fall through to validation
      }
      const postId = String(body.postId ?? '')
      const rating = sanitizeRating(body.rating)
      if (!postId || !rating) {
        return json({ error: 'postId and a rating from 1 to 5 are required' }, 400)
      }
      const postRes = await sb(env, `posts?id=eq.${encodeURIComponent(postId)}&select=author_email`)
      const postRows = postRes.ok
        ? ((await postRes.json()) as Array<{ author_email: string | null }>)
        : []
      if (postRows.length === 0) return json({ error: 'Post not found' }, 404)
      if (postRows[0].author_email && postRows[0].author_email === profile.email) {
        return json({ error: "You can't rate your own take" }, 403)
      }
      // One rating per account per post: primary key upsert
      const upsert = await sb(env, 'post_ratings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ post_id: postId, user_email: profile.email, rating }),
      })
      if (!upsert.ok) return json({ error: 'Could not save the rating' }, 502)
      memory.delete('ratings-list')
      const fresh = await sb(
        env,
        `post_ratings?post_id=eq.${encodeURIComponent(postId)}&select=post_id,user_email,rating`
      )
      const rows = fresh.ok ? ((await fresh.json()) as RatingRow[]) : []
      const summary = summarizeRatings(
        rows.map((r) => ({ postId: r.post_id, userEmail: r.user_email, rating: r.rating })),
        profile.email
      )[postId] ?? { avg: rating, count: 1, mine: rating }
      return json(summary)
    }

    if (url.pathname === '/api/blog' && request.method === 'POST') {
      // Reading is open to everyone; publishing needs a verified Google
      // sign-in once GOOGLE_CLIENT_ID is configured
      let profile = null
      if (env.GOOGLE_CLIENT_ID) {
        const authz = request.headers.get('Authorization') ?? ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
        if (!profile) return json({ error: 'Please sign in with Google to publish' }, 401)
      }
      let body: unknown = {}
      try {
        body = await request.json()
      } catch {
        // fall through to validation
      }
      const post = buildPost(body, profile)
      if (!post) {
        return json({ error: 'title, body and a tagged movie or match are required' }, 400)
      }
      // authorEmail maps to the snake_case column and never leaves the DB
      const { authorEmail, ...pub } = post
      const insert = await sb(env, 'posts', {
        method: 'POST',
        body: JSON.stringify({ ...pub, author_email: authorEmail ?? null }),
      })
      if (!insert.ok) return json({ error: 'Could not publish the post' }, 502)
      memory.delete('blog-list')
      return json(pub, 201)
    }

    if (url.pathname === '/api/track/click' && request.method === 'POST') {
      let body: Record<string, unknown> = {}
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        // fall through to validation
      }
      const { kind, platform, titleId, title, language, visitorId } = body
      if (kind !== 'watch' && kind !== 'book' && kind !== 'score' && kind !== 'share') {
        return json({ error: 'kind must be watch, book, score or share' }, 400)
      }
      if (!platform || !title) {
        return json({ error: 'platform and title are required' }, 400)
      }
      const authz = request.headers.get('Authorization') ?? ''
      const clickToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      // Fire-and-forget like the local JSONL append: respond immediately,
      // resolve identity (signed-in account vs anonymous visitor id) and
      // finish the insert in the background
      ctx.waitUntil(
        (async () => {
          let userEmail: string | null = null
          if (clickToken && env.GOOGLE_CLIENT_ID) {
            const profile = await verifyGoogleToken(clickToken, env.GOOGLE_CLIENT_ID)
            userEmail = profile?.email ?? null
            // Identity is best-effort and must never fail the click — but a
            // rejected token has to be visible, or an expired sign-in looks
            // exactly like a signed-out visitor. Never log the address itself.
            if (!userEmail) console.warn('click: token sent but Google rejected it')
          } else if (!clickToken) {
            console.log('click: no Authorization header — anonymous visitor')
          } else {
            console.warn('click: token sent but GOOGLE_CLIENT_ID is unset on the Worker')
          }
          const row = {
            kind,
            platform: String(platform).slice(0, 60),
            title_id: String(titleId ?? '').slice(0, 120),
            title: String(title).slice(0, 200),
            language: String(language ?? '').slice(0, 40),
            visitor_id: visitorId ? String(visitorId).slice(0, 64) : null,
            user_email: userEmail,
          }
          const ins = await sb(env, 'clicks', { method: 'POST', body: JSON.stringify(row) })
          // Without this check the insert fails silently: a missing column or
          // an RLS block leaves no trace and the dashboard just reads empty
          if (!ins.ok) {
            console.warn(`click insert failed (${ins.status}): ${(await ins.text()).slice(0, 300)}`)
          } else {
            console.log(`click stored: ${kind} — signed in: ${userEmail ? 'yes' : 'no'}`)
          }
        })().catch((err) => console.warn('click tracking threw:', err))
      )
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/api/track/stats' && request.method === 'GET') {
      // Private to the owner — the same check as the Express route
      const statsAuthz = request.headers.get('Authorization') ?? ''
      const statsToken = statsAuthz.startsWith('Bearer ') ? statsAuthz.slice(7) : ''
      if (!env.GOOGLE_CLIENT_ID || !statsToken) {
        return json({ error: 'Sign in with the owner account to view stats' }, 401)
      }
      const statsMe = await verifyGoogleToken(statsToken, env.GOOGLE_CLIENT_ID)
      if (!statsMe) {
        return json({ error: 'Your sign-in expired — please sign in again' }, 401)
      }
      if (!env.OWNER_EMAIL) {
        return json({ error: 'Stats are not configured: OWNER_EMAIL is unset on the server' }, 403)
      }
      if (!isOwnerEmail(statsMe.email, env.OWNER_EMAIL)) {
        return json({ error: 'This page is not available for your account' }, 403)
      }

      const clicks: Click[] = []
      // PostgREST caps rows per response; page through up to 10k clicks
      for (let page = 0; page < 10; page++) {
        const res = await sb(
          env,
          `clicks?select=ts,kind,platform,title_id,title,language,visitor_id,user_email&order=id.asc&limit=1000&offset=${page * 1000}`
        )
        if (!res.ok) break
        const rows = (await res.json()) as Array<{
          ts: string
          kind: Click['kind']
          platform: string
          title_id: string | null
          title: string
          language: string | null
          visitor_id: string | null
          user_email: string | null
        }>
        for (const r of rows) {
          clicks.push({
            ts: r.ts,
            kind: r.kind,
            platform: r.platform,
            titleId: r.title_id ?? '',
            title: r.title,
            language: r.language ?? '',
            visitorId: r.visitor_id ?? undefined,
            userEmail: r.user_email ?? undefined,
          })
        }
        if (rows.length < 1000) break
      }

      // Members: the accounts behind every sign-in-gated action. Each table is
      // read for (email, ts) only, and a table that fails is simply skipped —
      // a partial member count beats a broken dashboard.
      const activity: MemberActivity[] = clicks.map((c) => ({
        email: c.userEmail,
        ts: c.ts,
        source: 'click' as const,
      }))
      const sources: Array<{ query: string; field: string; source: MemberActivity['source'] }> = [
        { query: 'posts?select=author_email,ts', field: 'author_email', source: 'blog' },
        { query: 'post_ratings?select=user_email,ts', field: 'user_email', source: 'rating' },
        { query: 'listings?select=author_email,ts', field: 'author_email', source: 'adda' },
        { query: 'listing_interests?select=user_email,ts', field: 'user_email', source: 'adda' },
      ]
      for (const s of sources) {
        try {
          const res = await sb(env, `${s.query}&limit=5000`)
          if (!res.ok) continue
          const rows = (await res.json()) as Array<Record<string, string | null>>
          for (const r of rows) {
            activity.push({ email: r[s.field], ts: r.ts ?? '', source: s.source })
          }
        } catch {
          // one unreachable table must not break the whole dashboard
        }
      }

      return json({ ...aggregateClicks(clicks), ...countMembers(activity) })
    }

    return json({ error: 'Not found' }, 404)
  },
}
