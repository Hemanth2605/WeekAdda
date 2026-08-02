/**
 * Announced OTT premieres that no source we sweep records — the hand-maintained
 * list, in the same spirit as the pan-India one.
 *
 * The gap this fills is specific and common: a film opens in cinemas, its
 * streaming date is announced weeks later by the platform, and TMDB is never
 * told. "Lenin" (Telugu, in cinemas 10 July 2026, ZEE5 from 7 August) carries
 * exactly one India release date — type 3, theatrical — and an empty
 * `watch/providers`, so the per-provider query has nothing to match and the
 * generic digital query has no digital date to find. Wikipedia's ZEE5 pages
 * list only originals, and a post-theatrical acquisition is not one. Every
 * automatic route is genuinely empty; the date exists only in the trade press.
 *
 * So this list is not a workaround for a sweep that could be smarter — it is
 * the only place the fact can live until TMDB catches up. When TMDB does catch
 * up, the sweep finds the title on its own and the merge below simply agrees
 * with itself; a stale line here costs nothing but is worth deleting.
 *
 * Keep it short and keep it sourced: add a film only once the platform has
 * actually announced the date, never on a rumour. Getting one wrong puts a
 * confident wrong date in front of everyone.
 *
 * `title` matches loosely against both the title and the original title (case,
 * spacing and punctuation ignored), so "Lenin" here matches a cache row reading
 * "Lenin ". Give `year` — the theatrical year — when a title could collide with
 * another film; leave it off to match any year.
 */
export interface OttPremiere {
  title: string
  year?: string
  /** ISO date the film starts streaming. */
  date: string
  /** Must be spelled exactly as OTT_PROVIDERS labels it, or the hubs miss it. */
  platform: string
}

export const OTT_PREMIERES: OttPremiere[] = [
  // Akhil Akkineni's Telugu film; in cinemas 10 July 2026, ZEE5 from 7 August
  { title: 'Lenin', year: '2026', date: '2026-08-07', platform: 'ZEE5' },
]

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

/** Curated titles keyed for lookup; built once, not per film. */
const INDEX = new Map<string, OttPremiere[]>()
for (const premiere of OTT_PREMIERES) {
  const key = normalize(premiere.title)
  const bucket = INDEX.get(key)
  if (bucket) bucket.push(premiere)
  else INDEX.set(key, [premiere])
}

/**
 * The announced premiere for a film, or null if it is not a curated one.
 * Checks both the display and original titles, since the same film reaches us
 * under either depending on which sweep found it.
 *
 * `theatricalDate` is matched against `year` rather than the premiere's own
 * date: the entry names the film by the year it came out, which is what a
 * reader looking the line up would check.
 */
export function ottPremiere(
  title: string,
  originalTitle: string,
  theatricalDate: string
): OttPremiere | null {
  const year = theatricalDate.slice(0, 4)
  for (const key of new Set([normalize(title), normalize(originalTitle)])) {
    if (!key) continue
    for (const premiere of INDEX.get(key) ?? []) {
      // An entry without a year matches any; with one, only that year
      if (premiere.year && premiere.year !== year) continue
      return premiere
    }
  }
  return null
}
