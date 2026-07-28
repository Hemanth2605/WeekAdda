import fs from 'fs'
import path from 'path'
import { sampleReleases, sampleOtt, sampleOttUpcoming } from '../data/sampleReleases'
import { sweepWikipedia } from './wikipediaSource'
import { sweepWikipediaOtt } from './wikipediaOttSource'
import { sweepWatchmode } from './watchmodeSource'
import { panIndiaLanguages } from '../data/panIndia'
import { sweepPanIndia, PanIndiaMatch } from './panIndiaSource'
import { LANGUAGES, MAX_WEEKS, Release, OttRelease, ReleaseCache } from '../queries'

// Cache shapes, LANGUAGES and MAX_WEEKS live in ../queries (shared with the
// Cloudflare Worker); re-exported here so existing imports keep working.
export { LANGUAGES, MAX_WEEKS }
export type { Release, OttRelease, ReleaseCache }

// Bump when adding/removing sources so stale caches re-sync on boot
const SOURCES_VERSION = 8

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

/**
 * Shortest thing we will call a film. The catch-all query asks TMDB for *any*
 * India digital release with no platform attached, which is how regional films
 * JustWatch never linked get in — and also how someone's two-minute upload gets
 * in, since anyone can register one with a digital date.
 *
 * Deliberately not TMDB's own `with_runtime.gte`, which also excludes records
 * whose runtime is simply unset — measured at roughly one title in sixty, and
 * they are exactly the new regional films this catch-all exists to rescue.
 * Filtering here instead means an unknown runtime is kept rather than guessed
 * against, and it is free: the enrichment pass already fetches these records.
 * A title a platform actually lists is never dropped, however short — being
 * listed is itself the quality signal.
 */
const FEATURE_MINUTES = 40

/** Scripts that name their own language — free, no API call. Devanagari covers
 *  Hindi and Marathi, so it resolves to the far more common one. */
const SCRIPT_LANGUAGES: Array<{ script: RegExp; code: string }> = [
  { script: /[ఀ-౿]/, code: 'te' },
  { script: /[ഀ-ൿ]/, code: 'ml' },
  { script: /[஀-௿]/, code: 'ta' },
  { script: /[ಀ-೿]/, code: 'kn' },
  { script: /[ঀ-৿]/, code: 'bn' },
  { script: /[਀-੿]/, code: 'pa' },
  { script: /[઀-૿]/, code: 'gu' },
  { script: /[଀-୿]/, code: 'or' },
  { script: /[ऀ-ॿ]/, code: 'hi' },
]

const INDIAN_LANGUAGES = new Set(['te', 'ta', 'ml', 'kn', 'hi', 'bn', 'mr', 'pa', 'gu', 'or', 'ur'])

const normalizeKey = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

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
 * Which country's release-date record supplies the digital date.
 *
 * IN is the right answer when TMDB has it. But plenty of films reach Prime or
 * Netflix India through a worldwide deal that nobody records against India —
 * TMDB carries only the US digital date, and an India-only query cannot see
 * them at all. The Sheep Detectives was the case that surfaced this: on Prime
 * Video India, digital date 24 June 2026 filed under US, invisible to us for a
 * month while sitting in the theatrical list under its April cinema date.
 *
 * Both passes keep watch_region/with_watch_providers pinned to India, so
 * everything returned is genuinely streaming here; the region decides only
 * where the *date* comes from.
 */
const OTT_DATE_REGIONS = ['IN', 'US'] as const

async function fetchOttWeekIn(
  apiKey: string,
  provider: { id: number; label: string },
  week: number,
  dateRegion: string
): Promise<OttRelease[]> {
  const from = isoDate(-(week * 7 + 6))
  const to = isoDate(-(week * 7))
  const url =
    `${TMDB}/discover/movie?api_key=${apiKey}` +
    `&watch_region=IN&with_watch_providers=${provider.id}` +
    `&region=${dateRegion}&with_release_type=4` +
    `&release_date.gte=${from}&release_date.lte=${to}` +
    `&sort_by=popularity.desc&include_adult=false&page=1`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`TMDB ${res.status} for ${provider.label} week ${week} (${dateRegion})`)
  }
  const body = (await res.json()) as { results: TmdbMovie[] }
  return (body.results ?? [])
    .filter((m) => m.release_date)
    .map((m) => ({
      ...toRelease(m, { code: m.original_language, label: labelForLanguage(m.original_language) }),
      id: `ott-${m.id}`,
      platforms: [provider.label],
      week,
      contentType: 'movie' as const,
      dateRegion,
    }))
}

/**
 * One provider × one weekly bucket of digital (OTT) releases in India.
 * release_type=4 = digital; the query window itself defines the week bucket.
 * A film found by both passes is merged in sweepOtt, India's date winning.
 */
async function fetchOttWeek(
  apiKey: string,
  provider: { id: number; label: string },
  week: number
): Promise<OttRelease[]> {
  const out: OttRelease[] = []
  let failures = 0
  for (const region of OTT_DATE_REGIONS) {
    try {
      out.push(...(await fetchOttWeekIn(apiKey, provider, week, region)))
    } catch {
      failures++
    }
  }
  // Only a total failure is worth reporting — one region still covers the week
  if (failures === OTT_DATE_REGIONS.length) {
    throw new Error(`TMDB failed for ${provider.label} week ${week}`)
  }
  return out
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
    // Platform-tagged upcoming movies. Both date regions, for the same reason
    // the past sweep uses both — and India first, because `add` keeps the date
    // it saw first and India's is the one that describes what happens here.
    tasks.push(
      (async () => {
        for (const dateRegion of OTT_DATE_REGIONS) {
          const url =
            `${TMDB}/discover/movie?api_key=${apiKey}` +
            `&watch_region=IN&with_watch_providers=${provider.id}` +
            `&region=${dateRegion}&with_release_type=4` +
            `&release_date.gte=${from}&release_date.lte=${to}` +
            `&sort_by=popularity.desc&include_adult=false&page=1`
          const res = await fetch(url)
          if (!res.ok) continue
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
async function fillPlatformsFromNotes(
  apiKey: string,
  items: OttRelease[],
  drop: Set<string>
): Promise<number> {
  // A title needs the round trip if it has no platform, or if it claims to be
  // English — TMDB leaves original_language at its "en" default on plenty of
  // new Indian records, so English is a claim worth checking rather than a fact
  const pending = items.filter(
    (i) => /^ott-\d+$/.test(i.id) && (i.platforms.length === 0 || i.language === 'en')
  )
  let filled = 0
  for (let i = 0; i < pending.length; i += 10) {
    await Promise.all(
      pending.slice(i, i + 10).map(async (item) => {
        try {
          // Details and release dates in one request rather than two
          const res = await fetch(
            `${TMDB}/movie/${item.id.slice(4)}?api_key=${apiKey}&append_to_response=release_dates`
          )
          if (!res.ok) return
          const body = (await res.json()) as {
            runtime?: number | null
            spoken_languages?: Array<{ iso_639_1: string }>
            release_dates?: {
              results?: Array<{
                iso_3166_1: string
                release_dates?: Array<{ type: number; note?: string }>
              }>
            }
          }

          // Believe spoken_languages over original_language, but only when it
          // names exactly one language: "en, hi, sa" is a genuinely mixed film
          // and guessing at it would trade one wrong label for another
          if (item.language === 'en') {
            const spoken = (body.spoken_languages ?? []).map((s) => s.iso_639_1)
            if (spoken.length === 1 && INDIAN_LANGUAGES.has(spoken[0])) {
              item.language = spoken[0]
              item.languageLabel = labelForLanguage(spoken[0])
            }
          }

          if (item.platforms.length > 0) return
          const india = body.release_dates?.results?.find((r) => r.iso_3166_1 === 'IN')
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

          // Still nobody's listing it, and TMDB says it is shorter than a
          // feature: someone's upload, not a release. A runtime of 0 means
          // unknown, and unknown is never grounds for dropping a title.
          const runtime = body.runtime ?? 0
          if (runtime > 0 && runtime < FEATURE_MINUTES) drop.add(item.id)
        } catch {
          // one lookup failing must never break the sweep
        }
      })
    )
  }
  return filled
}

/**
 * A title written in its own script says what language it is, so this costs
 * nothing and runs before any lookup. Only ever corrects "English", which is
 * TMDB's default value rather than a considered one.
 */
function relabelFromScript(items: OttRelease[]): number {
  let fixed = 0
  for (const item of items) {
    if (item.language !== 'en') continue
    const hit = SCRIPT_LANGUAGES.find(({ script }) => script.test(item.originalTitle))
    if (!hit) continue
    item.language = hit.code
    item.languageLabel = labelForLanguage(hit.code)
    fixed++
  }
  return fixed
}

/**
 * Wikipedia rows carry no TMDB id and often no language column, so they fall
 * back to the page's default — and the Amazon pages are global lists that
 * default to English, which mislabels every Indian title on them. TMDB usually
 * knows these titles; find them by name and take the language from there.
 * Requires an exact title match and the same year, since a loose match would
 * relabel the wrong film.
 */
async function relabelWikiTitles(apiKey: string, items: OttRelease[]): Promise<number> {
  const pending = items.filter((i) => i.language === 'en' && i.id.startsWith('wiki-'))
  let fixed = 0
  for (let i = 0; i < pending.length; i += 5) {
    await Promise.all(
      pending.slice(i, i + 5).map(async (item) => {
        const year = item.releaseDate.slice(0, 4)
        const key = normalizeKey(item.title)
        for (const kind of ['movie', 'tv'] as const) {
          try {
            const res = await fetch(
              `${TMDB}/search/${kind}?api_key=${apiKey}&query=${encodeURIComponent(item.title)}`
            )
            if (!res.ok) continue
            const body = (await res.json()) as {
              results?: Array<{
                title?: string
                name?: string
                original_language?: string
                release_date?: string
                first_air_date?: string
              }>
            }
            for (const r of body.results ?? []) {
              const name = r.title ?? r.name ?? ''
              const date = r.release_date ?? r.first_air_date ?? ''
              const code = r.original_language ?? ''
              if (normalizeKey(name) !== key || date.slice(0, 4) !== year) continue
              if (!INDIAN_LANGUAGES.has(code)) continue
              item.language = code
              item.languageLabel = labelForLanguage(code)
              fixed++
              return
            }
          } catch {
            // a failed search just leaves the title as it was
          }
        }
      })
    )
  }
  return fixed
}

/**
 * Give Wikipedia-sourced theatrical films their poster.
 *
 * These rows exist precisely because the discover sweep could not see the film:
 * it filters on primary_release_date, so a title TMDB holds with no date yet
 * ("In Production") never comes back — even when TMDB has the artwork. Wikipedia
 * rescues the title but carries no image, so the film shows as a bare gradient
 * tile. Search by name and take the poster only.
 *
 * The match has to be strict, since a wrong poster is worse than none: same
 * original language as the Wikipedia list the row came from, and the same year
 * — or no TMDB date at all, which is the case this exists to catch.
 *
 * Titles differ either side of a colon, and in both directions: Wikipedia says
 * "KJQ: King Jackie Queen" where TMDB says "KJQ", and "Mirzapur" where TMDB says
 * "Mirzapur: The Movie". So the subtitle-stripped head counts as a match, and
 * gets its own search — TMDB returns nothing at all for the full KJQ string.
 * That is loose enough to catch a wrong film on a short head, so anything but
 * an exact full-title match is only accepted when it is the *sole* candidate
 * clearing every other test; ambiguity leaves the film without a poster.
 *
 * The id stays the Wikipedia one: it keys the /movie/:id URL and the sitemap.
 */
async function fillWikiPosters(apiKey: string, items: Release[]): Promise<number> {
  const pending = items.filter((i) => i.id.startsWith('wiki-') && !i.poster)
  let filled = 0

  // A title and its subtitle-stripped head, for matching either way round
  const keysFor = (title: string) => {
    const keys = new Set([normalizeKey(title)])
    const head = title.split(/[:–—-]/)[0]
    if (head && head !== title) keys.add(normalizeKey(head))
    return keys
  }

  for (let i = 0; i < pending.length; i += 5) {
    await Promise.all(
      pending.slice(i, i + 5).map(async (item) => {
        const year = item.releaseDate.slice(0, 4)
        const fullKey = normalizeKey(item.title)
        const ours = keysFor(item.title)
        const head = item.title.split(/[:–—-]/)[0].trim()
        const queries = head && head !== item.title ? [item.title, head] : [item.title]

        for (const query of queries) {
          try {
            const res = await fetch(
              `${TMDB}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}`
            )
            if (!res.ok) continue
            const body = (await res.json()) as {
              results?: Array<{
                title?: string
                original_title?: string
                original_language?: string
                release_date?: string
                poster_path?: string | null
              }>
            }

            const candidates = (body.results ?? []).filter((r) => {
              if (!r.poster_path) return false
              if (r.original_language !== item.language) return false
              // An undated record is the very thing discover could not return
              const date = r.release_date ?? ''
              if (date && date.slice(0, 4) !== year) return false
              const theirs = new Set([...keysFor(r.title ?? ''), ...keysFor(r.original_title ?? '')])
              return [...ours].some((k) => k && theirs.has(k))
            })

            const named = candidates.find(
              (r) =>
                normalizeKey(r.title ?? '') === fullKey ||
                normalizeKey(r.original_title ?? '') === fullKey
            )
            const pick = named ?? (candidates.length === 1 ? candidates[0] : undefined)
            if (!pick) continue
            item.poster = `https://image.tmdb.org/t/p/w342${pick.poster_path}`
            filled++
            return
          } catch {
            // A failed search just leaves the film without a poster, as before
          }
        }
      })
    )
  }
  return filled
}

/**
 * Stamp films that released in more than one language.
 *
 * Two sources, in order: the hand-curated list wins, then whatever the
 * Wikipedia article scan found. Curated first because it exists precisely for
 * the films worth overriding — a wrong or missing detection is fixed by adding
 * one line there rather than by tuning prose matching.
 *
 * Runs over theatrical and OTT alike: the same film reaches us as `tmdb-…` in
 * one pool and `ott-…` in the other, so matching on id would miss half of it,
 * and both sources are keyed by title instead.
 *
 * A film is only stamped when its own language is among the ones found. If they
 * disagree, the entry is about a different film — or our language is one of the
 * mislabels the sweep already corrects elsewhere — and either way inventing a
 * language set for it would be worse than leaving it alone. The order is then
 * ours-first, since the app labels the first entry as the original.
 */
function applyPanIndia(items: Release[], detected: Map<string, PanIndiaMatch>): number {
  let stamped = 0
  for (const item of items) {
    const curated = panIndiaLanguages(item.title, item.originalTitle, item.releaseDate)
    const auto =
      detected.get(normalizeKey(item.title)) ?? detected.get(normalizeKey(item.originalTitle))
    // A remake shares its title with the original; keep them apart by year,
    // allowing a year of drift for a film whose OTT date crosses new year
    const autoFits = auto && Math.abs(Number(auto.year) - Number(item.releaseDate.slice(0, 4))) <= 1
    const languages = curated ?? (autoFits ? auto!.languages : null)

    if (!languages || !languages.includes(item.language)) continue
    item.languages = [item.language, ...languages.filter((l) => l !== item.language)]
    stamped++
  }
  return stamped
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
        // A film both passes found: India knows when it actually landed here,
        // so its date and week displace the US stand-in. Without this the
        // Math.min below would quietly prefer whichever date was earlier,
        // which for a worldwide drop is nearly always the American one.
        if (existing.dateRegion === 'US' && item.dateRegion === 'IN') {
          existing.releaseDate = item.releaseDate
          existing.week = item.week
          existing.dateRegion = 'IN'
        } else if (existing.dateRegion === 'IN' && item.dateRegion === 'US') {
          // keep what we have
        } else {
          existing.week = Math.min(existing.week, item.week)
        }
      } else {
        merged.set(item.id, item)
      }
    }
  }
  // Provenance was for the merge alone; the app has no use for it
  return [...merged.values()].map(({ dateRegion: _r, ...rest }) => rest)
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

    // TMDB often has artwork for these films even though discover could not
    // return them; without this they render as bare gradient tiles
    if (wikiExtra.length) {
      const posters = await fillWikiPosters(apiKey, wikiExtra)
      if (posters) {
        console.log(`🤖 Release agent: found posters for ${posters}/${wikiExtra.length} Wikipedia film(s)`)
      }
    }

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

    // Free pass first: a title in its own script needs no lookup
    const byScript = relabelFromScript(ott) + relabelFromScript(ottUpcoming)

    // TMDB links only the biggest services to a watch provider; for everything
    // else the platform is buried in the release note, so recover it there —
    // and check "English" against spoken_languages in the same request
    const drop = new Set<string>()
    const named =
      (await fillPlatformsFromNotes(apiKey, ott, drop)) +
      (await fillPlatformsFromNotes(apiKey, ottUpcoming, drop))
    if (named) console.log(`🤖 Release agent: named ${named} platform(s) from TMDB release notes`)
    if (drop.size) console.log(`🤖 Release agent: dropped ${drop.size} short(s) nobody is streaming`)

    // Wikipedia rows have no TMDB id, so they are looked up by name
    const byName =
      (await relabelWikiTitles(apiKey, ott)) + (await relabelWikiTitles(apiKey, ottUpcoming))
    if (byScript || byName) {
      console.log(`🤖 Release agent: corrected ${byScript + byName} mislabelled language(s)`)
    }

    // Multi-language releases, so the language filter can surface a Telugu
    // original to someone watching in Hindi. Reading article prose is the
    // loosest thing the sweep does, so a failure here costs the badges only.
    let detected = new Map<string, PanIndiaMatch>()
    try {
      detected = await sweepPanIndia(from, to)
    } catch (err) {
      console.warn('⚠️  Pan-India scan failed (continuing without it):', err)
    }
    const panIndia =
      applyPanIndia(allReleases, detected) +
      applyPanIndia(ott, detected) +
      applyPanIndia(ottUpcoming, detected)
    if (panIndia) console.log(`🤖 Release agent: marked ${panIndia} pan-India release(s)`)

    cache = {
      fetchedAt: new Date().toISOString(),
      source: 'tmdb',
      rangeDays: PAST_DAYS,
      sourcesVersion: SOURCES_VERSION,
      releases: allReleases,
      ott: ott.filter((r) => !drop.has(r.id)),
      ottUpcoming: ottUpcoming.filter((r) => !drop.has(r.id)),
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
