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
  /**
   * The ✓ WeekAdda stamp, as on an article. Server-set from the verified email,
   * never from what was typed — so it is read here rather than the author name,
   * which is evidence of nothing. Absent on every review written before this
   * existed, hence optional.
   */
  official?: boolean
}

/**
 * The other kind of writing: no release to hang on, so no tag — the 1983
 * final, a top-ten list, an old film revisited. Its own type, not a variant of
 * BlogPost, which is what keeps it out of the reviews feed by construction.
 * No star ratings, unlike a review.
 */
export interface Article {
  id: string
  ts: string
  author: string
  /**
   * Published by the site itself rather than a visitor. Server-set from the
   * verified email against OWNER_EMAIL — never from anything the browser
   * sends, so the stamp cannot be earned by typing "WeekAdda" as a name.
   */
  official?: boolean
  topic: 'movie' | 'match'
  title: string
  body: string
  /** Movie articles: films the piece is about, and where to watch them. */
  films?: ArticleFilm[]
  /** Cover image, uploaded with the article. Articles only, never reviews. */
  image?: string
  /**
   * How the cover is framed, chosen after upload rather than baked into the
   * file. `imagePosition` is a CSS object-position ("50% 30%") naming the point
   * that must stay visible when the crop bites; `imageFit: 'contain'` shows the
   * whole picture instead. Neither touches the stored bytes.
   */
  imagePosition?: string
  imageFit?: 'cover' | 'contain'
}

/**
 * Platforms are stated by the writer, not looked up: articles are usually
 * about older films, and the release cache only holds thirteen weeks. When the
 * film IS in the cache the composer fills these in and keeps its `id`, which
 * is what lets the block link to the film's own WeekAdda page.
 */
export interface ArticleFilm {
  id?: string
  title: string
  platforms: ArticleWatch[]
}

/**
 * One place to watch a film. `url` is the exact title page when the writer has
 * it — always better than a search, which can land on the wrong film or on
 * nothing. Without one we search that platform for the title instead.
 */
export interface ArticleWatch {
  name: string
  url?: string
}

/**
 * Hearts on an article. A like, not a rating: an article is liked or it isn't,
 * and a single count can never be read as a verdict on the film or match it
 * discusses — which is the confusion the review stars have to keep explaining.
 */
export interface LikeSummary {
  count: number
  /** Whether the signed-in reader has liked it; absent when signed out. */
  mine?: boolean
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

/**
 * One watched film, logged privately. Never returned by any public endpoint —
 * it lives in its own store precisely so no public list can reach it.
 * `userEmail` is server-side only and is stripped before this is sent, even to
 * its owner: the client already knows whose log it is.
 */
export interface WatchLog {
  id: string
  ts: string
  /** The day they watched (YYYY-MM-DD), not the day they logged it. */
  watchedOn: string
  /** A film or a match — decides whether "out" is a cinema or a stadium. */
  kind: 'movie' | 'match'
  /** Out of the house or in it. Not 'cinema': the same field holds a stadium. */
  where: 'out' | 'home'
  title: string
  titleId?: string
  /** Theatre or stadium name, or the platform when watched at home. */
  venue?: string
  /** Out only. */
  city?: string
  note?: string
  /** Storage path in the private bucket — never a URL. Needs signing to show. */
  image?: string
  /** Framing, as on an article cover — chosen after upload, bytes untouched. */
  imagePosition?: string
  imageFit?: 'cover' | 'contain'
}
