export interface Release {
  id: string
  title: string
  originalTitle: string
  language: string
  languageLabel: string
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

export interface CricketMeta {
  fetchedAt: string
  source: 'espn' | 'sample'
  total: number
  syncing: boolean
}
