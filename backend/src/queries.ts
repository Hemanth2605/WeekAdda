/**
 * Platform-neutral core shared by the local Express server and the Cloudflare
 * Worker: cache shapes, the query/filter/sort logic behind /api/releases and
 * /api/cricket, and click-stats aggregation. Must stay free of Node-only
 * imports (fs, path, express) so it bundles cleanly for the Worker runtime.
 */

// ---------------- movies & OTT ----------------

export interface Release {
  id: string
  title: string
  originalTitle: string
  language: string // ISO code, e.g. 'te' — the language it was SHOT in
  languageLabel: string // e.g. 'Telugu'
  /**
   * Every language it actually released in, original first — a pan-India film
   * shot in Telugu but also released in Hindi/Tamil/Malayalam is `['te','hi',
   * 'ta','ml']`. Absent on the vast majority of films, and absent from every
   * cache written before this existed, so read it through `releaseLanguages`
   * rather than directly.
   */
  languages?: string[]
  releaseDate: string // YYYY-MM-DD
  overview: string
  poster: string | null // full image URL when available
  rating: number // 0–10 (0 = not yet rated)
  votes: number
}

/**
 * The languages a film can be watched in. Single-language films — almost all of
 * them — never carry the field, and neither does a cache written before it
 * existed, so the original language is the answer unless told otherwise.
 */
export function releaseLanguages(r: Release): string[] {
  return r.languages?.length ? r.languages : [r.language]
}

/** Released in more than one language: the "Pan-India" filter chip. */
export function isPanIndia(r: Release): boolean {
  return releaseLanguages(r).length > 1
}

/** The pseudo-code the language filter uses for "any multi-language release". */
export const PAN_INDIA_CODE = 'pan'

export interface OttRelease extends Release {
  platforms: string[] // e.g. ['Netflix', 'ZEE5']
  week: number // which weekly bucket (0 = this week) the digital release fell into
  contentType: 'movie' | 'series'
  /**
   * Which country's release record supplied the date ('IN' | 'US'). Sweep-time
   * provenance only, used to prefer India's date when both know a film; the
   * agent strips it before writing the cache, so it never reaches the app.
   */
  dateRegion?: string
}

export interface ReleaseCache {
  fetchedAt: string
  source: 'tmdb' | 'sample'
  rangeDays?: number // how far back this cache reaches (for invalidation)
  sourcesVersion?: number
  releases: Release[]
  ott: OttRelease[]
  ottUpcoming: OttRelease[] // digital releases announced for the next ~90 days
}

// Display order: Telugu, Tamil, English, Hindi, Malayalam, Kannada, then the rest.
export const LANGUAGES = [
  { code: 'te', label: 'Telugu' },
  { code: 'ta', label: 'Tamil' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'bn', label: 'Bengali' },
  { code: 'mr', label: 'Marathi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ko', label: 'Korean' },
  { code: 'ja', label: 'Japanese' },
  { code: 'es', label: 'Spanish' },
]

// Weekly history: 13 weeks (~3 months). Week 0 = today-6..today, week 12 is the oldest.
export const MAX_WEEKS = 13

// ---------------- cricket ----------------

export interface CricketTeam {
  name: string
  abbreviation: string
  score: string
  logo: string | null
  winner: boolean
}

export interface CricketMatch {
  id: string
  name: string
  shortName: string
  series: string
  seriesId: string
  date: string // ISO datetime
  venue: string
  state: 'pre' | 'in' | 'post'
  statusDetail: string
  international: boolean // national sides on both ends (vs franchise/domestic)
  url: string | null // ESPN scorecard page
  label: string // e.g. "1st T20I", "2nd ODI", "Only Test", "Final"
  teams: CricketTeam[]
}

export interface CricketCache {
  fetchedAt: string
  source: 'espn' | 'sample'
  version?: number
  knownLeagues?: Array<{ id: string; name: string }>
  matches: CricketMatch[]
}

export const CRICKET_MAX_WEEKS = 13

// ---------------- helpers ----------------

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

function clampWeek(raw: unknown, maxWeeks: number) {
  const n = Number(raw)
  return Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : 0, 0), maxWeeks - 1)
}

export interface WeekInfo {
  index: number
  from: string
  to: string
  maxWeeks: number
}

// ---------------- /api/releases ----------------

export interface ReleaseQuery {
  window?: string
  week?: string | number
  language?: string
  search?: string
  contentType?: string
  source?: string
}

export function queryReleases(
  data: ReleaseCache,
  q: ReleaseQuery,
  extras: { syncing: boolean; liveConfigured: boolean }
) {
  const today = new Date().toISOString().slice(0, 10)
  const contentType = q.contentType

  let releases: Release[] = data.releases
  let weekInfo: WeekInfo | null = null

  if (q.window === 'upcoming') {
    if (q.source === 'ott') {
      releases = data.ottUpcoming.filter(
        (r) =>
          r.releaseDate > today &&
          (contentType === 'movie' || contentType === 'series' ? r.contentType === contentType : true)
      )
    } else {
      releases = releases.filter((r) => r.releaseDate > today)
    }
  } else if (q.window === 'ott') {
    // OTT arrivals in India are pre-bucketed by week during the agent sweep
    const week = clampWeek(q.week, MAX_WEEKS)
    weekInfo = { index: week, from: isoDaysAgo(week * 7 + 6), to: isoDaysAgo(week * 7), maxWeeks: MAX_WEEKS }
    releases = data.ott.filter(
      (r) =>
        r.week === week &&
        (contentType === 'movie' || contentType === 'series' ? r.contentType === contentType : true)
    )
  } else {
    // Released view is week-paged: week 0 = last 7 days (today-6..today),
    // week 1 = the 7 days before that, … up to MAX_WEEKS (~3 months).
    const week = clampWeek(q.week, MAX_WEEKS)
    const to = isoDaysAgo(week * 7)
    const from = isoDaysAgo(week * 7 + 6)
    weekInfo = { index: week, from, to, maxWeeks: MAX_WEEKS }
    releases = releases.filter((r) => r.releaseDate >= from && r.releaseDate <= to)
  }

  // Filter on every language a film released in, not just the one it was shot
  // in: someone who watches in Hindi should find the Telugu-original pan-India
  // film that is playing in Hindi down the road from them.
  if (typeof q.language === 'string' && q.language && q.language !== 'all') {
    releases =
      q.language === PAN_INDIA_CODE
        ? releases.filter(isPanIndia)
        : releases.filter((r) => releaseLanguages(r).includes(q.language as string))
  }
  if (typeof q.search === 'string' && q.search.trim()) {
    const s = q.search.trim().toLowerCase()
    releases = releases.filter(
      (r) =>
        r.title.toLowerCase().includes(s) ||
        r.originalTitle.toLowerCase().includes(s) ||
        r.overview.toLowerCase().includes(s) ||
        r.languageLabel.toLowerCase().includes(s)
    )
  }

  // Telugu first everywhere; then released: newest first, upcoming: soonest
  // first, OTT: most popular first.
  const sorted = [...releases].sort((a, b) => {
    const telugu = Number(b.language === 'te') - Number(a.language === 'te')
    if (telugu !== 0) return telugu
    if (q.window === 'upcoming') return a.releaseDate.localeCompare(b.releaseDate)
    if (q.window === 'ott') return b.votes - a.votes
    return b.releaseDate.localeCompare(a.releaseDate)
  })

  return {
    releases: sorted,
    week: weekInfo,
    meta: {
      fetchedAt: data.fetchedAt,
      source: data.source,
      total: data.releases.length,
      ottTotal: data.ott.length,
      syncing: extras.syncing,
      liveConfigured: extras.liveConfigured,
    },
    languages: LANGUAGES,
  }
}

// ---------------- /ott/<platform> hubs ----------------

/**
 * One hub per streaming service, at /ott/<slug>. The slugs are what people
 * type, not what the platform calls itself — "prime-video" and "sun-nxt" are
 * searched far more than "amazon-prime-video" or "sunnxt". `name` must match
 * the label the release agent writes into `platforms`, exactly; that string is
 * the join between the two halves of this feature.
 */
export const OTT_PLATFORMS: Array<{ slug: string; name: string; short?: string }> = [
  { slug: 'netflix', name: 'Netflix' },
  // `short` is what goes in a <title>, where every character is rationed.
  // "Amazon Prime Video" alone pushed the tag to 72 characters, past the point
  // search engines truncate — and "Prime Video" is what people type anyway.
  { slug: 'prime-video', name: 'Amazon Prime Video', short: 'Prime Video' },
  { slug: 'jiohotstar', name: 'JioHotstar' },
  { slug: 'sonyliv', name: 'Sony LIV' },
  { slug: 'zee5', name: 'ZEE5' },
  { slug: 'sun-nxt', name: 'Sun NXT' },
  { slug: 'apple-tv', name: 'Apple TV' },
  { slug: 'aha', name: 'Aha' },
]

/** The name for a <title> or meta description; full name everywhere else. */
export function platformShort(p: { name: string; short?: string }): string {
  return p.short ?? p.name
}

export function platformBySlug(slug: string): { slug: string; name: string } | null {
  return OTT_PLATFORMS.find((p) => p.slug === slug) ?? null
}

/**
 * A hub below this many titles is a thin page, and thin pages drag the whole
 * domain down — Aha and Sun NXT can genuinely have one title in a quiet month.
 * Under the threshold the page still works for anyone who visits; it is just
 * kept out of the sitemap and served `noindex` until it has something to say.
 * See SEO-PLAN.md, principle 3.
 */
export const PLATFORM_MIN_TITLES = 3

export interface PlatformResult {
  platform: { slug: string; name: string; short?: string }
  /** Already streaming, newest arrival first — every week the cache holds. */
  streaming: OttRelease[]
  /**
   * The last seven days of `streaming`, split out because "what landed on
   * Netflix this week" is the question people actually type, and a page whose
   * title says so has to lead with it rather than bury it in three months of
   * back catalogue.
   */
  thisWeek: OttRelease[]
  /** Everything else already streaming — same list minus `thisWeek`. */
  earlier: OttRelease[]
  /** Announced for this platform, soonest first. */
  upcoming: OttRelease[]
  /** Enough content to deserve indexing. */
  indexable: boolean
}

/**
 * Everything on one platform. Deliberately not week-paged: a hub answers
 * "what is on Netflix", which is a standing question, where /movies answers
 * "what arrived this week". Returns null for a slug we do not serve, which is
 * what turns /ott/anything into a real 404 rather than an empty page.
 */
export function queryPlatform(data: ReleaseCache, slug: string): PlatformResult | null {
  const platform = platformBySlug(slug)
  if (!platform) return null
  const today = new Date().toISOString().slice(0, 10)
  const on = (r: OttRelease) => (r.platforms ?? []).includes(platform.name)
  const streaming = data.ott
    .filter((r) => on(r) && r.releaseDate <= today)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
  const upcoming = data.ottUpcoming
    .filter((r) => on(r) && r.releaseDate > today)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
  // Week 0 on the rest of the site is today-6..today; a platform hub uses the
  // same seven days so "this week" means one thing everywhere
  const weekFrom = isoDaysAgo(6)
  const thisWeek = streaming.filter((r) => r.releaseDate >= weekFrom)
  return {
    platform,
    streaming,
    thisWeek,
    earlier: streaming.filter((r) => r.releaseDate < weekFrom),
    upcoming,
    indexable: streaming.length + upcoming.length >= PLATFORM_MIN_TITLES,
  }
}

// ---------------- per-title pages ----------------

/** URL-safe slug for per-title pages; decorative (lookup is by id). */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'title'
  )
}

export function titleUrl(r: { id: string; title: string }): string {
  return `/movie/${r.id}/${slugify(r.title)}`
}

/**
 * Route of one review's own page. The slug is decorative like a title's —
 * lookup is by id — so an edited heading never orphans a shared link.
 */
export function reviewUrl(p: { id: string; title: string }): string {
  return `/review/${p.id}/${slugify(p.title)}`
}

export type TitleStatus = 'streaming' | 'upcoming-ott' | 'in-theatres' | 'upcoming-theatre'

/** Look a title up by id across all three release pools. */
export function findTitle(
  data: ReleaseCache,
  id: string
): { item: Release | OttRelease; status: TitleStatus } | null {
  const today = new Date().toISOString().slice(0, 10)
  const ott = data.ott.find((r) => r.id === id) ?? data.ottUpcoming.find((r) => r.id === id)
  if (ott) return { item: ott, status: ott.releaseDate > today ? 'upcoming-ott' : 'streaming' }
  const rel = data.releases.find((r) => r.id === id)
  if (rel) return { item: rel, status: rel.releaseDate > today ? 'upcoming-theatre' : 'in-theatres' }
  return null
}

/** Same-language titles for the detail page's "more like this" links. */
export function relatedTitles(data: ReleaseCache, item: Release, limit = 8): Release[] {
  const seen = new Set<string>([item.id])
  const out: Release[] = []
  for (const r of [...data.ott, ...data.releases, ...data.ottUpcoming]) {
    if (seen.has(r.id) || r.languageLabel !== item.languageLabel) continue
    seen.add(r.id)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

// ---------------- /api/cricket ----------------

// "India", "India Women", "India Under-19s", "India A" — but not "West Indies"
function involvesIndia(m: { teams: Array<{ name: string }> }) {
  return m.teams.some((t) => t.name.toLowerCase().startsWith('india'))
}

export interface CricketQuery {
  window?: string
  week?: string | number
  search?: string
  type?: string
}

export function queryCricket(data: CricketCache, q: CricketQuery, extras: { syncing: boolean }) {
  const today = new Date().toISOString().slice(0, 10)

  let matches = data.matches

  // Default view is international cricket; leagues/domestic on request
  if (q.type === 'league') matches = matches.filter((m) => !m.international)
  else if (q.type !== 'all') matches = matches.filter((m) => m.international)
  let weekInfo: WeekInfo | null = null

  if (q.window === 'upcoming') {
    matches = matches
      .filter((m) => m.state === 'pre' && m.date.slice(0, 10) >= today)
      .sort(
        (a, b) =>
          Number(involvesIndia(b)) - Number(involvesIndia(a)) || a.date.localeCompare(b.date)
      )
  } else {
    // Recent matches, week-paged exactly like movie releases
    const week = clampWeek(q.week, CRICKET_MAX_WEEKS)
    const to = isoDaysAgo(week * 7)
    const from = isoDaysAgo(week * 7 + 6)
    weekInfo = { index: week, from, to, maxWeeks: CRICKET_MAX_WEEKS }
    matches = matches
      .filter((m) => {
        const day = m.date.slice(0, 10)
        return day >= from && day <= to && m.state === 'post'
      })
      .sort(
        (a, b) =>
          Number(involvesIndia(b)) - Number(involvesIndia(a)) || b.date.localeCompare(a.date)
      )
  }

  if (typeof q.search === 'string' && q.search.trim()) {
    const s = q.search.trim().toLowerCase()
    matches = matches.filter(
      (m) =>
        m.name.toLowerCase().includes(s) ||
        m.series.toLowerCase().includes(s) ||
        m.venue.toLowerCase().includes(s) ||
        m.teams.some((t) => t.name.toLowerCase().includes(s))
    )
  }

  return {
    matches,
    week: weekInfo,
    meta: {
      fetchedAt: data.fetchedAt,
      source: data.source,
      total: data.matches.length,
      syncing: extras.syncing,
    },
  }
}

// ---------------- /api/track/stats ----------------

export interface Click {
  ts: string
  kind: 'watch' | 'book' | 'score' | 'share'
  platform: string
  titleId: string
  title: string
  language: string
  /** Anonymous per-browser id (localStorage UUID) — every visitor has one */
  visitorId?: string
  /** Verified Google account, only when the visitor was signed in */
  userEmail?: string
}

/**
 * Calendar day (YYYY-MM-DD) of an ISO timestamp in IST. Clicks are stored in
 * UTC, but the only reader of these numbers is in India — so "today" has to
 * mean today in Indian time, or every stat before 5:30 AM IST lands on the
 * wrong day. An unparseable timestamp falls back to its own date prefix.
 */
export function istDay(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return new Date(t + 5.5 * 60 * 60_000).toISOString().slice(0, 10)
}

function topOf(counts: Map<string, number>, limit = 20) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([title, clicks]) => ({ title, clicks }))
}

/**
 * Link each browser to the account that has signed in on it. Every click
 * carries its browser's `visitorId`, and a signed-in one carries the verified
 * email too — so those rows tell us the two ids belong to one person, which
 * lets that browser's *signed-out* clicks be attributed to them as well.
 *
 * A shared browser with two accounts binds to whichever signed in first, so
 * the mapping is deterministic rather than dependent on scan order.
 */
function linkVisitorsToAccounts(clicks: Click[]): Map<string, string> {
  const link = new Map<string, string>()
  for (const c of clicks) {
    if (!c.visitorId || !c.userEmail) continue
    if (!link.has(c.visitorId)) link.set(c.visitorId, c.userEmail.trim().toLowerCase())
  }
  return link
}

/**
 * Who a click belongs to, best-effort: the account if we can name one (directly
 * or through its browser), otherwise the browser itself. Returns null for the
 * oldest rows that predate visitor ids — those are uncountable, not anonymous.
 */
function identityOf(c: Click, link: Map<string, string>): string | null {
  if (c.userEmail) return `e:${c.userEmail.trim().toLowerCase()}`
  if (c.visitorId) {
    const email = link.get(c.visitorId)
    return email ? `e:${email}` : `v:${c.visitorId}`
  }
  return null
}

/**
 * Roll the raw click log up into the private owner dashboard's numbers.
 * `now` is injectable so the "today" window is testable and so both runtimes
 * agree. Counts only — no email ever leaves this function, even though the
 * endpoint that serves it is owner-gated.
 *
 * Three different "how many people" numbers, deliberately: `uniqueVisitors`
 * counts browsers, `signedInVisitors` counts accounts, and `uniquePeople`
 * stitches the two so one human on a phone and a laptop counts once. They
 * overlap — never add them together.
 */
export function aggregateClicks(clicks: Click[], now: Date = new Date()) {
  const today = istDay(now.toISOString())
  const link = linkVisitorsToAccounts(clicks)
  const stats = {
    totalClicks: 0,
    /** Distinct browsers (localStorage ids) — over-counts one person on many devices */
    uniqueVisitors: 0,
    /** Distinct humans: browsers folded into the account that signed in on them */
    uniquePeople: 0,
    signedInClicks: 0,
    /** Distinct verified accounts that clicked, all time */
    signedInVisitors: 0,
    /** The IST date every today* number below covers */
    today,
    todayClicks: 0,
    todayUniqueVisitors: 0,
    todayUniquePeople: 0,
    todaySignedInClicks: 0,
    /** Distinct verified accounts that clicked today */
    todaySignedInVisitors: 0,
    byKind: {} as Record<string, number>,
    byPlatform: {} as Record<string, number>,
    byLanguage: {} as Record<string, number>,
    /** Clicks per IST calendar day */
    byDay: {} as Record<string, number>,
    todayByKind: {} as Record<string, number>,
    todayByPlatform: {} as Record<string, number>,
    topTitles: [] as Array<{ title: string; clicks: number }>,
    todayTopTitles: [] as Array<{ title: string; clicks: number }>,
    since: null as string | null,
  }
  const titleCounts = new Map<string, number>()
  const todayTitleCounts = new Map<string, number>()
  const visitors = new Set<string>()
  const accounts = new Set<string>()
  const people = new Set<string>()
  const todayVisitors = new Set<string>()
  const todayAccounts = new Set<string>()
  const todayPeople = new Set<string>()
  for (const c of clicks) {
    const day = istDay(c.ts)
    const isToday = day === today
    const who = identityOf(c, link)
    stats.totalClicks++
    if (!stats.since || c.ts < stats.since) stats.since = c.ts
    if (c.visitorId) visitors.add(c.visitorId)
    if (who) people.add(who)
    if (c.userEmail) {
      stats.signedInClicks++
      accounts.add(c.userEmail)
    }
    stats.byKind[c.kind] = (stats.byKind[c.kind] ?? 0) + 1
    stats.byPlatform[c.platform] = (stats.byPlatform[c.platform] ?? 0) + 1
    if (c.language) stats.byLanguage[c.language] = (stats.byLanguage[c.language] ?? 0) + 1
    stats.byDay[day] = (stats.byDay[day] ?? 0) + 1
    titleCounts.set(c.title, (titleCounts.get(c.title) ?? 0) + 1)
    if (!isToday) continue
    stats.todayClicks++
    if (c.visitorId) todayVisitors.add(c.visitorId)
    if (who) todayPeople.add(who)
    if (c.userEmail) {
      stats.todaySignedInClicks++
      todayAccounts.add(c.userEmail)
    }
    stats.todayByKind[c.kind] = (stats.todayByKind[c.kind] ?? 0) + 1
    stats.todayByPlatform[c.platform] = (stats.todayByPlatform[c.platform] ?? 0) + 1
    todayTitleCounts.set(c.title, (todayTitleCounts.get(c.title) ?? 0) + 1)
  }
  stats.uniqueVisitors = visitors.size
  stats.uniquePeople = people.size
  stats.signedInVisitors = accounts.size
  stats.todayUniqueVisitors = todayVisitors.size
  stats.todayUniquePeople = todayPeople.size
  stats.todaySignedInVisitors = todayAccounts.size
  stats.topTitles = topOf(titleCounts)
  stats.todayTopTitles = topOf(todayTitleCounts, 10)
  return stats
}

export type ClickStats = ReturnType<typeof aggregateClicks>

/**
 * One signed-in action by a verified account. WeekAdda has no user table —
 * "members" are simply the Google accounts that have ever done something that
 * needs sign-in, so they're derived by unioning the emails across every store.
 */
export interface MemberActivity {
  email?: string | null
  ts: string
  source: 'click' | 'blog' | 'rating' | 'adda'
}

/**
 * How many distinct Google accounts use the site. Emails are only ever hashed
 * into Set membership here — the return value is counts, never addresses.
 * `firstSeen` is derived from the earliest activity we hold, so an account that
 * signed in before a store was introduced counts from its first surviving row.
 */
export function countMembers(activity: MemberActivity[], now: Date = new Date()) {
  const today = istDay(now.toISOString())
  const all = new Set<string>()
  const activeToday = new Set<string>()
  const firstSeen = new Map<string, string>()
  const bySource: Record<MemberActivity['source'], Set<string>> = {
    click: new Set(),
    blog: new Set(),
    rating: new Set(),
    adda: new Set(),
  }
  for (const a of activity) {
    const email = (a.email ?? '').trim().toLowerCase()
    if (!email) continue
    all.add(email)
    bySource[a.source]?.add(email)
    if (istDay(a.ts) === today) activeToday.add(email)
    const prev = firstSeen.get(email)
    if (!prev || a.ts < prev) firstSeen.set(email, a.ts)
  }
  let newToday = 0
  for (const ts of firstSeen.values()) if (istDay(ts) === today) newToday++
  return {
    /** Distinct Google accounts that have ever signed in and done something */
    members: all.size,
    /** …of those, how many were active today (IST) */
    membersToday: activeToday.size,
    /** …and how many were seen for the first time today */
    newMembersToday: newToday,
    membersBySource: {
      click: bySource.click.size,
      blog: bySource.blog.size,
      rating: bySource.rating.size,
      adda: bySource.adda.size,
    },
  }
}

export type MemberStats = ReturnType<typeof countMembers>

// ---------------------------------------------------------------- auth

export interface GoogleProfile {
  email: string
  name: string
  picture: string
}

/**
 * Verify a Google sign-in token via Google's tokeninfo endpoint — accepts the
 * OAuth access token our popup flow issues (checked first) or a GIS ID token.
 * Returns the profile when the token is valid and issued for our client id;
 * null otherwise. Platform-neutral (fetch exists in Workers and Node 18+).
 */
export async function verifyGoogleToken(
  token: string,
  clientId: string
): Promise<GoogleProfile | null> {
  try {
    // Access token (custom-button popup flow)
    const at = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    if (at.ok) {
      const p = (await at.json()) as Record<string, string>
      if (p.aud === clientId && p.email_verified === 'true' && p.email) {
        // Display name/photo live on the userinfo endpoint
        const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const u = ui.ok ? ((await ui.json()) as Record<string, string>) : {}
        return { email: p.email, name: u.name ?? '', picture: u.picture ?? '' }
      }
    }
    // ID token (JWT credential)
    const it = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    )
    if (!it.ok) return null
    const p = (await it.json()) as Record<string, string>
    if (p.aud !== clientId || p.email_verified !== 'true') return null
    return { email: p.email ?? '', name: p.name ?? '', picture: p.picture ?? '' }
  } catch {
    return null
  }
}

/**
 * Is this verified Google email the site owner's? Guards the private /stats
 * dashboard — the one surface that isn't for visitors. `ownerEmail` is the
 * OWNER_EMAIL config value and may list several accounts, comma-separated.
 *
 * Fails closed on purpose: with OWNER_EMAIL unset nobody passes, so a deploy
 * that forgot the variable locks the dashboard instead of opening it. The
 * email compared here always comes from verifyGoogleToken, never from the
 * request body — a client cannot claim to be the owner.
 */
export function isOwnerEmail(email: string | undefined, ownerEmail: string | undefined): boolean {
  const who = (email ?? '').trim().toLowerCase()
  if (!who) return false
  return (ownerEmail ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(who)
}

// ---------------------------------------------------------------- adda (community board)

export interface AddaListing {
  id: string
  ts: string
  author: string
  /** Verified Google account — server-side; revealed only via mutual interest */
  authorEmail: string
  /** Optional, poster's wish; revealed only with interest, never in public lists */
  whatsapp?: string
  title: string
  details: string
  status: 'open' | 'closed'
}

export interface AddaInterest {
  listingId: string
  userEmail: string
  name: string
  ts: string
}

// ---------------------------------------------------------------- push

/**
 * A browser's Web Push registration. Deliberately anonymous — the endpoint is
 * issued by the browser vendor, so there is no account, email or visitor id
 * here, and subscribing never requires signing in. See PUSH-PLAN.md.
 */
export interface PushSubscriptionRecord {
  endpoint: string
  p256dh: string
  auth: string
  languages: string[]
  /** IANA zone the browser reported, so we notify at breakfast where they are. */
  timezone?: string
}

/** When we notify, in the subscriber's own clock. */
export const NOTIFY_HOUR = 9

/**
 * How many hours after that still count. Scheduled runs are queued and often
 * start late, so insisting on exactly 9 would silently skip a whole day for
 * everyone in that zone. Ten o'clock is a perfectly good time to hear about a
 * film; a missed day is not.
 */
export const NOTIFY_WINDOW = 2

/** Hours we are willing to make somebody's phone buzz, in their own time. */
const CIVIL_FROM = 8
const CIVIL_UNTIL = 20

/**
 * Is it notification time where this subscriber lives?
 *
 * India and the USA get 9 AM exactly, because the schedule runs the hours those
 * two need. Nobody else would ever see their own 9 AM come round, so they take
 * the first scheduled run that lands in their daytime instead — the caller's
 * once-a-day guard then keeps it to that one.
 *
 * Daytime, not simply "the India run": that run is 3 AM in London. Being woken
 * at 3 AM is how a person turns notifications off for good, and a notification
 * that arrives in the afternoon is worth far more than one that arrives at all
 * costs.
 */
export function isNotifyTime(
  timezone: string | null | undefined,
  _utcHour: number,
  now: Date = new Date()
): boolean {
  const { hour } = localClock(timezone, now)
  if (hour >= NOTIFY_HOUR && hour < NOTIFY_HOUR + NOTIFY_WINDOW) return true

  const zone = timezone || 'Asia/Kolkata'
  const onSchedule =
    zone.startsWith('America/') ||
    zone.startsWith('Asia/Kolkata') ||
    zone.startsWith('Asia/Calcutta') ||
    zone.startsWith('Pacific/Honolulu')
  return !onSchedule && hour >= CIVIL_FROM && hour <= CIVIL_UNTIL
}

/**
 * The hour and calendar day it currently is somewhere. Intl does the whole job
 * — offsets, half-hour zones and daylight saving all come for free, which is
 * the reason not to store a UTC offset and do the arithmetic ourselves.
 * An unrecognised zone falls back to India, since that is who this is for.
 */
export function localClock(
  timezone: string | null | undefined,
  now: Date = new Date()
): { hour: number; day: string } {
  const zone = timezone || 'Asia/Kolkata'
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    }).formatToParts(now)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    // en-CA gives ISO-ordered parts, and hour "24" means midnight
    return { hour: Number(get('hour')) % 24, day: `${get('year')}-${get('month')}-${get('day')}` }
  }
  try {
    return read(zone)
  } catch {
    return read('Asia/Kolkata')
  }
}

/**
 * Validate what the browser posted. The endpoint and keys come from the Push
 * API rather than from a form, so the checks are about rejecting junk and
 * anything oversized, not about trusting a user.
 *
 * Languages are narrowed to the ones we actually publish: an unknown code would
 * silently never match a release, leaving someone subscribed to nothing and
 * wondering why they hear nothing. Returns null when there is nothing usable.
 */
export function buildPushSubscription(body: unknown): PushSubscriptionRecord | null {
  const b = (body ?? {}) as Record<string, unknown>
  const sub = (b.subscription ?? {}) as Record<string, unknown>
  const keys = (sub.keys ?? {}) as Record<string, unknown>
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : ''
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : ''
  const auth = typeof keys.auth === 'string' ? keys.auth : ''
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return null

  const known = new Set(LANGUAGES.map((l) => l.code))
  const languages = Array.isArray(b.languages)
    ? [...new Set(b.languages.filter((l): l is string => typeof l === 'string' && known.has(l)))]
    : []
  if (languages.length === 0) return null

  // Validated by asking Intl to use it: a made-up zone throws, and anything
  // that survives is a zone we can actually schedule against
  let timezone: string | undefined
  if (typeof b.timezone === 'string' && b.timezone.length <= 64) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: b.timezone })
      timezone = b.timezone
    } catch {
      timezone = undefined
    }
  }

  return { endpoint, p256dh, auth, languages: languages.slice(0, 20), timezone }
}

/**
 * The titles arriving today, in IST, for one subscriber's languages — the whole
 * question the send step asks. Empty means stay quiet, which is the feature:
 * a notification on a day with nothing in your languages is the one that gets
 * the whole thing switched off.
 */
export function todaysReleasesFor(
  data: ReleaseCache,
  languages: string[],
  now: Date = new Date()
): OttRelease[] {
  const today = istDay(now.toISOString())
  const wanted = new Set(languages)
  return data.ott.filter((r) => r.releaseDate === today && wanted.has(r.language))
}

/** "3 new Telugu releases today" — plural, language-aware, no title list. */
export function pushHeadline(items: OttRelease[]): string {
  const labels = [...new Set(items.map((r) => r.languageLabel))]
  const langs =
    labels.length === 1
      ? `${labels[0]} `
      : labels.length === 2
        ? `${labels[0]} & ${labels[1]} `
        : ''
  return `${items.length} new ${langs}release${items.length === 1 ? '' : 's'} today`
}

/** "Kingdom, Vaari and 2 more — on Netflix, ZEE5" */
export function pushBody(items: OttRelease[]): string {
  const names = items.slice(0, 2).map((r) => r.title)
  const rest = items.length - names.length
  const titles = rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ')
  const platforms = [...new Set(items.flatMap((r) => r.platforms))].slice(0, 3)
  return platforms.length ? `${titles} — on ${platforms.join(', ')}` : titles
}

export const ADDA_MAX_AGE_DAYS = 30

/** Public shape: contact details stripped. */
export function publicListing(l: AddaListing): Omit<AddaListing, 'authorEmail' | 'whatsapp'> {
  const { authorEmail: _e, whatsapp: _w, ...pub } = l
  return pub
}

/** Validate + sanitize a new listing; requires a verified poster. */
export function buildListing(input: unknown, verified: GoogleProfile): AddaListing | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  const details = String(raw.details ?? '').trim().slice(0, 2000)
  if (!title || details.length < 10) return null
  const whatsapp = String(raw.whatsapp ?? '')
    .replace(/[^\d+]/g, '')
    .slice(0, 16)
  return {
    id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    author:
      String(raw.author ?? '').trim().slice(0, 40) ||
      (verified.name || '').trim().slice(0, 40) ||
      'Someone',
    authorEmail: verified.email,
    ...(whatsapp.length >= 10 ? { whatsapp } : {}),
    title,
    details,
    status: 'open',
  }
}

/** Open, non-expired listings, newest first. */
export function liveListings(listings: AddaListing[]): AddaListing[] {
  const cutoff = new Date(Date.now() - ADDA_MAX_AGE_DAYS * 86_400_000).toISOString()
  return listings
    .filter((l) => l.status === 'open' && l.ts >= cutoff)
    .sort((a, b) => b.ts.localeCompare(a.ts))
}

// ---------------------------------------------------------------- blog

/** What a post is about: a movie/series from releases or a cricket match. */
export interface BlogTag {
  kind: 'movie' | 'match'
  id: string
  label: string
  sub: string
  poster: string | null
  /** Match posts: the two team flag images */
  logos?: string[]
}

export interface BlogPost {
  id: string
  ts: string
  author: string
  /** Verified Google account of the writer — kept server-side for moderation,
   *  stripped from every public API response. */
  authorEmail?: string
  title: string
  body: string
  tag: BlogTag
}

/** Public shape of a post: everything except the writer's email. */
export function publicPost(post: BlogPost): Omit<BlogPost, 'authorEmail'> {
  const { authorEmail: _authorEmail, ...pub } = post
  return pub
}

// ---------------- blog post ratings ----------------

export interface PostRating {
  postId: string
  userEmail: string
  rating: number // 1..5
  ts: string
}

export interface RatingSummary {
  avg: number
  count: number
  /** The viewer's own rating, present only on authenticated reads */
  mine?: number
}

export function sanitizeRating(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Per-post average/count (+ the viewer's own rating when email given). */
export function summarizeRatings(
  rows: Array<Pick<PostRating, 'postId' | 'userEmail' | 'rating'>>,
  viewerEmail?: string
): Record<string, RatingSummary> {
  const acc = new Map<string, { sum: number; count: number; mine?: number }>()
  for (const r of rows) {
    const a = acc.get(r.postId) ?? { sum: 0, count: 0 }
    a.sum += r.rating
    a.count++
    if (viewerEmail && r.userEmail === viewerEmail) a.mine = r.rating
    acc.set(r.postId, a)
  }
  const out: Record<string, RatingSummary> = {}
  for (const [id, a] of acc) {
    out[id] = {
      avg: Math.round((a.sum / a.count) * 10) / 10,
      count: a.count,
      ...(a.mine ? { mine: a.mine } : {}),
    }
  }
  return out
}

/** Validate + sanitize an incoming post; null when it isn't publishable. */
export function buildPost(
  input: unknown,
  verified?: GoogleProfile | null,
  ownerEmail?: string
): BlogPost | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const tagRaw = (raw.tag ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  const body = String(raw.body ?? '').trim().slice(0, 5000)
  // Display name stays self-chosen; a signed-in user's Google name is the
  // fallback before Anonymous. Reviews carry no official stamp, but the site's
  // byline is still reserved here — otherwise it could be worn on a review.
  const author = resolveAuthor(raw.author, verified, isOwnerEmail(verified?.email, ownerEmail))
  const kind = tagRaw.kind
  const label = String(tagRaw.label ?? '').trim().slice(0, 160)
  if (!title || !body || !label) return null
  if (kind !== 'movie' && kind !== 'match') return null
  return {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    author,
    ...(verified?.email ? { authorEmail: verified.email } : {}),
    title,
    body,
    tag: {
      kind,
      id: String(tagRaw.id ?? '').slice(0, 120),
      label,
      sub: String(tagRaw.sub ?? '').trim().slice(0, 160),
      poster: typeof tagRaw.poster === 'string' ? tagRaw.poster.slice(0, 400) : null,
      logos: Array.isArray(tagRaw.logos)
        ? tagRaw.logos
            .filter((l): l is string => typeof l === 'string' && l.length > 0)
            .slice(0, 2)
            .map((l) => l.slice(0, 400))
        : [],
    },
  }
}

// ---------------- articles ----------------

/**
 * The other kind of writing on the site. A review answers "is this week's film
 * worth it" and is tagged to a title the release cache holds; an article has no
 * such anchor — the 1983 final, a top-ten list, why a twenty-year-old film
 * still holds up. Nothing in the release or cricket caches can date it.
 *
 * Deliberately its own table and its own type rather than a `kind` column on
 * BlogPost: an article has no tag, and making `tag` optional would put a
 * null check on every `p.tag.label` in the feed, the pre-render, the sitemap
 * and the mini player. Separate types mean an article cannot end up in the
 * reviews feed by an omitted filter — it is not the same shape.
 *
 * No star ratings, unlike reviews — see the ratings note in CLAUDE.md.
 */
export interface Article {
  id: string
  ts: string
  author: string
  /** Verified Google account of the writer — never returned by a public API. */
  authorEmail?: string
  /**
   * Published by the site itself rather than a visitor. Set server-side from
   * the verified email against OWNER_EMAIL — never from anything the browser
   * sends, or the stamp would mean nothing.
   */
  official?: boolean
  /** Which half of the site it belongs to; drives the related-articles panel. */
  topic: 'movie' | 'match'
  title: string
  body: string
  /**
   * Films the article is about, with where to watch them. Movie articles only.
   *
   * The platforms are **stated, not looked up**: an article is usually about
   * something old, and the release cache only holds thirteen weeks, so it has
   * never heard of the films these pieces are actually about. When the writer
   * picks a film the cache does hold, the composer fills these in from it;
   * otherwise they name the platform themselves. Either way the link is a
   * search on that platform (watchUrl), which needs only the title.
   */
  films?: ArticleFilm[]
  /**
   * Cover image, uploaded with the article. Articles only — a review is a
   * paragraph about something that already carries a poster, and an image
   * there would only ever be borrowing someone else's picture.
   */
  image?: string
  /**
   * How the cover is framed, chosen after upload rather than baked into the
   * file. A cover is cropped to a fixed height, and the crop is wrong as often
   * as it is right — a team photo loses heads, a portrait loses the face.
   *
   * `imagePosition` is a CSS object-position ("50% 30%") naming the point that
   * must stay visible; `imageFit: 'contain'` shows the whole picture instead of
   * filling the frame. Neither touches the stored bytes, so re-framing is free
   * and reversible.
   */
  imagePosition?: string
  imageFit?: 'cover' | 'contain'
}

/** A focal point like "50% 30%", clamped; anything else is ignored. */
export function sanitizeImagePosition(input: unknown): string | undefined {
  const match = /^(\d{1,3})%\s+(\d{1,3})%$/.exec(String(input ?? '').trim())
  if (!match) return undefined
  const clamp = (n: string) => Math.min(100, Math.max(0, Number(n)))
  return `${clamp(match[1])}% ${clamp(match[2])}%`
}

/** Image types worth accepting; anything else is refused before it is stored. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

/** 4 MB — enough for a cover, small enough not to become a free file host. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * The only two shapes a stored cover may take: a path this server serves, or
 * an https URL (Supabase Storage in production). Anything else — `javascript:`,
 * a `data:` blob, a bare string — is dropped rather than rendered into an
 * <img src>. The value arrives from our own upload endpoint, but it arrives
 * via the browser, which makes it input like any other.
 */
export function sanitizeImage(input: unknown): string | undefined {
  const url = String(input ?? '').trim().slice(0, 500)
  if (!url) return undefined
  if (/^\/api\/articles\/image\/[A-Za-z0-9._-]+$/.test(url)) return url
  if (/^https:\/\/[^\s"'<>]+$/.test(url)) return url
  return undefined
}

/** Extension for a stored upload, or null when the type is not one we accept. */
export function imageExtension(contentType: string | null | undefined): string | null {
  return IMAGE_TYPES[(contentType ?? '').split(';')[0].trim().toLowerCase()] ?? null
}

export interface ArticleFilm {
  /** WeekAdda title id, when the film is still inside the release window. */
  id?: string
  title: string
  platforms: ArticleWatch[]
}

/**
 * One place to watch a film. `url` is the exact title page when the writer has
 * it — always better than a search, which can land on the wrong film or on
 * nothing. Without one we fall back to searching that platform for the title.
 */
export interface ArticleWatch {
  name: string
  url?: string
}

const MAX_ARTICLE_FILMS = 6

function sanitizeFilms(input: unknown): ArticleFilm[] {
  if (!Array.isArray(input)) return []
  const out: ArticleFilm[] = []
  for (const raw of input.slice(0, MAX_ARTICLE_FILMS)) {
    const f = (raw ?? {}) as Record<string, unknown>
    const title = String(f.title ?? '').trim().slice(0, 120)
    if (!title) continue
    const id = String(f.id ?? '').trim().slice(0, 120)
    const platforms: ArticleWatch[] = []
    if (Array.isArray(f.platforms)) {
      for (const raw of f.platforms) {
        // A bare string is still accepted — it is what the picker sent before
        // deep links existed, and dropping it would blank an existing article
        const entry = typeof raw === 'string' ? { name: raw } : ((raw ?? {}) as Record<string, unknown>)
        const name = String(entry.name ?? '').trim().slice(0, 60)
        if (!name || platforms.some((p) => p.name === name)) continue
        const url = String(entry.url ?? '').trim().slice(0, 500)
        // https only: the link is rendered as an anchor a reader will click
        platforms.push({ name, ...(/^https:\/\/[^\s"'<>]+$/.test(url) ? { url } : {}) })
        if (platforms.length === 4) break
      }
    }
    out.push({ ...(id ? { id } : {}), title, platforms })
  }
  return out
}

/**
 * The byline the site publishes under. Reserved: a visitor cannot take it as a
 * display name, because a name is typed and therefore not evidence of anything.
 * The `official` flag is what the stamp reads — this only stops the name being
 * worn by someone the flag would not be set for.
 */
export const OFFICIAL_AUTHOR = 'WeekAdda'

function claimsOfficialName(name: string): boolean {
  return name.trim().toLowerCase().replace(/\s+/g, '') === OFFICIAL_AUTHOR.toLowerCase()
}

/**
 * Display name for a post: self-chosen, falling back to the Google name and
 * then Anonymous — except that only the owner account may publish under the
 * site's own byline.
 */
function resolveAuthor(raw: unknown, verified: GoogleProfile | null | undefined, official: boolean) {
  const asked = String(raw ?? '').trim().slice(0, 40)
  if (asked && (official || !claimsOfficialName(asked))) return asked
  if (official) return OFFICIAL_AUTHOR
  const google = (verified?.name ?? '').trim().slice(0, 40)
  return google && !claimsOfficialName(google) ? google : 'Anonymous'
}

export const ARTICLE_TOPICS: Array<{ value: Article['topic']; label: string }> = [
  { value: 'movie', label: 'Movies' },
  { value: 'match', label: 'Cricket' },
]

export function articleTopicLabel(topic: Article['topic']): string {
  return ARTICLE_TOPICS.find((t) => t.value === topic)?.label ?? 'Movies'
}

/** Public shape of an article: everything except the writer's email. */
export function publicArticle(a: Article): Omit<Article, 'authorEmail'> {
  const { authorEmail: _authorEmail, ...pub } = a
  return pub
}

export function articleUrl(a: { id: string; title: string }): string {
  return `/article/${a.id}/${slugify(a.title)}`
}

/** Validate + sanitize an incoming article; null when it isn't publishable. */
export function buildArticle(
  input: unknown,
  verified?: GoogleProfile | null,
  ownerEmail?: string
): Article | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  // Longer than a review's 5000: a top-ten list is ten little essays
  const body = String(raw.body ?? '').trim().slice(0, 20000)
  // Read from the verified email, never from the request body — except that
  // the owner may decline it. Owning the site is what *permits* the stamp; it
  // should not force every personal piece to be published as the masthead.
  const official = isOwnerEmail(verified?.email, ownerEmail) && raw.official !== false
  const author = resolveAuthor(raw.author, verified, official)
  const topic = raw.topic
  if (!title || !body) return null
  if (topic !== 'movie' && topic !== 'match') return null
  // Not gated on topic: a piece about the 1983 final is filed under cricket and
  // still wants to point at the film of it. The block is about films, not about
  // which half of the site the article sits in.
  const films = sanitizeFilms(raw.films)
  const image = sanitizeImage(raw.image)
  // Framing is meaningless without a picture to frame
  const imagePosition = image ? sanitizeImagePosition(raw.imagePosition) : undefined
  const imageFit = image && raw.imageFit === 'contain' ? ('contain' as const) : undefined
  return {
    id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    author,
    ...(verified?.email ? { authorEmail: verified.email } : {}),
    ...(official ? { official: true } : {}),
    topic,
    title,
    body,
    ...(films.length > 0 ? { films } : {}),
    ...(image ? { image } : {}),
    ...(imagePosition ? { imagePosition } : {}),
    ...(imageFit ? { imageFit } : {}),
  }
}

/**
 * Re-sanitize an edit onto an existing review. Same rules as an article's:
 * rebuilt field by field so a cleared tag cannot linger, and identity — id,
 * timestamp, author, verified email — is not editable. An edit changes what
 * the review says, never who wrote it.
 */
export function applyPostEdit(existing: BlogPost, input: unknown): BlogPost | null {
  const rebuilt = buildPost(input, null)
  if (!rebuilt) return null
  return {
    id: existing.id,
    ts: existing.ts,
    author: existing.author,
    ...(existing.authorEmail ? { authorEmail: existing.authorEmail } : {}),
    title: rebuilt.title,
    body: rebuilt.body,
    tag: rebuilt.tag,
  }
}

/**
 * What to show under a review: other takes on the same film or match first —
 * the most useful thing to read next is a second opinion on the same title —
 * then the newest of everything else so the row is never left half empty.
 */
export function relatedReviews(all: BlogPost[], id: string, limit = 6): BlogPost[] {
  const self = all.find((p) => p.id === id)
  const others = all.filter((p) => p.id !== id).sort((a, b) => (a.ts < b.ts ? 1 : -1))
  if (!self?.tag?.id) return others.slice(0, limit)
  const sameTitle = others.filter((p) => p.tag?.id === self.tag.id)
  return [...sameTitle, ...others.filter((p) => p.tag?.id !== self.tag.id)].slice(0, limit)
}

/**
 * May this account change this review? Only the verified writer. A review
 * published anonymously has no email attached, belongs to nobody, and can
 * never be claimed afterwards.
 */
export function canEditPost(post: BlogPost, email: string | undefined): boolean {
  return Boolean(post.authorEmail && email && post.authorEmail === email)
}

// ---------------- article likes ----------------

/**
 * A heart on an article. One per account, toggled off by tapping again.
 *
 * Deliberately not the five-star row reviews use: a review is being judged on
 * how useful it was, an article is just liked or not. A single count also can
 * never be mistaken for a verdict on the film or match it discusses, which is
 * the mistake the review stars already have to keep explaining.
 */
export interface ArticleLike {
  articleId: string
  userEmail: string
  ts: string
}

export interface LikeSummary {
  count: number
  /** Whether the asking account has liked it; only on authenticated reads. */
  mine?: boolean
}

export function summarizeLikes(
  rows: Array<Pick<ArticleLike, 'articleId' | 'userEmail'>>,
  viewerEmail?: string
): Record<string, LikeSummary> {
  const out: Record<string, LikeSummary> = {}
  for (const row of rows) {
    const entry = out[row.articleId] ?? { count: 0 }
    entry.count++
    if (viewerEmail && row.userEmail === viewerEmail) entry.mine = true
    out[row.articleId] = entry
  }
  return out
}

/**
 * Re-sanitize an edit onto an existing article.
 *
 * Rebuilt field by field rather than merged, so clearing the cover or dropping
 * a film actually removes it — a spread would silently keep whatever was there
 * before and make deletion impossible.
 *
 * Identity is not editable: id, timestamp, author, the verified email and the
 * official stamp all come from the stored article. An edit changes what the
 * piece says, never who published it.
 */
export function applyArticleEdit(existing: Article, input: unknown): Article | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  const body = String(raw.body ?? '').trim().slice(0, 20000)
  const topic = raw.topic
  if (!title || !body) return null
  if (topic !== 'movie' && topic !== 'match') return null
  const films = sanitizeFilms(raw.films)
  const image = sanitizeImage(raw.image)
  const imagePosition = image ? sanitizeImagePosition(raw.imagePosition) : undefined
  const imageFit = image && raw.imageFit === 'contain' ? ('contain' as const) : undefined
  return {
    id: existing.id,
    ts: existing.ts,
    author: existing.author,
    ...(existing.authorEmail ? { authorEmail: existing.authorEmail } : {}),
    ...(existing.official ? { official: true } : {}),
    topic,
    title,
    body,
    ...(films.length > 0 ? { films } : {}),
    ...(image ? { image } : {}),
    ...(imagePosition ? { imagePosition } : {}),
    ...(imageFit ? { imageFit } : {}),
  }
}

/**
 * May this account change this article? Only the verified writer — the stamp
 * and the display name are not evidence, and an article with no email attached
 * (published anonymously) belongs to nobody and can never be claimed.
 */
export function canEditArticle(article: Article, email: string | undefined): boolean {
  return Boolean(article.authorEmail && email && article.authorEmail === email)
}

/**
 * What to put in the panel beside an article: others on the same topic first,
 * newest first, topped up from the rest so a thin topic still fills the rail
 * rather than showing the reader a near-empty column.
 */
export function relatedArticles<T extends { id: string; topic: Article['topic']; ts: string }>(
  all: T[],
  id: string,
  limit = 12
): T[] {
  const self = all.find((a) => a.id === id)
  const others = all.filter((a) => a.id !== id).sort((a, b) => (a.ts < b.ts ? 1 : -1))
  if (!self) return others.slice(0, limit)
  const same = others.filter((a) => a.topic === self.topic)
  return [...same, ...others.filter((a) => a.topic !== self.topic)].slice(0, limit)
}

