import * as cheerio from 'cheerio'
import { fetchWikiHtml, fetchWikiArticles, normalizeTitle, WIKI_LANGUAGES } from './wikipediaSource'

/**
 * Which films released in more than one language.
 *
 * Nothing in our data knows this. TMDB carries one record per film under the
 * language it was shot in — `spoken_languages` names only that language, the
 * India release date is a single undifferentiated entry, and the dubbed
 * versions get no records of their own. Budget looked like a proxy and is not.
 *
 * The films' own Wikipedia articles say it outright ("released simultaneously
 * in Telugu, Tamil, Hindi, Kannada, and Malayalam"), and the film-list pages we
 * already sweep link to every one of those articles. So: harvest the links,
 * batch-read the articles, and read the sentence.
 *
 * Three things this gets wrong if done naively, each of which cost a round of
 * false positives before it was fixed:
 *
 *  - Following every link in a list row drags in the director and cast pages.
 *    An actor's article mentions dozens of films in several languages, so half
 *    the "detections" were people. Wikipedia italicises film titles and not
 *    people, so only italic links are followed.
 *  - A sentence naming languages is not necessarily about the film's release.
 *    Song titles, dubbed-version *track* listings and title-registration
 *    disputes all name languages; so does a dub that was only ever *planned*.
 *    Those are rejected outright.
 *  - "Dubbed in Tamil and Malayalam" omits the language the film is actually
 *    in, so a film read that way would lose its own language. The original
 *    comes from the article's infobox instead.
 *
 * Prose is looser than the tables the rest of the sweep parses, so everything
 * here fails soft: an article that stops matching costs that film its badge and
 * nothing else. The curated list in ../data/panIndia.ts overrides whatever this
 * finds, for the films worth pinning by hand.
 */

/** Language names as they appear in article prose, to the codes we store. */
const LANGUAGE_CODES: Record<string, string> = {
  Telugu: 'te',
  Tamil: 'ta',
  Hindi: 'hi',
  Malayalam: 'ml',
  Kannada: 'kn',
  Bengali: 'bn',
  Marathi: 'mr',
  Punjabi: 'pa',
}

/** Sentences that could be stating what the film released in. */
const RELEASE_SENTENCE = /[^.\n]*\b(?:released|releasing|dubbed)\b[^.\n]*\./gi

/**
 * …and the ones that only look like it. A song, an album track, a title
 * registration or an intention names languages without the film ever having
 * played in them.
 */
const NOT_A_RELEASE =
  /\b(song|single|track|album|credits|lyric|registered|announce\w*|planned|propos\w*|rumou?r\w*|reportedly|dispute|parties)\b/i

export interface PanIndiaMatch {
  /** Release languages, the film's own first. */
  languages: string[]
  /** Year of the list page it came from, to keep remakes apart. */
  year: string
  /** The sentence it was read from, for the sweep log. */
  evidence: string
}

/** Strip Wikipedia's disambiguator: "Karuppu (film)" -> "Karuppu". */
const withoutQualifier = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '')

/** The language an article's infobox says the film is in. */
function originalFromInfobox(wikitext: string): string | null {
  const row = wikitext.match(/^\s*\|\s*languages?\s*=\s*(.+)$/im)
  if (!row) return null
  for (const [name, code] of Object.entries(LANGUAGE_CODES)) {
    if (new RegExp(`\\b${name}\\b`).test(row[1])) return code
  }
  return null
}

/** Read the release languages out of one article, or null if it names none. */
export function languagesFromArticle(wikitext: string, fallback: string): string[] | null {
  const prose = wikitext
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/\[\[([^|\]]*\|)?/g, '')
    .replace(/\]\]/g, '')
  const original = originalFromInfobox(wikitext) ?? fallback

  for (const sentence of prose.match(RELEASE_SENTENCE) ?? []) {
    if (NOT_A_RELEASE.test(sentence)) continue
    const found = new Set<string>()
    for (const [name, code] of Object.entries(LANGUAGE_CODES)) {
      if (new RegExp(`\\b${name}\\b`).test(sentence)) found.add(code)
    }
    // One language named is just a film in that language
    if (found.size < 2) continue
    found.add(original)
    return [original, ...[...found].filter((c) => c !== original)]
  }
  return null
}

/** Film-article links from one list page, keyed by the title as displayed. */
function italicFilmLinks(html: string): Map<string, string> {
  const $ = cheerio.load(html)
  const links = new Map<string, string>()
  // Italic = film title. Directors and cast in the same row are not italicised,
  // and following them is what turned actor pages into false detections.
  for (const a of $('table.wikitable td i a').toArray()) {
    const href = $(a).attr('href') ?? ''
    const text = $(a).text().trim()
    const match = href.match(/^\.\/([^#?]+)$/)
    if (!match || !text) continue
    links.set(text, decodeURIComponent(match[1]).replace(/_/g, ' '))
  }
  return links
}

/**
 * Sweep the year's film lists for multi-language releases, keyed by normalized
 * title so a film can be matched however it reached us. Both the displayed
 * title and the article name are keyed, since the two differ whenever
 * Wikipedia needs a disambiguator.
 */
export async function sweepPanIndia(from: string, to: string): Promise<Map<string, PanIndiaMatch>> {
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])]
  // article name -> the list that linked it (its language and year)
  const sources = new Map<string, { listTitle: string; code: string; year: string }>()
  let pagesOk = 0
  let pagesTried = 0

  for (const lang of WIKI_LANGUAGES) {
    for (const year of years) {
      pagesTried++
      try {
        const links = italicFilmLinks(await fetchWikiHtml(lang.page + year))
        pagesOk++
        for (const [listTitle, article] of links) {
          // First list to claim a film wins; the infobox decides the original
          // language anyway, so which list found it barely matters
          if (!sources.has(article)) {
            sources.set(article, { listTitle, code: lang.code, year: String(year) })
          }
        }
      } catch {
        // A list page that will not load costs its films and nothing else
      }
    }
  }

  const articles = await fetchWikiArticles([...sources.keys()])
  const found = new Map<string, PanIndiaMatch>()

  for (const [article, wikitext] of articles) {
    const source = sources.get(article)
    if (!source) continue
    const languages = languagesFromArticle(wikitext, source.code)
    if (!languages) continue
    const match: PanIndiaMatch = { languages, year: source.year, evidence: article }
    for (const key of [
      normalizeTitle(source.listTitle),
      normalizeTitle(withoutQualifier(article)),
    ]) {
      if (key && !found.has(key)) found.set(key, match)
    }
  }

  console.log(
    `🤖 Release agent: pan-India scan read ${articles.size} film article(s) from ${pagesOk}/${pagesTried} list page(s), ${new Set([...found.values()]).size} multi-language`
  )
  return found
}
