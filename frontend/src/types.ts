export interface Release {
  id: string
  title: string
  originalTitle: string
  language: string
  languageLabel: string
  /** Every language it released in, original first — only on pan-India films */
  languages?: string[]
  releaseDate: string
  overview: string
  poster: string | null
  rating: number
  votes: number
  platforms?: string[] // present on OTT releases
  contentType?: 'movie' | 'series' // present on OTT releases
}

export interface ReleaseMeta {
  fetchedAt: string
  source: 'tmdb' | 'sample'
  total: number
  ottTotal: number
  syncing: boolean
  liveConfigured: boolean
}

export interface LanguageInfo {
  code: string
  label: string
}

export interface WeekInfo {
  index: number
  from: string
  to: string
  maxWeeks: number
}

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
  date: string
  venue: string
  state: 'pre' | 'in' | 'post'
  statusDetail: string
  international: boolean
  url: string | null
  label: string
  teams: CricketTeam[]
}

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
  title: string
  body: string
  tag: BlogTag
}

export interface RatingSummary {
  avg: number
  count: number
  /** The viewer's own rating, present only when signed in */
  mine?: number
}

/**
 * Outbound-click rollup behind the private /stats page. Mirrors the backend's
 * aggregateClicks return shape; "today" means today in IST, and only counts
 * cross the wire — never a visitor's email.
 */
export interface ClickStats {
  totalClicks: number
  /** Distinct browsers — over-counts one person using several devices */
  uniqueVisitors: number
  /** Distinct humans — browsers folded into the account that signed in on them */
  uniquePeople: number
  signedInClicks: number
  signedInVisitors: number
  today: string
  todayClicks: number
  todayUniqueVisitors: number
  todayUniquePeople: number
  todaySignedInClicks: number
  todaySignedInVisitors: number
  byKind: Record<string, number>
  byPlatform: Record<string, number>
  byLanguage: Record<string, number>
  byDay: Record<string, number>
  todayByKind: Record<string, number>
  todayByPlatform: Record<string, number>
  topTitles: Array<{ title: string; clicks: number }>
  todayTopTitles: Array<{ title: string; clicks: number }>
  since: string | null
  /** Distinct Google accounts that have ever signed in and done something */
  members: number
  membersToday: number
  newMembersToday: number
  /** Distinct accounts per feature; an account can appear in several */
  membersBySource: { click: number; blog: number; rating: number; adda: number }
}

export interface CricketMeta {
  fetchedAt: string
  source: 'espn' | 'sample'
  total: number
  syncing: boolean
}
