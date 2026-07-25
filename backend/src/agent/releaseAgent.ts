import fs from 'fs'
import path from 'path'
import { sampleReleases, sampleOtt, sampleOttUpcoming } from '../data/sampleReleases'
import { sweepWikipedia } from './wikipediaSource'
import { sweepWikipediaOtt } from './wikipediaOttSource'
import { sweepWatchmode } from './watchmodeSource'
import { LANGUAGES, MAX_WEEKS, Release, OttRelease, ReleaseCache } from '../queries'

// Cache shapes, LANGUAGES and MAX_WEEKS live in ../queries (shared with the
// Cloudflare Worker); re-exported here so existing imports keep working.
export { LANGUAGES, MAX_WEEKS }
export type { Release, OttRelease, ReleaseCache }

// Bump when adding/removing sources so stale caches re-sync on boot
const SOURCES_VERSION = 6

// TMDB watch-provider ids for the Indian streaming platforms we track
export const OTT_PROVIDERS = [
  { id: 8, label: 'Netflix' },
  { id: 119, label: 'Amazon Prime Video' },
  { id: 2336, label: 'JioHotstar' },
  { id: 237, label: 'Sony LIV' },
  { id: 232, label: 'ZEE5' },
  { id: 532, label: 'Aha' },
  { id: 309, label: 'Sun NXT' },
  { id: 350, label: 'Apple TV' },
]

/**
 * Where TMDB writes a platform when JustWatch has not linked one: free text on
 * the India digital release date — "ZEE5", "Zee5", "Streaming On Zee5". For the
 * regional films that make up most of our OTT week that note is the only
 * platform signal there is, so the spellings all have to fold together.
 */
const PLATFORM_ALIASES: Array<{ alias: string; label: string; exact?: boolean }> = [
  { alias: 'netflix', label: 'Netflix' },
  { alias: 'primevideo', label: 'Amazon Prime Video' },
  { alias: 'amazonprime', label: 'Amazon Prime Video' },
  { alias: 'jiohotstar', label: 'JioHotstar' },
  { alias: 'hotstar', label: 'JioHotstar' },
  { alias: 'sonyliv', label: 'Sony LIV' },
  { alias: 'zee5', label: 'ZEE5' },
  { alias: 'sunnxt', label: 'Sun NXT' },
  { alias: 'appletv', label: 'Apple TV' },
  // "aha" occurs inside ordinary words, so it only counts as the whole note
  { alias: 'aha', label: 'Aha', exact: true },
]

/**
 * The platform a release note names, or null. Notes are not a controlled
 * field: alongside "ZEE5" they hold "upcoming", "(internet)" and whole
 * paragraphs of synopsis, so a match has to be a name we recognise and
 * ambiguous aliases have to match the note outright.
 */
function platformFromNote(note: string): string | null {
  const n = note.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!n) return null
  for (const { alias, label, exact } of PLATFORM_ALIASES) {
    if (exact ? n === alias : n.includes(alias)) return label
  }
  return null
}

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache')
const CACHE_FILE = path.join(CACHE_DIR, 'releases.json')
const TMDB = 'https://api.themoviedb.org/3'

export const PAST_DAYS = MAX_WEEKS * 7 - 1 // 90 days back
const FUTURE_DAYS = 90
const MAX_PAGES = 3 // TMDB pages per language per sweep (20 films each)

let cache: ReleaseCache | null = null
let syncing = false

function isoDate(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function loadCacheFromDisk(): ReleaseCache | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as ReleaseCache
    }
  } catch (err) {
    console.warn('⚠️  Could not read release cache:', err)
  }
  return null
}

export function getReleaseData(): ReleaseCache {
  if (!cache) {
    cache =
      loadCacheFromDisk() ?? {
        fetchedAt: new Date().toISOString(),
        source: 'sample',
        releases: sampleReleases,
        ott: sampleOtt,
        ottUpcoming: sampleOttUpcoming,
      }
  }
  if (!Array.isArray(cache.ott)) cache.ott = [] // older cache files predate OTT
  if (!Array.isArray(cache.ottUpcoming)) cache.ottUpcoming = []
  return cache
}

const languageName = new Intl.DisplayNames(['en'], { type: 'language' })

export function labelForLanguage(code: string) {
  const known = LANGUAGES.find((l) => l.code === code)
  if (known) return known.label
  try {
    return languageName.of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export function isSyncing() {
  return syncing
}

interface TmdbMovie {
  id: number
  title: string
  original_title: string
  original_language: string
  release_date: string
  overview: string
  poster_path: string | null
  vote_average: number
  vote_count: number
}

function toRelease(m: TmdbMovie, lang: { code: string; label: string }): Release {
  return {
    id: `tmdb-${m.id}`,
    title: m.title || m.original_title,
    originalTitle: m.original_title,
    language: lang.code,
    languageLabel: lang.label,
    releaseDate: m.release_date,
    overview: m.overview || 'No synopsis available yet.',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    rating: Math.round((m.vote_average ?? 0) * 10) / 10,
    votes: m.vote_count ?? 0,
  }
}

async function fetchLanguageWindow(
  apiKey: string,
  lang: { code: string; label: string },
  from: string,
  to: string
): Promise<Release[]> {
  const releases: Release[] = []
  let page = 1
  let totalPages = 1

  do {
    const url =
      `${TMDB}/discover/movie?api_key=${apiKey}` +
      `&with_original_language=${lang.code}` +
      `&primary_release_date.gte=${from}&primary_release_date.lte=${to}` +
      `&sort_by=popularity.desc&include_adult=false&page=${page}`
    const res = await fetch(url)
    if (!res.ok) {
      // First page failing means the language sweep failed; later pages are best-effort
      if (page === 1) {
        throw new Error(`TMDB responded ${res.status} for ${lang.label} — check your API key`)
      }
      break
    }
    const body = (await res.json()) as { total_pages?: number; results: TmdbMovie[] }
    totalPages = body.total_pages ?? 1
    releases.push(
      ...(body.results ?? []).filter((m) => m.release_date).map((m) => toRelease(m, lang))
    )
    page++
  } while (page <= Math.min(totalPages, MAX_PAGES))

  return releases
}

/**
 * One provider × one weekly bucket of digital (OTT) releases in India.
 * release_type=4 = digital; the query window itself defines the week bucket.
 */
async function fetchOttWeek(
  apiKey: string,
  provider: { id: number; label: string },
  week: number
): Promise<OttRelease[]> {
  const from = isoDate(-(week * 7 + 6))
  const to = isoDate(-(week * 7))
  const url =
    `${TMDB}/discover/movie?api_key=${apiKey}` +
    `&watch_region=IN&with_watch_providers=${provider.id}` +
    `&region=IN&with_release_type=4` +
    `&release_date.gte=${from}&release_date.lte=${to}` +
    `&sort_by=popularity.desc&include_adult=false&page=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${provider.label} week ${week}`)
  const body = (await res.json()) as { results: TmdbMovie[] }
  return (body.results ?? [])
    .filter((m) => m.release_date)
    .map((m) => ({
      ...toRelease(m, { code: m.original_language, label: labelForLanguage(m.original_language) }),
      id: `ott-${m.id}`,
      platforms: [provider.label],
      week,
      contentType: 'movie' as const,
    }))
}

/**
 * One weekly bucket of India digital releases with NO platform tagged on TMDB
 * yet — catches films (often regional, e.g. ZEE5 pickups) whose digital date
 * is known but whose provider JustWatch hasn't linked. They show as OTT
 * arrivals with the platform "to be announced"; a later sweep fills it in.
 */
async function fetchOttWeekAnyPlatform(apiKey: string, week: number): Promise<OttRelease[]> {
  const from = isoDate(-(week * 7 + 6))
  const to = isoDate(-(week * 7))
  const url =
    `${TMDB}/discover/movie?api_key=${apiKey}` +
    `&region=IN&with_release_type=4` +
    `&release_date.gte=${from}&release_date.lte=${to}` +
    `&sort_by=popularity.desc&include_adult=false&page=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status} for any-platform week ${week}`)
  const body = (await res.json()) as { results: TmdbMovie[] }
  return (body.results ?? [])
    .filter((m) => m.release_date)
    .map((m) => ({
      ...toRelease(m, { code: m.original_language, label: labelForLanguage(m.original_language) }),
      id: `ott-${m.id}`,
      platforms: [], // platform not linked on TMDB yet
      week,
      contentType: 'movie' as const,
    }))
}

interface TmdbTv {
  id: number
  name: string
  original_name: string
  original_language: string
  first_air_date: string
  overview: string
  poster_path: string | null
  vote_average: number
  vote_count: number
}

/** One provider × one weekly bucket of web series premieres available in India. */
async function fetchOttSeriesWeek(
  apiKey: string,
  provider: { id: number; label: string },
  week: number
): Promise<OttRelease[]> {
  const from = isoDate(-(week * 7 + 6))
  const to = isoDate(-(week * 7))
  const url =
    `${TMDB}/discover/tv?api_key=${apiKey}` +
    `&watch_region=IN&with_watch_providers=${provider.id}` +
    `&first_air_date.gte=${from}&first_air_date.lte=${to}` +
    `&sort_by=popularity.desc&include_adult=false&page=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${provider.label} series week ${week}`)
  const body = (await res.json()) as { results: TmdbTv[] }
  return (body.results ?? [])
    .filter((t) => t.first_air_date)
    .map((t) => ({
      id: `ott-tv-${t.id}`,
      title: t.name || t.original_name,
      originalTitle: t.original_name,
      language: t.original_language,
      languageLabel: labelForLanguage(t.original_language),
      releaseDate: t.first_air_date,
      overview: t.overview || 'No synopsis available yet.',
      poster: t.poster_path ? `https://image.tmdb.org/t/p/w342${t.poster_path}` : null,
      rating: Math.round((t.vote_average ?? 0) * 10) / 10,
      votes: t.vote_count ?? 0,
      platforms: [provider.label],
      week,
      contentType: 'series' as const,
    }))
}

/**
 * Upcoming OTT arrivals for the next FUTURE_DAYS:
 * 1. per provider — titles TMDB has already tagged to a platform, and
 * 2. a generic India digital-release query for films whose platform is not yet announced.
 */
async function sweepOttUpcoming(apiKey: string): Promise<OttRelease[]> {
  const from = isoDate(1)
  const to = isoDate(FUTURE_DAYS)
  const merged = new Map<string, OttRelease>()

  const add = (item: OttRelease) => {
    const existing = merged.get(item.id)
    if (!existing) {
      merged.set(item.id, item)
      return
    }
    for (const p of item.platforms) {
      if (!existing.platforms.includes(p)) existing.platforms.push(p)
    }
  }

  const tasks: Array<Promise<void>> = []

  for (const provider of OTT_PROVIDERS) {
    // Platform-tagged upcoming movies
    tasks.push(
      (async () => {
        const url =
          `${TMDB}/discover/movie?api_key=${apiKey}` +
          `&watch_region=IN&with_watch_providers=${provider.id}` +
          `&region=IN&with_release_type=4` +
          `&release_date.gte=${from}&release_date.lte=${to}` +
          `&sort_by=popularity.desc&include_adult=false&page=1`
        const res = await fetch(url)
        if (!res.ok) return
        const body = (await res.json()) as { results: TmdbMovie[] }
        for (const m of (body.results ?? []).filter((m) => m.release_date)) {
          add({
            ...toRelease(m, { code: m.original_language, label: labelForLanguage(m.original_language) }),
            id: `ott-${m.id}`,
            platforms: [provider.label],
            week: -1,
            contentType: 'movie',
          })
        }
      })().catch(() => {})
    )
    // Platform-tagged upcoming series
    tasks.push(
      (async () => {
        const url =
          `${TMDB}/discover/tv?api_key=${apiKey}` +
          `&watch_region=IN&with_watch_providers=${provider.id}` +
          `&first_air_date.gte=${from}&first_air_date.lte=${to}` +
          `&sort_by=popularity.desc&include_adult=false&page=1`
        const res = await fetch(url)
        if (!res.ok) return
        const body = (await res.json()) as { results: TmdbTv[] }
        for (const t of (body.results ?? []).filter((t) => t.first_air_date)) {
          add({
            id: `ott-tv-${t.id}`,
            title: t.name || t.original_name,
            originalTitle: t.original_name,
            language: t.original_language,
            languageLabel: labelForLanguage(t.original_language),
            releaseDate: t.first_air_date,
            overview: t.overview || 'No synopsis available yet.',
            poster: t.poster_path ? `https://image.tmdb.org/t/p/w342${t.poster_path}` : null,
            rating: Math.round((t.vote_average ?? 0) * 10) / 10,
            votes: t.vote_count ?? 0,
            platforms: [provider.label],
            week: -1,
            contentType: 'series',
          })
        }
      })().catch(() => {})
    )
  }

  // Generic: movies with an India digital date announced but no platform tagged yet
  tasks.push(
    (async () => {
      const url =
        `${TMDB}/discover/movie?api_key=${apiKey}` +
        `&region=IN&with_release_type=4` +
        `&release_date.gte=${from}&release_date.lte=${to}` +
        `&sort_by=popularity.desc&include_adult=false&page=1`
      const res = await fetch(url)
      if (!res.ok) return
      const body = (await res.json()) as { results: TmdbMovie[] }
      for (const m of (body.results ?? []).filter((m) => m.release_date)) {
        add({
          ...toRelease(m, { code: m.original_language, label: labelForLanguage(m.original_language) }),
          id: `ott-${m.id}`,
          platforms: [], // platform not announced yet
          week: -1,
          contentType: 'movie',
        })
      }
    })().catch(() => {})
  )

  await Promise.all(tasks)
  return [...merged.values()]
}

/**
 * Name the platform for OTT titles TMDB never linked to a provider, by reading
 * the note on their India digital release date. Costs one extra call per
 * unlabelled film, in small batches to stay gentle on TMDB; anything that
 * fails or names nothing we recognise simply stays "to be announced", which is
 * the behaviour we already had. Series carry no release_dates, so only films
 * with a numeric TMDB id are looked up.
 */
async function fillPlatformsFromNotes(apiKey: string, items: OttRelease[]): Promise<number> {
  const pending = items.filter((i) => i.platforms.length === 0 && /^ott-\d+$/.test(i.id))
  let filled = 0
  for (let i = 0; i < pending.length; i += 10) {
    await Promise.all(
      pending.slice(i, i + 10).map(async (item) => {
        try {
          const res = await fetch(`${TMDB}/movie/${item.id.slice(4)}/release_dates?api_key=${apiKey}`)
          if (!res.ok) return
          const body = (await res.json()) as {
            results?: Array<{
              iso_3166_1: string
              release_dates?: Array<{ type: number; note?: string }>
            }>
          }
          const india = body.results?.find((r) => r.iso_3166_1 === 'IN')
          for (const entry of india?.release_dates ?? []) {
            // type 4 = digital; the theatrical entry's note is never a platform
            if (entry.type !== 4 || !entry.note) continue
            const label = platformFromNote(entry.note)
            if (label) {
              item.platforms = [label]
              filled++
              return
            }
          }
        } catch {
          // one lookup failing must never break the sweep
        }
      })
    )
  }
  return filled
}

/** Sweep all providers × all weekly buckets, merging platforms per film. */
async function sweepOtt(apiKey: string): Promise<OttRelease[]> {
  const perProvider = await Promise.allSettled([
    ...OTT_PROVIDERS.map(async (provider) => {
      const out: OttRelease[] = []
      // Weeks sequentially per provider to stay well under TMDB rate limits
      for (let w = 0; w < MAX_WEEKS; w++) {
        try {
          out.push(...(await fetchOttWeek(apiKey, provider, w)))
        } catch {
          // A missing provider-week is not fatal to the sweep
        }
        try {
          out.push(...(await fetchOttSeriesWeek(apiKey, provider, w)))
        } catch {
          // Series data missing for a provider-week is not fatal either
        }
      }
      return out
    }),
    // Digital dates with no platform tagged yet (platform "to be announced")
    (async () => {
      const out: OttRelease[] = []
      for (let w = 0; w < MAX_WEEKS; w++) {
        try {
          out.push(...(await fetchOttWeekAnyPlatform(apiKey, w)))
        } catch {
          // Not fatal — the per-provider queries still cover tagged titles
        }
      }
      return out
    })(),
  ])

  const merged = new Map<string, OttRelease>()
  for (const result of perProvider) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const existing = merged.get(item.id)
      if (existing) {
        for (const p of item.platforms) {
          if (!existing.platforms.includes(p)) existing.platforms.push(p)
        }
        existing.week = Math.min(existing.week, item.week)
      } else {
        merged.set(item.id, item)
      }
    }
  }
  return [...merged.values()]
}

/** The daily agent: sweeps every language for fresh + upcoming releases. */
export async function syncReleases(): Promise<ReleaseCache> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error(
      'No TMDB_API_KEY configured. Get a free key at themoviedb.org → Settings → API, then put TMDB_API_KEY=... in backend/.env'
    )
  }
  if (syncing) throw new Error('A sync is already running')

  syncing = true
  console.log('🤖 Release agent: starting daily sweep across', LANGUAGES.length, 'languages…')
  try {
    const from = isoDate(-PAST_DAYS)
    const to = isoDate(FUTURE_DAYS)
    const results = await Promise.allSettled(
      LANGUAGES.map((lang) => fetchLanguageWindow(apiKey, lang, from, to))
    )

    const releases: Release[] = []
    const failures: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') releases.push(...r.value)
      else failures.push(LANGUAGES[i].label)
    })

    if (releases.length === 0) {
      throw new Error(
        failures.length ? `All language fetches failed (${failures[0]}, …)` : 'TMDB returned no releases'
      )
    }

    // De-dupe (a film can surface under multiple queries)
    const seen = new Set<string>()
    const unique = releases.filter((r) => !seen.has(r.id) && seen.add(r.id))

    // Wikipedia fills in regional films TMDB does not know yet
    console.log('🤖 Release agent: sweeping Wikipedia film lists…')
    let wikiExtra: Release[] = []
    try {
      wikiExtra = await sweepWikipedia(from, to, unique)
    } catch (err) {
      console.warn('⚠️  Wikipedia sweep failed (continuing with TMDB only):', err)
    }
    const allReleases = [...unique, ...wikiExtra]

    console.log('🤖 Release agent: sweeping OTT platforms across India…')
    const ott = await sweepOtt(apiKey)
    const ottUpcoming = await sweepOttUpcoming(apiKey)

    // Wikipedia platform-originals pages add OTT titles TMDB misses (incl. Aha, ETV Win)
    const ottTitles = new Set<string>()
    const rememberTitles = (items: OttRelease[]) => {
      for (const o of items) {
        ottTitles.add(o.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''))
      }
    }
    rememberTitles(ott)
    rememberTitles(ottUpcoming)
    try {
      const wikiOtt = await sweepWikipediaOtt(from, to, MAX_WEEKS, ottTitles)
      ott.push(...wikiOtt.past)
      ottUpcoming.push(...wikiOtt.upcoming)
      rememberTitles(wikiOtt.past)
      rememberTitles(wikiOtt.upcoming)
    } catch (err) {
      console.warn('⚠️  Wikipedia OTT sweep failed (continuing without it):', err)
    }

    // Watchmode adds catalog ADDITIONS (licensed titles newly added to a platform)
    try {
      const wm = await sweepWatchmode(from, to, MAX_WEEKS, ottTitles)
      ott.push(...wm.past)
      ottUpcoming.push(...wm.upcoming)
    } catch (err) {
      console.warn('⚠️  Watchmode sweep failed (continuing without it):', err)
    }

    // TMDB links only the biggest services to a watch provider; for everything
    // else the platform is buried in the release note, so recover it there
    const named =
      (await fillPlatformsFromNotes(apiKey, ott)) +
      (await fillPlatformsFromNotes(apiKey, ottUpcoming))
    if (named) console.log(`🤖 Release agent: named ${named} platform(s) from TMDB release notes`)

    cache = {
      fetchedAt: new Date().toISOString(),
      source: 'tmdb',
      rangeDays: PAST_DAYS,
      sourcesVersion: SOURCES_VERSION,
      releases: allReleases,
      ott,
      ottUpcoming,
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
    console.log(
      `🤖 Release agent: synced ${unique.length} TMDB + ${wikiExtra.length} Wikipedia theatrical, ${ott.length} OTT, ${ottUpcoming.length} upcoming-OTT` +
        (failures.length ? ` (failed: ${failures.join(', ')})` : '')
    )
    return cache
  } finally {
    syncing = false
  }
}

/** Sync on boot when the cache is stale, so the app is fresh every morning. */
export function syncIfStale() {
  if (!process.env.TMDB_API_KEY) return
  const data = getReleaseData()
  const ageHours = (Date.now() - new Date(data.fetchedAt).getTime()) / 3_600_000
  // Re-sync when stale OR when the cache predates the configured window / OTT+series sweep
  if (
    data.source === 'sample' ||
    ageHours > 20 ||
    data.rangeDays !== PAST_DAYS ||
    data.ott.length === 0 ||
    data.ott.some((o) => !o.contentType) ||
    data.ottUpcoming.length === 0 ||
    data.sourcesVersion !== SOURCES_VERSION
  ) {
    syncReleases().catch((err) => console.warn('⚠️  Boot sync failed:', err.message))
  }
}
