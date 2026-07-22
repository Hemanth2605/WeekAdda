import * as cheerio from 'cheerio'
import type { Release } from './releaseAgent'

/**
 * Wikipedia film-list source.
 *
 * Pages like "List of Telugu films of 2026" hold fan-maintained release tables
 * (month / day / title / director / cast) that often list regional films before
 * TMDB does. We parse those tables and merge anything TMDB is missing.
 * Parsing is defensive: a section or page that doesn't parse is skipped.
 */

const WIKI_LANGUAGES = [
  { code: 'hi', label: 'Hindi', page: 'List_of_Hindi_films_of_' },
  { code: 'te', label: 'Telugu', page: 'List_of_Telugu_films_of_' },
  { code: 'ta', label: 'Tamil', page: 'List_of_Tamil_films_of_' },
  { code: 'ml', label: 'Malayalam', page: 'List_of_Malayalam_films_of_' },
  { code: 'kn', label: 'Kannada', page: 'List_of_Kannada_films_of_' },
  { code: 'bn', label: 'Bengali', page: 'List_of_Bengali_films_of_' },
  { code: 'mr', label: 'Marathi', page: 'List_of_Marathi_films_of_' },
  { code: 'pa', label: 'Punjabi', page: 'List_of_Punjabi_films_of_' },
]

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

const HEADER_WORDS = /^(opening|title|director|cast|production|producer|music|studio|ref|notes|genre|source)/i

export function cleanText(text: string) {
  return text
    .replace(/\[[a-z0-9]{1,3}\]/gi, '') // citation + footnote markers like [1], [d], [note]
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// All Wikipedia fetches go through one serialized queue with a polite gap,
// so parallel sweeps never trip Wikipedia's rate limiter (HTTP 429).
let wikiQueue: Promise<unknown> = Promise.resolve()
const WIKI_GAP_MS = 700

export function fetchWikiHtml(page: string): Promise<string> {
  const task = wikiQueue.then(async () => {
    await new Promise((r) => setTimeout(r, WIKI_GAP_MS))
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(page)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CinePitch/1.0 (release tracker; contact: hemanth.mareedu8@gmail.com)' },
    })
    if (!res.ok) throw new Error(`Wikipedia ${res.status} for ${page}`)
    return res.text()
  })
  wikiQueue = task.catch(() => {}) // keep the queue alive after failures
  return task
}

/** Expand an HTML table into a text grid, resolving rowspan/colspan. */
export function expandAnyTable($: cheerio.CheerioAPI, table: any): string[][] {
  const grid: string[][] = []
  // pending[col] = cell text continuing from a rowspan above
  const pending: Map<number, { text: string; remaining: number }> = new Map()

  for (const tr of $(table).find('tr').toArray()) {
    const row: string[] = []
    const cells = $(tr).find('th,td').toArray()
    let col = 0
    let ci = 0
    while (ci < cells.length || pending.has(col)) {
      if (col > 40) break // safety bound
      const carried = pending.get(col)
      if (carried) {
        row[col] = carried.text
        carried.remaining--
        if (carried.remaining <= 0) pending.delete(col)
        col++
        continue
      }
      const cell = cells[ci++]
      if (!cell) break
      const text = cleanText($(cell).text())
      const rowspan = Math.min(parseInt($(cell).attr('rowspan') ?? '1', 10) || 1, 200)
      const colspan = Math.min(parseInt($(cell).attr('colspan') ?? '1', 10) || 1, 40)
      for (let k = 0; k < colspan; k++) {
        row[col] = text
        if (rowspan > 1) pending.set(col, { text, remaining: rowspan - 1 })
        col++
      }
    }
    grid.push(row)
  }
  return grid
}

function monthFromCell(text: string): number | null {
  const compact = text.replace(/\s+/g, '').toUpperCase()
  if (compact.length < 3 || compact.length > 12) return null
  const key = compact.slice(0, 3)
  if (MONTHS[key] && (compact.length <= 4 || compact in MONTHS || /^[A-Z]+$/.test(compact))) {
    return MONTHS[key]
  }
  return null
}

interface WikiFilm {
  title: string
  date: string // ISO
  director: string
  cast: string
}

function parseFilmsFromHtml(html: string, year: number): WikiFilm[] {
  const $ = cheerio.load(html)
  const films: WikiFilm[] = []

  for (const table of $('table.wikitable').toArray()) {
    const grid = expandAnyTable($, table)
    let month: number | null = null

    for (const row of grid) {
      if (!row.length) continue
      // Month and day usually occupy the first two columns (with rowspans)
      let day: number | null = null
      let titleCol = -1

      for (let c = 0; c < Math.min(row.length, 4); c++) {
        const cell = row[c] ?? ''
        const m = monthFromCell(cell)
        if (m) {
          month = m
          continue
        }
        if (/^\d{1,2}$/.test(cell)) {
          const d = parseInt(cell, 10)
          if (d >= 1 && d <= 31) {
            day = d
            titleCol = c + 1
            break
          }
        }
      }

      if (month === null || day === null || titleCol < 0) continue
      const title = row[titleCol] ?? ''
      if (!title || title.length < 2 || HEADER_WORDS.test(title) || /^\d+$/.test(title)) continue

      const director = cleanText(row[titleCol + 1] ?? '')
      const cast = cleanText(row[titleCol + 2] ?? '')
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      films.push({ title: cleanText(title), date: iso, director, cast })
    }
  }
  return films
}

async function fetchPageFilms(page: string, year: number): Promise<WikiFilm[]> {
  return parseFilmsFromHtml(await fetchWikiHtml(page + year), year)
}

/**
 * Sweep Wikipedia film lists for all Indian languages, returning releases in
 * [from..to] that are NOT already present in `existing` (matched by title).
 */
export async function sweepWikipedia(
  from: string,
  to: string,
  existing: Release[]
): Promise<Release[]> {
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])]
  const known = new Set(existing.map((r) => normalizeTitle(r.title)))
  existing.forEach((r) => known.add(normalizeTitle(r.originalTitle)))

  const results = await Promise.allSettled(
    WIKI_LANGUAGES.flatMap((lang) =>
      years.map(async (year) => ({ lang, films: await fetchPageFilms(lang.page, year) }))
    )
  )

  const out: Release[] = []
  const seen = new Set<string>()
  let pagesOk = 0

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    pagesOk++
    const { lang, films } = result.value
    for (const f of films) {
      if (f.date < from || f.date > to) continue
      const norm = normalizeTitle(f.title)
      if (!norm || known.has(norm)) continue
      const id = `wiki-${lang.code}-${norm}-${f.date}`
      if (seen.has(id)) continue
      seen.add(id)
      const overviewParts = []
      if (f.director) overviewParts.push(`Directed by ${f.director}`)
      if (f.cast) overviewParts.push(`starring ${f.cast}`)
      out.push({
        id,
        title: f.title,
        originalTitle: f.title,
        language: lang.code,
        languageLabel: lang.label,
        releaseDate: f.date,
        overview: overviewParts.length
          ? `${overviewParts.join(', ')}. Listed on Wikipedia's ${lang.label} film list.`
          : `Listed on Wikipedia's ${lang.label} film list — details coming soon.`,
        poster: null,
        rating: 0,
        votes: 0,
      })
    }
  }

  console.log(`🤖 Release agent: Wikipedia sweep parsed ${pagesOk}/${results.length} pages, added ${out.length} films TMDB missed`)
  return out
}
