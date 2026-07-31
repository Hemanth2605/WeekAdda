import { ArticleFilm, ArticleWatch } from './types'
import { watchUrl } from './watchLinks'

/**
 * Where a film's platform badge actually points: the exact title page when the
 * writer had one, a search on that platform otherwise. A deep link is always
 * better — a search can land on the wrong film, or on nothing.
 *
 * Mirrors watchHref in backend/src/seo.ts; the pre-render and the page have to
 * agree, or a crawler and a reader see different links.
 */
export function watchHref(w: ArticleWatch, title: string): string {
  return w.url ?? watchUrl(w.name, title)
}

/**
 * The platform a pasted URL belongs to, so a link a writer drops into the prose
 * can be shown as that service's button rather than as a naked URL nobody reads.
 *
 * Matched on the registrable domain, not on "contains", so a link that merely
 * mentions netflix in a path or query is not mistaken for one.
 *
 * Mirrors platformFromUrl in backend/src/seo.ts — the pre-render and the page
 * must label a link identically.
 */
const URL_PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)netflix\.com$/, 'Netflix'],
  [/(^|\.)primevideo\.com$/, 'Amazon Prime Video'],
  [/(^|\.)(hotstar|jiohotstar)\.com$/, 'JioHotstar'],
  [/(^|\.)sonyliv\.com$/, 'Sony LIV'],
  [/(^|\.)zee5\.com$/, 'ZEE5'],
  [/(^|\.)aha\.video$/, 'Aha'],
  [/(^|\.)sunnxt\.com$/, 'Sun NXT'],
  [/(^|\.)etvwin\.com$/, 'ETV Win'],
  [/(^|\.)tv\.apple\.com$/, 'Apple TV'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
]

export function platformFromUrl(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  return URL_PLATFORMS.find(([re]) => re.test(host))?.[1] ?? null
}

export interface FilmMention {
  film: ArticleFilm
  /** Where the title ends in the paragraph — the badges go here. */
  end: number
  start: number
}

/**
 * Find the films named in one paragraph, so the badges can sit beside the title
 * being talked about rather than only in a block underneath.
 *
 * First mention only (tracked across paragraphs via `used`), and only on a word
 * boundary — otherwise the film "83" is found inside "1983". Mirrors
 * markFilmsEscaped in backend/src/seo.ts.
 */
export function findFilmMentions(
  text: string,
  films: ArticleFilm[],
  used: Set<string>
): FilmMention[] {
  const found: FilmMention[] = []
  const lower = text.toLowerCase()
  for (const film of films) {
    if (used.has(film.title) || film.platforms.length === 0) continue
    const at = lower.indexOf(film.title.toLowerCase())
    if (at < 0) continue
    const before = text[at - 1]
    const after = text[at + film.title.length]
    if ((before && /[A-Za-z0-9]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) continue
    used.add(film.title)
    found.push({ film, start: at, end: at + film.title.length })
  }
  return found.sort((a, b) => a.start - b.start)
}
