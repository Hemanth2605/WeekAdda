import fs from 'fs'
import path from 'path'
import { sampleMatches } from '../data/sampleMatches'
import { CRICKET_MAX_WEEKS, CricketTeam, CricketMatch, CricketCache } from '../queries'

/**
 * Cricket agent — same pattern as movie releases: daily sweep, disk cache,
 * weekly buckets. Source: ESPN's public cricket scoreboard JSON (no key).
 * Active leagues come from the header feed; each league is swept month by
 * month across the window. Because ESPN only lists CURRENT leagues, the cache
 * accumulates: matches from leagues that later disappear stay cached until
 * they age out of the window.
 *
 * Cache shapes and CRICKET_MAX_WEEKS live in ../queries (shared with the
 * Cloudflare Worker); re-exported here so existing imports keep working.
 */

export { CRICKET_MAX_WEEKS }
export type { CricketTeam, CricketMatch, CricketCache }

const PAST_DAYS = CRICKET_MAX_WEEKS * 7 - 1
const FUTURE_DAYS = 90

const CRICKET_CACHE_VERSION = 5

// National sides (suffixes like "Women", "Under-19s", "A" are stripped before lookup)
const NATIONS = new Set([
  'india', 'australia', 'england', 'pakistan', 'sri lanka', 'bangladesh',
  'afghanistan', 'new zealand', 'south africa', 'west indies', 'zimbabwe',
  'ireland', 'scotland', 'netherlands', 'namibia', 'united arab emirates',
  'u.a.e.', 'uae', 'usa', 'united states of america', 'oman', 'nepal',
  'papua new guinea', 'canada', 'hong kong', 'uganda', 'tanzania', 'kenya',
  'jersey', 'italy', 'kuwait', 'bahrain', 'qatar', 'malaysia', 'singapore',
  'thailand', 'japan', 'fiji', 'bermuda', 'denmark', 'germany', 'austria',
  'romania', 'france', 'spain', 'portugal', 'belgium', 'sweden', 'norway',
  'finland', 'hungary', 'czechia', 'czech republic', 'croatia', 'serbia',
  'greece', 'cyprus', 'malta', 'gibraltar', 'guernsey', 'isle of man',
  'luxembourg', 'switzerland', 'estonia', 'bulgaria', 'peru', 'colombia',
  'argentina', 'brazil', 'chile', 'mexico', 'panama', 'belize', 'cayman islands',
  'botswana', 'nigeria', 'ghana', 'rwanda', 'malawi', 'mozambique', 'eswatini',
  'sierra leone', 'gambia', 'south korea', 'indonesia', 'philippines', 'vanuatu',
  'samoa', 'cook islands', 'cambodia', 'myanmar', 'maldives', 'bhutan', 'iran',
  'saudi arabia', 'israel', 'turkey', 'mongolia', 'china',
])

function isNationalSide(teamName: string): boolean {
  const stripped = teamName
    .toLowerCase()
    .replace(/\s*\((men|women)\)\s*$/, '')
    .replace(/\s+(women|men)$/, '')
    .replace(/\s+under-\d+s?$/, '')
    .replace(/\s+u-?\d+s?$/, '')
    .replace(/\s+a$/, '')
    .trim()
  return NATIONS.has(stripped)
}

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache')
const CACHE_FILE = path.join(CACHE_DIR, 'cricket.json')
const UA = { 'User-Agent': 'Mozilla/5.0 (WeekAdda release tracker)' }

let cache: CricketCache | null = null
let syncing = false

function isoDate(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

export function getCricketData(): CricketCache {
  if (!cache) {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CricketCache
      }
    } catch (err) {
      console.warn('⚠️  Could not read cricket cache:', err)
    }
    if (!cache) {
      cache = { fetchedAt: new Date().toISOString(), source: 'sample', matches: sampleMatches }
    }
  }
  return cache
}

export function isCricketSyncing() {
  return syncing
}

function monthsInRange(from: string, to: string): string[] {
  const months: string[] = []
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const [ey, em] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return months
}

interface EspnEvent {
  id: string
  name: string
  shortName: string
  date: string
  description?: string
  links?: Array<{ rel?: string[]; href?: string }>
  competitions?: Array<{
    description?: string
    venue?: { fullName?: string }
    status?: { type?: { state?: string; detail?: string; shortDetail?: string } }
    competitors?: Array<{
      winner?: boolean
      score?: string
      team?: { displayName?: string; abbreviation?: string; logo?: string }
    }>
  }>
}

function normalizeEvent(e: EspnEvent, series: string, seriesId: string): CricketMatch | null {
  const c = e.competitions?.[0]
  if (!c || !e.date) return null
  const state = (c.status?.type?.state ?? 'pre') as CricketMatch['state']
  const teams = (c.competitors ?? []).map((t) => ({
    name: t.team?.displayName ?? 'TBC',
    abbreviation: t.team?.abbreviation ?? '',
    score: t.score ?? '',
    logo: t.team?.logo ?? null,
    winner: Boolean(t.winner),
  }))
  return {
    id: `espn-${e.id}`,
    name: e.name ?? '',
    shortName: e.shortName ?? '',
    series,
    seriesId,
    date: e.date,
    venue: c.venue?.fullName ?? '',
    state: state === 'in' || state === 'post' ? state : 'pre',
    statusDetail: c.status?.type?.shortDetail ?? c.status?.type?.detail ?? '',
    international: teams.length >= 2 && teams.every((t) => isNationalSide(t.name)),
    url:
      e.links?.find((l) => l.rel?.includes('scorecard'))?.href ??
      e.links?.find((l) => l.href)?.href ??
      null,
    label: c.description?.trim() || e.description?.split(',')[0]?.trim() || '',
    teams,
  }
}

/**
 * Discover leagues three ways:
 * 1. ESPN's header feed (leagues with a match today),
 * 2. ESPN search for tours/trophies named with a year inside our window
 *    (catches series that start tomorrow — the header misses those),
 * 3. leagues remembered from previous sweeps (accumulated in the cache).
 */
async function discoverLeagues(windowYears: number[]): Promise<Map<string, string>> {
  const leagues = new Map<string, string>()

  try {
    const headerRes = await fetch(
      'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket',
      { headers: UA }
    )
    if (headerRes.ok) {
      const header = (await headerRes.json()) as {
        sports?: Array<{ leagues?: Array<{ id: string; name: string }> }>
      }
      for (const l of header.sports?.[0]?.leagues ?? []) {
        if (l.id && l.name) leagues.set(String(l.id), l.name)
      }
    }
  } catch {
    // header failure is tolerable; search still runs
  }

  const terms = ['tour of', 'World Cup', 'Trophy', 'Asia Cup', 'Championship', 'Tri-Nation', 'T20I Series']
  const yearTokens = windowYears.map(String)
  for (const year of yearTokens) {
    for (const term of terms) {
      try {
        const res = await fetch(
          `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(`${term} ${year}`)}&limit=50`,
          { headers: UA }
        )
        if (!res.ok) continue
        const body = (await res.json()) as {
          results?: Array<{ contents?: Array<{ type?: string; displayName?: string; uid?: string }> }>
        }
        for (const c of (body.results ?? []).flatMap((r) => r.contents ?? [])) {
          if (c.type !== 'league' || !c.uid || !c.displayName) continue
          if (!yearTokens.some((y) => c.displayName!.includes(y))) continue
          const m = c.uid.match(/l:(\d+)/)
          if (m) leagues.set(m[1], c.displayName)
        }
      } catch {
        // one search failing is fine
      }
    }
  }
  return leagues
}

export async function syncCricket(): Promise<CricketCache> {
  if (syncing) throw new Error('A cricket sync is already running')
  syncing = true
  console.log('🏏 Cricket agent: starting sweep…')
  try {
    const from = isoDate(-PAST_DAYS)
    const to = isoDate(FUTURE_DAYS)
    const windowYears = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])]

    // 1. Discover leagues (header + search + remembered from earlier sweeps)
    const previous = getCricketData()
    const leagues = await discoverLeagues(windowYears)
    for (const known of previous.knownLeagues ?? []) {
      if (!leagues.has(known.id)) leagues.set(known.id, known.name)
    }
    if (leagues.size === 0) throw new Error('ESPN returned no cricket leagues')

    // 2. Sweep each league month-by-month across the window (bounded concurrency)
    const months = monthsInRange(from, to)
    const fresh = new Map<string, CricketMatch>()
    const activeLeagues = new Map<string, string>()
    const entries = [...leagues.entries()]
    const CONCURRENCY = 6

    let cursor = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < entries.length) {
          const [id, name] = entries[cursor++]
          for (const month of months) {
            try {
              const res = await fetch(
                `https://site.api.espn.com/apis/site/v2/sports/cricket/${id}/scoreboard?dates=${month}`,
                { headers: UA }
              )
              if (!res.ok) continue
              const body = (await res.json()) as { events?: EspnEvent[] }
              for (const e of body.events ?? []) {
                const match = normalizeEvent(e, name, id)
                if (match) {
                  fresh.set(match.id, match)
                  activeLeagues.set(id, name)
                }
              }
            } catch {
              // one league-month failing is not fatal
            }
          }
        }
      })
    )

    if (fresh.size === 0) throw new Error('ESPN sweep returned no matches')

    // 3. Merge with previous cache (accumulate leagues that later disappear)
    const merged = new Map<string, CricketMatch>()
    if (previous.source === 'espn') {
      for (const m of previous.matches) merged.set(m.id, m)
    }
    for (const [id, m] of fresh) merged.set(id, m) // fresh data wins

    // 4. Keep only matches inside the window
    const matches = [...merged.values()].filter((m) => {
      const day = m.date.slice(0, 10)
      return day >= from && day <= to
    })

    // Remember every league that had matches in-window, for future sweeps
    const knownLeagues = [...activeLeagues.entries()].map(([id, name]) => ({ id, name }))
    for (const known of previous.knownLeagues ?? []) {
      if (!activeLeagues.has(known.id)) knownLeagues.push(known)
    }

    cache = {
      fetchedAt: new Date().toISOString(),
      source: 'espn',
      version: CRICKET_CACHE_VERSION,
      knownLeagues,
      matches,
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
    const intl = matches.filter((m) => m.international).length
    console.log(
      `🏏 Cricket agent: synced ${matches.length} matches (${intl} international) across ${activeLeagues.size} series, ${leagues.size} leagues probed`
    )
    return cache
  } finally {
    syncing = false
  }
}

export function syncCricketIfStale() {
  const data = getCricketData()
  const ageHours = (Date.now() - new Date(data.fetchedAt).getTime()) / 3_600_000
  if (data.source === 'sample' || ageHours > 20 || data.version !== CRICKET_CACHE_VERSION) {
    syncCricket().catch((err) => console.warn('⚠️  Cricket boot sync failed:', err.message))
  }
}
