import type { OttRelease } from './releaseAgent'
import { labelForLanguage } from './releaseAgent'
import { normalizeTitle } from './wikipediaSource'

/**
 * Watchmode source: catalog ADDITIONS — titles a platform just added to its
 * library (licensed content), which are neither "digital premieres" (TMDB)
 * nor "originals" (Wikipedia). Skipped silently when no key is configured.
 */

const WATCHMODE = 'https://api.watchmode.com/v1'

// Watchmode source_name → our platform label. Unmapped services are ignored.
function mapPlatform(sourceName: string): string | null {
  const n = sourceName.toLowerCase()
  if (n.includes('netflix')) return 'Netflix'
  if (n.includes('prime')) return 'Amazon Prime Video'
  if (n.includes('hotstar') || n.includes('jio')) return 'JioHotstar'
  if (n.includes('zee')) return 'ZEE5'
  if (n.includes('sony')) return 'Sony LIV'
  if (n === 'aha' || n.startsWith('aha ')) return 'Aha'
  if (n.includes('etv')) return 'ETV Win'
  return null
}

interface WmRelease {
  id: number
  title: string
  type: string // movie | tv_series | tv_miniseries | short_film ...
  tmdb_id: number | null
  tmdb_type: string | null // movie | tv
  source_release_date: string
  source_name: string
}

interface TmdbDetail {
  original_language?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  vote_average?: number
  vote_count?: number
}

function weekBucket(dateIso: string, today: string): number {
  const diffDays = Math.floor(
    (new Date(today + 'T00:00:00Z').getTime() - new Date(dateIso + 'T00:00:00Z').getTime()) / 86_400_000
  )
  return Math.floor(diffDays / 7)
}

async function enrichFromTmdb(
  tmdbKey: string | undefined,
  item: WmRelease
): Promise<TmdbDetail> {
  if (!tmdbKey || !item.tmdb_id || !item.tmdb_type) return {}
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${item.tmdb_type}/${item.tmdb_id}?api_key=${tmdbKey}`
    )
    if (!res.ok) return {}
    return (await res.json()) as TmdbDetail
  } catch {
    return {}
  }
}

export async function sweepWatchmode(
  from: string,
  to: string,
  maxWeeks: number,
  existingTitles: Set<string>
): Promise<{ past: OttRelease[]; upcoming: OttRelease[] }> {
  const key = process.env.WATCHMODE_API_KEY
  if (!key) return { past: [], upcoming: [] }

  const raw: WmRelease[] = []
  for (let page = 1; page <= 2; page++) {
    const res = await fetch(
      `${WATCHMODE}/releases/?apiKey=${key}&regions=IN&limit=250&page=${page}`
    )
    if (!res.ok) {
      if (page === 1) throw new Error(`Watchmode responded ${res.status} — check WATCHMODE_API_KEY`)
      break
    }
    const body = (await res.json()) as { releases?: WmRelease[] }
    const releases = body.releases ?? []
    raw.push(...releases)
    if (releases.length < 250) break
  }

  // Keep only our platforms + date window, merge duplicate titles across platforms
  const merged = new Map<string, { item: WmRelease; platforms: Set<string> }>()
  for (const r of raw) {
    const platform = mapPlatform(r.source_name ?? '')
    if (!platform) continue
    const date = r.source_release_date
    if (!date || date < from || date > to) continue
    if (existingTitles.has(normalizeTitle(r.title))) continue
    const dedupeKey = r.tmdb_id ? `${r.tmdb_type}-${r.tmdb_id}` : `t-${normalizeTitle(r.title)}-${date}`
    const entry = merged.get(dedupeKey)
    if (entry) entry.platforms.add(platform)
    else merged.set(dedupeKey, { item: r, platforms: new Set([platform]) })
  }

  const tmdbKey = process.env.TMDB_API_KEY
  const today = new Date().toISOString().slice(0, 10)
  const past: OttRelease[] = []
  const upcoming: OttRelease[] = []

  // Enrich in small batches to stay gentle on TMDB
  const entries = [...merged.values()]
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10)
    const details = await Promise.all(batch.map(({ item }) => enrichFromTmdb(tmdbKey, item)))
    batch.forEach(({ item, platforms }, j) => {
      const d = details[j]
      const langCode = d.original_language ?? 'en'
      const contentType: 'movie' | 'series' =
        item.type.includes('movie') || item.type.includes('short') ? 'movie' : 'series'
      const release: OttRelease = {
        id: `wm-${item.tmdb_type ?? 'x'}-${item.tmdb_id ?? normalizeTitle(item.title)}`,
        title: item.title,
        originalTitle: d.original_title ?? d.original_name ?? item.title,
        language: langCode,
        languageLabel: labelForLanguage(langCode),
        releaseDate: item.source_release_date,
        overview:
          d.overview ||
          `Added to ${[...platforms].join(', ')} in India on ${item.source_release_date}.`,
        poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
        rating: Math.round((d.vote_average ?? 0) * 10) / 10,
        votes: d.vote_count ?? 0,
        platforms: [...platforms],
        week: -1,
        contentType,
      }
      if (release.releaseDate > today) {
        upcoming.push(release)
      } else {
        const bucket = weekBucket(release.releaseDate, today)
        if (bucket >= 0 && bucket < maxWeeks) {
          release.week = bucket
          past.push(release)
        }
      }
    })
  }

  console.log(
    `🤖 Release agent: Watchmode sweep added ${past.length} catalog arrivals + ${upcoming.length} upcoming (from ${raw.length} feed items)`
  )
  return { past, upcoming }
}
