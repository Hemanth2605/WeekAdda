import * as cheerio from 'cheerio'
import type { OttRelease } from './releaseAgent'
import { fetchWikiHtml, expandAnyTable, cleanText, normalizeTitle } from './wikipediaSource'

/**
 * Wikipedia OTT source: per-platform "originals" pages list premieres
 * (films + series) with exact dates — including Aha and ETV Win, which
 * TMDB's India data does not cover yet.
 */

const PLATFORM_PAGES: Array<{ page: string; platform: string; defaultLang: { code: string; label: string } }> = [
  { page: 'List_of_Netflix_India_originals', platform: 'Netflix', defaultLang: { code: 'hi', label: 'Hindi' } },
  { page: 'List_of_Amazon_Prime_Video_original_programming', platform: 'Amazon Prime Video', defaultLang: { code: 'en', label: 'English' } },
  { page: 'List_of_Amazon_Prime_Video_original_films', platform: 'Amazon Prime Video', defaultLang: { code: 'en', label: 'English' } },
  { page: 'List_of_JioHotstar_original_programming', platform: 'JioHotstar', defaultLang: { code: 'hi', label: 'Hindi' } },
  { page: 'List_of_ZEE5_original_programming', platform: 'ZEE5', defaultLang: { code: 'hi', label: 'Hindi' } },
  { page: 'List_of_SonyLIV_original_programming', platform: 'Sony LIV', defaultLang: { code: 'hi', label: 'Hindi' } },
  { page: 'Aha_(streaming_service)', platform: 'Aha', defaultLang: { code: 'te', label: 'Telugu' } },
  { page: 'ETV_Win', platform: 'ETV Win', defaultLang: { code: 'te', label: 'Telugu' } },
]

const LANGUAGE_NAMES: Record<string, string> = {
  hindi: 'hi', telugu: 'te', tamil: 'ta', malayalam: 'ml', kannada: 'kn',
  bengali: 'bn', marathi: 'mr', punjabi: 'pa', english: 'en', korean: 'ko',
  japanese: 'ja', spanish: 'es', gujarati: 'gu', odia: 'or', urdu: 'ur',
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function parseDateCell(text: string): string | null {
  // "21 July 2026"
  let m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (m) {
    const month = MONTH_NAMES[m[2].toLowerCase()]
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`
  }
  // "July 21, 2026"
  m = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/)
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()]
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${String(parseInt(m[2], 10)).padStart(2, '0')}`
  }
  return null
}

function languageFromRow(cells: string[], fallback: { code: string; label: string }) {
  for (const cell of cells) {
    const words = cell.toLowerCase().split(/[^a-z]+/)
    for (const w of words) {
      if (LANGUAGE_NAMES[w]) {
        return { code: LANGUAGE_NAMES[w], label: w.charAt(0).toUpperCase() + w.slice(1) }
      }
    }
  }
  return fallback
}

function weekBucket(dateIso: string, today: string): number {
  const diffDays = Math.floor(
    (new Date(today + 'T00:00:00Z').getTime() - new Date(dateIso + 'T00:00:00Z').getTime()) / 86_400_000
  )
  return Math.floor(diffDays / 7)
}

export interface WikiOttResult {
  past: OttRelease[]
  upcoming: OttRelease[]
}

export async function sweepWikipediaOtt(
  from: string,
  to: string,
  maxWeeks: number,
  existingTitles: Set<string>
): Promise<WikiOttResult> {
  const today = new Date().toISOString().slice(0, 10)
  const past: OttRelease[] = []
  const upcoming: OttRelease[] = []
  const seen = new Set<string>()
  let pagesOk = 0

  for (const { page, platform, defaultLang } of PLATFORM_PAGES) {
    try {
      const html = await fetchWikiHtml(page)
      const $ = cheerio.load(html)

      for (const table of $('table.wikitable').toArray()) {
        // Nearest preceding heading decides films vs series
        const heading = $(table)
          .prevAll('h2, h3, h4, div.mw-heading')
          .first()
          .text()
          .toLowerCase()
        const contentType: 'movie' | 'series' = /film|movie/.test(heading) ? 'movie' : 'series'

        for (const row of expandAnyTable($, table)) {
          if (row.length < 2) continue
          let date: string | null = null
          for (const cell of row) {
            date = parseDateCell(cell ?? '')
            if (date) break
          }
          if (!date || date < from || date > to) continue

          const title = (row.find((c) => c && !parseDateCell(c) && c.length > 1 && !/^\d+$/.test(c)) ?? '').trim()
          if (!title || /^(title|premiere|genre|language|status|seasons|episodes|length|notes)/i.test(title)) continue

          const norm = normalizeTitle(title)
          if (!norm || existingTitles.has(norm)) continue
          const lang = languageFromRow(row, defaultLang)
          const id = `wiki-ott-${norm}-${date}`
          if (seen.has(id)) continue
          seen.add(id)

          const release: OttRelease = {
            id,
            title: cleanText(title),
            originalTitle: cleanText(title),
            language: lang.code,
            languageLabel: lang.label,
            releaseDate: date,
            overview: `${contentType === 'series' ? 'Original series' : 'Original film'} on ${platform}. Listed on Wikipedia.`,
            poster: null,
            rating: 0,
            votes: 0,
            platforms: [platform],
            week: -1,
            contentType,
          }

          if (date > today) {
            upcoming.push(release)
          } else {
            const bucket = weekBucket(date, today)
            if (bucket >= 0 && bucket < maxWeeks) {
              release.week = bucket
              past.push(release)
            }
          }
        }
      }
      pagesOk++
    } catch {
      // A missing or rate-limited page is skipped; other platforms continue
    }
  }

  console.log(
    `🤖 Release agent: Wikipedia OTT sweep parsed ${pagesOk}/${PLATFORM_PAGES.length} platform pages, added ${past.length} arrivals + ${upcoming.length} upcoming`
  )
  return { past, upcoming }
}
