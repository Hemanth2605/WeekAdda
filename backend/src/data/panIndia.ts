/**
 * Films released in more than one language — the "pan-India" list.
 *
 * This is hand-maintained on purpose. No data source we have knows it: TMDB
 * carries one record per film under the language it was shot in, with
 * `spoken_languages` naming only that language, a single undifferentiated India
 * release date, and no separate records for the dubbed versions. Budget looked
 * like a proxy and is not — it is recorded on barely a third of Indian titles,
 * and it cannot tell an expensive single-language film from a modest
 * multi-language one.
 *
 * It stays small: a handful of films a year get a genuine multi-language
 * release. Adding one is a one-line edit, and getting it wrong is visible to
 * everyone, so add a film only once its dubbed release is actually announced.
 *
 * `title` is matched loosely (case, spacing and punctuation are ignored) against
 * both the title and the original title, so "KGF: Chapter 2" here will match a
 * cache row reading "K.G.F: Chapter 2". Give `year` when a title is common
 * enough to collide with a different film; leave it off to match any year.
 *
 * `languages` lists every language the film can be watched in, **original
 * first** — the original is what the film is sorted and labelled by, and the
 * rest are what it also plays in.
 */
export interface PanIndiaFilm {
  title: string
  year?: string
  languages: string[]
}

export const PAN_INDIA_FILMS: PanIndiaFilm[] = [
  // Telugu-original, released across the south and in Hindi
  { title: 'Peddi', year: '2026', languages: ['te', 'hi', 'ta', 'ml', 'kn'] },
]

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

/** Curated titles keyed for lookup; built once, not per film. */
const INDEX = new Map<string, PanIndiaFilm[]>()
for (const film of PAN_INDIA_FILMS) {
  const key = normalize(film.title)
  const bucket = INDEX.get(key)
  if (bucket) bucket.push(film)
  else INDEX.set(key, [film])
}

/**
 * The release languages for a film, or null if it is not a curated pan-India
 * title. Checks both the display and original titles, since the same film
 * reaches us under either depending on which sweep found it.
 */
export function panIndiaLanguages(
  title: string,
  originalTitle: string,
  releaseDate: string
): string[] | null {
  const year = releaseDate.slice(0, 4)
  for (const key of new Set([normalize(title), normalize(originalTitle)])) {
    if (!key) continue
    for (const film of INDEX.get(key) ?? []) {
      // An entry without a year matches any; with one, only that year
      if (film.year && film.year !== year) continue
      return film.languages
    }
  }
  return null
}
