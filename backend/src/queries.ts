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
  language: string // ISO code, e.g. 'te'
  languageLabel: string // e.g. 'Telugu'
  releaseDate: string // YYYY-MM-DD
  overview: string
  poster: string | null // full image URL when available
  rating: number // 0–10 (0 = not yet rated)
  votes: number
}

export interface OttRelease extends Release {
  platforms: string[] // e.g. ['Netflix', 'ZEE5']
  week: number // which weekly bucket (0 = this week) the digital release fell into
  contentType: 'movie' | 'series'
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

export const LANGUAGES = [
  { code: 'te', label: 'Telugu' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'bn', label: 'Bengali' },
  { code: 'mr', label: 'Marathi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'en', label: 'English' },
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

  if (typeof q.language === 'string' && q.language && q.language !== 'all') {
    releases = releases.filter((r) => r.language === q.language)
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

  return { endpoint, p256dh, auth, languages: languages.slice(0, 20) }
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
export function buildPost(input: unknown, verified?: GoogleProfile | null): BlogPost | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const tagRaw = (raw.tag ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  const body = String(raw.body ?? '').trim().slice(0, 5000)
  // Display name stays self-chosen; a signed-in user's Google name is the
  // fallback before Anonymous
  const author =
    String(raw.author ?? '').trim().slice(0, 40) ||
    (verified?.name ?? '').trim().slice(0, 40) ||
    'Anonymous'
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

