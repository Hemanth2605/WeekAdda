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
}

export function aggregateClicks(clicks: Click[]) {
  const stats = {
    totalClicks: 0,
    byKind: {} as Record<string, number>,
    byPlatform: {} as Record<string, number>,
    byLanguage: {} as Record<string, number>,
    byDay: {} as Record<string, number>,
    topTitles: [] as Array<{ title: string; clicks: number }>,
    since: null as string | null,
  }
  const titleCounts = new Map<string, number>()
  for (const c of clicks) {
    stats.totalClicks++
    if (!stats.since) stats.since = c.ts
    stats.byKind[c.kind] = (stats.byKind[c.kind] ?? 0) + 1
    stats.byPlatform[c.platform] = (stats.byPlatform[c.platform] ?? 0) + 1
    if (c.language) stats.byLanguage[c.language] = (stats.byLanguage[c.language] ?? 0) + 1
    const day = c.ts.slice(0, 10)
    stats.byDay[day] = (stats.byDay[day] ?? 0) + 1
    titleCounts.set(c.title, (titleCounts.get(c.title) ?? 0) + 1)
  }
  stats.topTitles = [...titleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([title, clicks]) => ({ title, clicks }))
  return stats
}

// ---------------------------------------------------------------- blog

/** What a post is about: a movie/series from releases or a cricket match. */
export interface BlogTag {
  kind: 'movie' | 'match'
  id: string
  label: string
  sub: string
  poster: string | null
}

export interface BlogPost {
  id: string
  ts: string
  author: string
  title: string
  body: string
  tag: BlogTag
}

/** Validate + sanitize an incoming post; null when it isn't publishable. */
export function buildPost(input: unknown): BlogPost | null {
  const raw = (input ?? {}) as Record<string, unknown>
  const tagRaw = (raw.tag ?? {}) as Record<string, unknown>
  const title = String(raw.title ?? '').trim().slice(0, 120)
  const body = String(raw.body ?? '').trim().slice(0, 5000)
  const author = String(raw.author ?? '').trim().slice(0, 40) || 'Anonymous'
  const kind = tagRaw.kind
  const label = String(tagRaw.label ?? '').trim().slice(0, 160)
  if (!title || !body || !label) return null
  if (kind !== 'movie' && kind !== 'match') return null
  return {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    author,
    title,
    body,
    tag: {
      kind,
      id: String(tagRaw.id ?? '').slice(0, 120),
      label,
      sub: String(tagRaw.sub ?? '').trim().slice(0, 160),
      poster: typeof tagRaw.poster === 'string' ? tagRaw.poster.slice(0, 400) : null,
    },
  }
}

