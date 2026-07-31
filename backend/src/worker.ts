import {
  queryReleases,
  queryCricket,
  queryPlatform,
  platformBySlug,
  aggregateClicks,
  countMembers,
  MemberActivity,
  buildPost,
  applyPostEdit,
  canEditPost,
  publicPost,
  relatedReviews,
  buildArticle,
  applyArticleEdit,
  canEditArticle,
  publicArticle,
  relatedArticles,
  summarizeLikes,
  imageExtension,
  MAX_IMAGE_BYTES,
  Article,
  findTitle,
  relatedTitles,
  verifyGoogleToken,
  isOwnerEmail,
  sanitizeRating,
  summarizeRatings,
  buildListing,
  buildPushSubscription,
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
  buildPlatformSeo,
  buildCricketSeo,
  buildBlogSeo,
  buildAboutSeo,
  buildAddaSeo,
  buildPrivacySeo,
  buildTitlePage,
  buildReviewPage,
  buildArticlePage,
  buildSitemap,
  routeMeta,
  cricketMeta,
  SKELETON,
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

/** Supabase Storage bucket for article covers. Must exist and be public. */
const IMAGE_BUCKET = 'article-images'

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

async function loadArticles(env: Env): Promise<{ articles: Article[] }> {
  const hit = memory.get('article-list')
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as { articles: Article[] }
  const res = await sb(env, 'articles?select=id,ts,author,topic,title,body,official,films,image,imagePosition:image_position,imageFit:image_fit&order=ts.desc&limit=200')
  const articles = res.ok ? ((await res.json()) as Article[]) : []
  const value = { articles }
  memory.set('article-list', { at: Date.now(), value })
  return value
}

/** One article by id, with the same off-the-end fallback as loadPost. */
async function loadArticle(env: Env, id: string): Promise<Article | null> {
  const cached = (await loadArticles(env)).articles.find((a) => a.id === id)
  if (cached) return cached
  const res = await sb(
    env,
    `articles?id=eq.${encodeURIComponent(id)}&select=id,ts,author,topic,title,body,official,films,image,imagePosition:image_position,imageFit:image_fit&limit=1`
  )
  const rows = res.ok ? ((await res.json()) as Article[]) : []
  return rows[0] ?? null
}

/**
 * One review by id, for its own page. The cached list above holds only the 200
 * newest, so an older review has to be fetched directly — without this, a page
 * that is indexed and shared quietly 404s the day it falls off the end of the
 * list, which is the worst kind of dead link: one we created.
 */
async function loadPost(env: Env, id: string): Promise<BlogPost | null> {
  const cached = (await loadPosts(env)).posts.find((p) => p.id === id)
  if (cached) return cached
  const res = await sb(
    env,
    `posts?id=eq.${encodeURIComponent(id)}&select=id,ts,author,title,body,tag&limit=1`
  )
  const rows = res.ok ? ((await res.json()) as BlogPost[]) : []
  return rows[0] ?? null
}

/** Pages that get a pre-rendered content block inside <div id="root">. */
const SEO_PAGES = new Set([
  '/',
  '/movies',
  '/movies/theatres',
  '/movies/upcoming',
  '/cricket',
  '/cricket/results',
  '/reviews',
  '/adda',
  '/about',
  '/privacy',
])

async function seoBlockFor(env: Env, pathname: string): Promise<string> {
  // startsWith, not equality: /cricket/results is a cricket page too, and the
  // fall-through at the bottom would otherwise hand it the movies block
  if (pathname.startsWith('/cricket')) {
    const cricket = await loadCache(env, 'cricket', EMPTY_CRICKET)
    return buildCricketSeo(cricket, pathname === '/cricket/results' ? 'results' : 'fixtures')
  }
  if (pathname === '/reviews') {
    const [{ posts }, { articles }] = await Promise.all([loadPosts(env), loadArticles(env)])
    return buildBlogSeo(posts, articles)
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
  const data = await loadCache(env, 'releases', EMPTY_RELEASES)
  const hub = ottHubSlug(pathname)
  if (hub) return buildPlatformSeo(data, hub) ?? buildMoviesSeo(data)
  if (pathname === '/movies/upcoming') return buildMoviesSeo(data, 'upcoming')
  if (pathname === '/movies/theatres') return buildMoviesSeo(data, 'theatres')
  return buildMoviesSeo(data)
}

const ROOT_SHELL = '<div id="root"></div>'

/**
 * An id-shaped URL we have nothing for: /movie/, /review/, /article/ with an id
 * that resolves to nothing. The path *shape* is real, so isKnownRoute lets it
 * through and the shell is still served — the app renders its own not-found
 * state — but the status has to be 404.
 *
 * A 200 here is a soft 404: Google indexes the empty page and spends crawl
 * budget returning to it. The same fix already guards genuinely unknown paths
 * further up; these branches were quietly falling through to the 200 shell.
 */
function gone(asset: Response): Response {
  return new Response(asset.body, { status: 404, headers: asset.headers })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Site-wide defences that cost nothing to serve. None of these fix a hole the
 * app has today; they close off whole classes of one — a mistyped Content-Type
 * being executed, the site being framed for clickjacking, the full reading URL
 * leaking to a platform on an outbound click, or injected script reaching for
 * the camera. Invisible to crawlers, so ranking is unaffected.
 */
/**
 * The paths the SPA actually renders — mirrors the <Route> table in App.tsx.
 * Anything else is not a page on this site, however plausible it looks, and
 * has to say so with a 404 rather than quietly serving the shell.
 */
const SPA_ROUTES = new Set([
  '/',
  '/movies',
  '/movies/theatres',
  '/movies/upcoming',
  '/cricket',
  '/cricket/results',
  '/reviews',
  '/about',
  '/adda',
  '/privacy',
  '/stats',
  '/my-articles',
  '/my-reviews',
])

/**
 * Real pages that must never be indexed. /stats is the owner's dashboard;
 * /my-articles is one writer's own body of work and is empty for anyone else,
 * including a crawler. Both are absent from SEO_PAGES and buildSitemap too —
 * this header is what covers crawlers that ignore robots.txt.
 */
const NOINDEX_PAGES = new Set(['/stats', '/my-articles', '/my-reviews'])

/** Title pages carry an id and an optional slug: /movie/:id[/:slug]. */
const MOVIE_ROUTE = /^\/movie\/[^/]+(\/[^/]*)?$/

/** One review's own page, same shape: /review/:id[/:slug]. */
const REVIEW_ROUTE = /^\/review\/[^/]+(\/[^/]*)?$/

/** One article's own page, same shape again: /article/:id[/:slug]. */
const ARTICLE_ROUTE = /^\/article\/[^/]+(\/[^/]*)?$/

/**
 * /ott/<slug>, and only for a platform we actually serve — /ott/hulu has to
 * 404 like any other path the site does not have, not render an empty hub.
 */
function ottHubSlug(pathname: string): string | null {
  const slug = pathname.startsWith('/ott/') ? pathname.slice(5) : ''
  return slug && platformBySlug(slug) ? slug : null
}

function isKnownRoute(pathname: string): boolean {
  return (
    SPA_ROUTES.has(pathname) ||
    MOVIE_ROUTE.test(pathname) ||
    REVIEW_ROUTE.test(pathname) ||
    ARTICLE_ROUTE.test(pathname) ||
    ottHubSlug(pathname) !== null
  )
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
}

/**
 * Stamp the headers on the way out, once, rather than in each of the handlers.
 * Asset and redirect responses arrive with immutable headers, so the response
 * is rebuilt instead of mutated. A header a handler already set wins — notably
 * the X-Robots-Tag that keeps /stats out of the index.
 */
function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value)
  }
  return out
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    return withSecurityHeaders(await routes.handle(request, env, ctx))
  },
}

const routes = {
  async handle(
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

    // /blog became /reviews in July 2026 — the content was always reviews, and
    // "review" is what people search. A 301 keeps whatever the old path had
    // earned and stops the two competing as duplicates.
    if (url.pathname === '/blog') {
      url.pathname = '/reviews'
      return Response.redirect(url.toString(), 301)
    }

    // /ott is not a page — the hubs live at /ott/<slug> — but it is the obvious
    // thing to type or to trim a URL back to, and 404ing a plausible guess
    // wastes the visit. A trailing slash on a real hub lands here too.
    if (url.pathname === '/ott' || url.pathname === '/ott/') {
      url.pathname = '/movies'
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      // Posts too: a reviewed title keeps its page after it leaves the release
      // window, so it has to keep its sitemap entry. Both reads are cached.
      const [data, { posts }, { articles }] = await Promise.all([
        loadCache(env, 'releases', EMPTY_RELEASES),
        loadPosts(env),
        loadArticles(env),
      ])
      return new Response(buildSitemap(data, posts, articles), {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
      })
    }

    if (!url.pathname.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request)
      // The SPA fallback hands the shell to *any* unmatched path, so bot probes
      // like /wp-login.php came back 200 — a soft 404 that invites Google to
      // index junk and spends crawl budget on it. Real files (assets, flags,
      // robots.txt) are not HTML and never reach this branch, so keying off the
      // content type is enough. The shell is still served, letting the app's
      // catch-all route send a human on to /movies; only the status changes.
      if (
        !isKnownRoute(url.pathname) &&
        (asset.headers.get('Content-Type') ?? '').includes('text/html')
      ) {
        return new Response(asset.body, { status: 404, headers: asset.headers })
      }
      // Never pre-rendered and never indexed — the header covers crawlers that
      // ignore robots.txt or don't run JS.
      if (NOINDEX_PAGES.has(url.pathname)) {
        const headers = new Headers(asset.headers)
        headers.set('X-Robots-Tag', 'noindex, nofollow')
        return new Response(asset.body, { status: asset.status, headers })
      }
      const isMoviePage = /^\/movie\/[^/]+/.test(url.pathname)
      const isReviewPage = REVIEW_ROUTE.test(url.pathname)
      const isArticlePage = ARTICLE_ROUTE.test(url.pathname)
      const hubSlug = ottHubSlug(url.pathname)
      // Edge pre-render: inject real content into the SPA shell so crawlers
      // see this week's titles. Any hiccup falls back to the untouched page.
      if (
        request.method === 'GET' &&
        (SEO_PAGES.has(url.pathname) ||
          isMoviePage ||
          isReviewPage ||
          isArticlePage ||
          hubSlug) &&
        (asset.headers.get('Content-Type') ?? '').includes('text/html')
      ) {
        try {
          let block: string
          let status = asset.status
          /** Serve it, but keep it out of the index (below-threshold hub). */
          let thin = false
          // Route-specific <title>/description/canonical (+ Open Graph) so
          // crawlers and shared links don't see the homepage metadata on
          // every route
          let meta: { title: string; description: string; image?: string } | null
          let canonical: string
          if (isMoviePage) {
            const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
            // Reviews of this title go on this page, not just the hub: "<film>
            // review" is a query we can win, and this is the page already
            // indexed for that film. Both reads are memory-cached per isolate.
            const [releases, { posts }] = await Promise.all([
              loadCache(env, 'releases', EMPTY_RELEASES),
              loadPosts(env),
            ])
            const page = buildTitlePage(releases, id, posts)
            if (!page) return gone(asset)
            block = page.block
            meta = { title: page.title, description: page.description, image: page.image }
            canonical = page.canonical
            // Almost everything here comes from TMDB; a page with no poster and
            // barely a sentence of it is a near-duplicate of stronger domains.
            // Serves normally, stays out of the index. Matches buildSitemap.
            if (!page.indexable) thin = true
          } else if (isReviewPage) {
            // A review we no longer hold is not a page: the shell still serves
            // so the app's own not-found state renders, but with a 404 status.
            const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
            const one = await loadPost(env, id)
            const page = one ? buildReviewPage([one], id) : null
            if (!page) return gone(asset)
            block = page.block
            meta = { title: page.title, description: page.description, image: page.image }
            canonical = page.canonical
          } else if (isArticlePage) {
            const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
            // The related list is on the page for readers, so it is in the
            // pre-render too — those links are the only crawlable path from
            // one article to the next.
            const [one, { articles }] = await Promise.all([
              loadArticle(env, id),
              loadArticles(env),
            ])
            const page = one ? buildArticlePage(one, relatedArticles(articles, id)) : null
            if (!page) return gone(asset)
            block = page.block
            meta = { title: page.title, description: page.description, image: page.image }
            canonical = page.canonical
          } else if (url.pathname === '/cricket') {
            // Title depends on whether India actually play today
            const data = await loadCache(env, 'cricket', EMPTY_CRICKET)
            block = buildCricketSeo(data)
            meta = cricketMeta(data)
            canonical = 'https://weekadda.com/cricket'
          } else if (hubSlug) {
            const releases = await loadCache(env, 'releases', EMPTY_RELEASES)
            const hub = queryPlatform(releases, hubSlug)
            if (!hub) return gone(asset)
            block = buildPlatformSeo(releases, hubSlug) ?? ''
            meta = routeMeta(url.pathname)
            canonical = `https://weekadda.com${url.pathname}`
            // A hub with almost nothing on it is thin content. It still serves
            // — someone who follows a link gets a working page — but it stays
            // out of the index until the platform has enough to be worth one.
            // Matches the gate buildSitemap applies. See SEO-PLAN.md.
            if (!hub.indexable) thin = true
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
          // Structured data has to leave the block before it is injected.
          // React clears #root on mount, so JSON-LD left inside it exists only
          // until the bundle boots — the raw HTML has it, the rendered page
          // does not, and Google's renderer is what decides rich results. Lift
          // it into <head>, where nothing can remove it.
          const jsonLd: string[] = []
          const visible = block.replace(
            /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
            (tag) => {
              jsonLd.push(tag)
              return ''
            }
          )

          // Skeleton first so a phone paints shimmer, not the crawler copy,
          // during the few hundred ms before the bundle mounts
          let out = html.includes(ROOT_SHELL)
            ? html.replace(ROOT_SHELL, `<div id="root">${SKELETON}${visible}</div>`)
            : html
          if (jsonLd.length) {
            // Function replacement: a $ inside a title must not be read as $1
            out = out.replace('</head>', () => `${jsonLd.join('')}</head>`)
          }
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
            // A piece of writing is og:type "article", not "website" — the
            // shell ships the site-wide default and nothing was overriding it
            if (isArticlePage || isReviewPage) {
              swap(/(property="og:type" content=")[^"]*(")/, 'article')
            }
            swap(/(name="twitter:title" content=")[^"]*(")/, m.title)
            swap(/(name="twitter:description"\s+content=")[\s\S]*?("\s*\/?>)/, m.description)
            if (m.image) {
              // Replace the default card rather than adding a second one: a
              // crawler takes the first og:image it meets, so an appended
              // poster would lose to the site-wide default sitting above it.
              // The dimensions and alt text go too — they describe the 1200x630
              // default card, and a poster is neither that shape nor that thing.
              const img = m.image.replace(/"/g, '&quot;')
              swap(/(property="og:image" content=")[^"]*(")/, img)
              swap(/(name="twitter:image" content=")[^"]*(")/, img)
              out = out.replace(
                /<meta property="og:image:(?:width|height|alt)" content="[^"]*"\s*\/?>\s*/g,
                ''
              )
            }
          }
          if (thin) headers.set('X-Robots-Tag', 'noindex, follow')
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

    // Where is this visitor, coarsely — country + state from Cloudflare's own
    // IP lookup (request.cf), no permission prompt, nothing stored. The SPA
    // uses it to put the local language's section first. Per-visitor, so it
    // must never be cached; ?force=IN-KA exists for testing.
    if (url.pathname === '/api/geo' && request.method === 'GET') {
      const force = url.searchParams.get('force')
      const cf = (request as { cf?: { country?: string; regionCode?: string } }).cf ?? {}
      const [country, region] = force
        ? [force.split('-')[0] || null, force.split('-')[1] || null]
        : [cf.country ?? null, cf.regionCode ?? null]
      return new Response(JSON.stringify({ country, region }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }

    if (url.pathname === '/api/releases' && request.method === 'GET') {
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      return json(
        queryReleases(data, query, { syncing: false, liveConfigured: data.source === 'tmdb' })
      )
    }

    if (url.pathname.startsWith('/api/ott/') && request.method === 'GET') {
      const slug = decodeURIComponent(url.pathname.slice('/api/ott/'.length))
      const data = await loadCache(env, 'releases', EMPTY_RELEASES)
      const hub = queryPlatform(data, slug)
      if (!hub) return json({ error: 'Unknown platform' }, 404)
      return json({ ...hub, meta: { fetchedAt: data.fetchedAt, source: data.source } })
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

    // One review, for its own page. Checked after the literal /mine, /ratings
    // and /rate paths above so none of them is ever read as an id. Served from
    // the same cached list the feed uses — a page view costs no extra query.
    if (url.pathname.startsWith('/api/blog/') && request.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/blog/'.length))
      const [post, { posts }] = await Promise.all([loadPost(env, id), loadPosts(env)])
      if (!post) return json({ error: 'Review not found' }, 404)
      return json({ post, related: relatedReviews(posts, post.id) })
    }

    // ---------------- articles ----------------

    if (url.pathname === '/api/articles' && request.method === 'GET') {
      return json(await loadArticles(env))
    }

    if (url.pathname === '/api/articles/mine' && request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID) return json({ articles: [] })
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google' }, 401)
      const res = await sb(
        env,
        `articles?author_email=eq.${encodeURIComponent(profile.email)}&select=id,ts,author,topic,title,body,official,films,image,imagePosition:image_position,imageFit:image_fit&order=ts.desc&limit=200`
      )
      const articles = res.ok ? ((await res.json()) as Article[]) : []
      // Whether this account may publish under the site's byline; the composer
      // needs it to offer the choice, and OWNER_EMAIL never leaves the server
      return json({ articles, owner: isOwnerEmail(profile.email, env.OWNER_EMAIL) })
    }

    /**
     * Cover upload → Supabase Storage. The bucket must exist and be public
     * (see supabase/schema.sql for the exact steps); until it does, this
     * returns an error rather than silently publishing an article whose image
     * points nowhere.
     *
     * Sign-in gated and capped exactly as the local route is: an open endpoint
     * that stores whatever it is sent is a file host, not a feature.
     */
    if (url.pathname === '/api/articles/image' && request.method === 'POST') {
      if (env.GOOGLE_CLIENT_ID) {
        const authz = request.headers.get('Authorization') ?? ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
        if (!profile) return json({ error: 'Please sign in with Google to upload' }, 401)
      }
      const contentType = request.headers.get('Content-Type')
      const ext = imageExtension(contentType)
      if (!ext) return json({ error: 'Use a JPEG, PNG, WebP, AVIF or GIF image' }, 415)
      const bytes = await request.arrayBuffer()
      if (bytes.byteLength === 0) return json({ error: 'No image received' }, 400)
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return json({ error: 'Image is larger than 4 MB' }, 413)
      }
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const base = env.SUPABASE_URL.replace(/\/$/, '')
      const put = await fetch(`${base}/storage/v1/object/${IMAGE_BUCKET}/${name}`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': contentType as string,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: bytes,
      })
      if (!put.ok) {
        console.warn('Image upload failed:', put.status, await put.text())
        return json({ error: 'Could not store the image' }, 502)
      }
      return json({ url: `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${name}` }, 201)
    }

    if (url.pathname === '/api/articles' && request.method === 'POST') {
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
      const article = buildArticle(body, profile, env.OWNER_EMAIL)
      if (!article) {
        return json({ error: 'A title, some writing and a topic are required' }, 400)
      }
      // authorEmail maps to the snake_case column and never leaves the DB; the
      // framing fields are mapped for the same reason (the selects above alias
      // them back), so a rename here means a rename there
      const { authorEmail, imagePosition, imageFit, ...pub } = article
      const insert = await sb(env, 'articles', {
        ...pub,
        ...(authorEmail ? { author_email: authorEmail } : {}),
        ...(imagePosition ? { image_position: imagePosition } : {}),
        ...(imageFit ? { image_fit: imageFit } : {}),
      })
      if (!insert.ok) return json({ error: 'Could not publish' }, 500)
      memory.delete('article-list')
      return json(publicArticle(article), 201)
    }

    // Like counts; with a valid token, whether this account liked each.
    // Checked before the generic /api/articles/<id> below.
    if (url.pathname === '/api/articles/likes' && request.method === 'GET') {
      let email: string | undefined
      if (env.GOOGLE_CLIENT_ID) {
        const authz = request.headers.get('Authorization') ?? ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        email = token ? (await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID))?.email : undefined
      }
      const res = await sb(env, 'article_likes?select=article_id,user_email&limit=20000')
      const rows = res.ok ? ((await res.json()) as Array<{ article_id: string; user_email: string }>) : []
      return json({
        likes: summarizeLikes(
          rows.map((r) => ({ articleId: r.article_id, userEmail: r.user_email })),
          email
        ),
      })
    }

    // Toggle the heart — one per account, tapping again removes it
    if (/^\/api\/articles\/[^/]+\/like$/.test(url.pathname) && request.method === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in is not configured' }, 401)
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google to like' }, 401)
      const id = decodeURIComponent(url.pathname.split('/')[3] ?? '')
      const owner = await sb(
        env,
        `articles?id=eq.${encodeURIComponent(id)}&select=id,author_email&limit=1`
      )
      const found = owner.ok
        ? ((await owner.json()) as Array<{ id: string; author_email?: string }>)[0]
        : null
      if (!found) return json({ error: 'Article not found' }, 404)
      if (found.author_email && found.author_email === profile.email) {
        return json({ error: "You can't like your own article" }, 403)
      }
      const mineRes = await sb(
        env,
        `article_likes?article_id=eq.${encodeURIComponent(id)}&user_email=eq.${encodeURIComponent(profile.email)}&select=article_id`
      )
      const liked = mineRes.ok && ((await mineRes.json()) as unknown[]).length > 0
      const wrote = liked
        ? await sb(
            env,
            `article_likes?article_id=eq.${encodeURIComponent(id)}&user_email=eq.${encodeURIComponent(profile.email)}`,
            { method: 'DELETE' }
          )
        : await sb(env, 'article_likes', {
            method: 'POST',
            body: JSON.stringify({ article_id: id, user_email: profile.email }),
          })
      if (!wrote.ok) return json({ error: 'Could not save' }, 500)
      const after = await sb(
        env,
        `article_likes?article_id=eq.${encodeURIComponent(id)}&select=article_id,user_email`
      )
      const rows = after.ok
        ? ((await after.json()) as Array<{ article_id: string; user_email: string }>)
        : []
      return json(
        summarizeLikes(
          rows.map((r) => ({ articleId: r.article_id, userEmail: r.user_email })),
          profile.email
        )[id] ?? { count: 0 }
      )
    }

    // Edit or delete one's own article. Both answer 404 for someone else's
    // rather than 403, so the API never confirms an id exists to an account
    // with no business knowing it does.
    if (
      url.pathname.startsWith('/api/articles/') &&
      (request.method === 'PATCH' || request.method === 'DELETE')
    ) {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in is not configured' }, 401)
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google' }, 401)
      const id = decodeURIComponent(url.pathname.slice('/api/articles/'.length))
      // author_email is never in the cached list, so it is read fresh here
      const owned = await sb(
        env,
        `articles?id=eq.${encodeURIComponent(id)}&select=id,ts,author,author_email,topic,title,body,official,films,image,imagePosition:image_position,imageFit:image_fit&limit=1`
      )
      const rows = owned.ok
        ? ((await owned.json()) as Array<Article & { author_email?: string }>)
        : []
      const row = rows[0]
      if (!row || !canEditArticle({ ...row, authorEmail: row.author_email }, profile.email)) {
        return json({ error: 'Article not found' }, 404)
      }

      if (request.method === 'DELETE') {
        const gone = await sb(env, `articles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!gone.ok) return json({ error: 'Could not delete' }, 500)
        memory.delete('article-list')
        return json({ deleted: id })
      }

      let body: unknown = {}
      try {
        body = await request.json()
      } catch {
        // fall through to validation
      }
      const edited = applyArticleEdit({ ...row, authorEmail: row.author_email }, body)
      if (!edited) {
        return json({ error: 'A title, some writing and a topic are required' }, 400)
      }
      const { authorEmail, imagePosition, imageFit, id: _id, ts: _ts, ...rest } = edited
      const patch = await sb(env, `articles?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...rest,
          // Cleared fields must be written as null, or PATCH just leaves the
          // old value in place and the removal silently does nothing
          films: edited.films ?? [],
          image: edited.image ?? null,
          image_position: imagePosition ?? null,
          image_fit: imageFit ?? null,
        }),
      })
      if (!patch.ok) return json({ error: 'Could not save' }, 500)
      memory.delete('article-list')
      return json(publicArticle(edited))
    }

    // Checked after the literal /mine above so it is never read as an id
    if (url.pathname.startsWith('/api/articles/') && request.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/articles/'.length))
      const [article, { articles }] = await Promise.all([
        loadArticle(env, id),
        loadArticles(env),
      ])
      if (!article) return json({ error: 'Article not found' }, 404)
      return json({
        article: publicArticle(article),
        related: relatedArticles(articles, article.id).map(publicArticle),
      })
    }

    // Edit or delete one's own review. 404 for someone else's, never 403 —
    // the API must not confirm an id exists to an account with no claim on it.
    if (
      url.pathname.startsWith('/api/blog/') &&
      (request.method === 'PATCH' || request.method === 'DELETE')
    ) {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in is not configured' }, 401)
      const authz = request.headers.get('Authorization') ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      const profile = token ? await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID) : null
      if (!profile) return json({ error: 'Please sign in with Google' }, 401)
      const id = decodeURIComponent(url.pathname.slice('/api/blog/'.length))
      // author_email is never in the cached list, so it is read fresh here
      const res = await sb(
        env,
        `posts?id=eq.${encodeURIComponent(id)}&select=id,ts,author,author_email,title,body,tag&limit=1`
      )
      const rows = res.ok ? ((await res.json()) as Array<BlogPost & { author_email?: string }>) : []
      const row = rows[0]
      if (!row || !canEditPost({ ...row, authorEmail: row.author_email }, profile.email)) {
        return json({ error: 'Review not found' }, 404)
      }

      if (request.method === 'DELETE') {
        const gone = await sb(env, `posts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!gone.ok) return json({ error: 'Could not delete' }, 500)
        // Ratings of a review that no longer exists are orphans
        await sb(env, `post_ratings?post_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
        memory.delete('blog-list')
        memory.delete('ratings-list')
        return json({ deleted: id })
      }

      let body: unknown = {}
      try {
        body = await request.json()
      } catch {
        // fall through to validation
      }
      const edited = applyPostEdit({ ...row, authorEmail: row.author_email }, body)
      if (!edited) {
        return json({ error: 'title, body and a tagged movie or match are required' }, 400)
      }
      const patch = await sb(env, `posts?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: edited.title, body: edited.body, tag: edited.tag }),
      })
      if (!patch.ok) return json({ error: 'Could not save' }, 500)
      memory.delete('blog-list')
      return json(publicPost(edited))
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
      const post = buildPost(body, profile, env.OWNER_EMAIL)
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

    // Release notifications: the Worker only stores and forgets registrations.
    // Sending happens in the sweep, which has the VAPID private key and the
    // Node crypto to use it — see PUSH-PLAN.md.
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
      let body: unknown = {}
      try {
        body = await request.json()
      } catch {
        // falls through to validation
      }
      const sub = buildPushSubscription(body)
      if (!sub) return json({ error: 'Pick at least one language to hear about' }, 400)
      const ins = await sb(env, 'push_subscriptions', {
        method: 'POST',
        // Re-subscribing, or changing languages, must update the row rather
        // than collide: the endpoint is the browser's identity for this device
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          languages: sub.languages,
          timezone: sub.timezone ?? null,
        }),
      })
      if (!ins.ok) {
        console.warn(`push subscribe failed (${ins.status}): ${(await ins.text()).slice(0, 200)}`)
        return json({ error: 'Could not save your subscription' }, 502)
      }
      return json({ ok: true, languages: sub.languages }, 201)
    }

    if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
      let endpoint = ''
      try {
        endpoint = String(((await request.json()) as { endpoint?: string })?.endpoint ?? '')
      } catch {
        // falls through
      }
      if (!endpoint) return json({ error: 'endpoint is required' }, 400)
      await sb(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
      })
      return json({ ok: true })
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
