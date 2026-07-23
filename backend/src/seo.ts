import {
  ReleaseCache,
  CricketCache,
  BlogPost,
  OttRelease,
  queryReleases,
  queryCricket,
} from './queries'

/**
 * Edge pre-render: plain-HTML content blocks the Worker injects inside
 * <div id="root"> so crawlers (and no-JS clients) see real titles instead of
 * an empty shell. React clears the container when it mounts, so visitors only
 * glimpse this during the first paint. Must stay free of Node-only imports.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function day(iso: string): string {
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const WRAP_OPEN =
  '<div style="max-width:900px;margin:0 auto;padding:40px 24px;line-height:1.7">'
const NAV =
  '<p><a href="/movies">Movies &amp; OTT</a> · <a href="/cricket">Cricket</a> · <a href="/blog">Blog</a></p>'

function section(title: string, items: string[]): string {
  if (items.length === 0) return ''
  return `<h2>${esc(title)}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

/** Group releases by language, Telugu first, then biggest groups first. */
function byLanguage<T extends { languageLabel: string }>(list: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const r of list) {
    const arr = map.get(r.languageLabel) ?? []
    arr.push(r)
    map.set(r.languageLabel, arr)
  }
  return [...map.entries()].sort((a, b) => {
    const telugu = Number(b[0] === 'Telugu') - Number(a[0] === 'Telugu')
    if (telugu !== 0) return telugu
    return b[1].length - a[1].length
  })
}

export function buildMoviesSeo(data: ReleaseCache): string {
  const extras = { syncing: false, liveConfigured: data.source === 'tmdb' }
  const released = queryReleases(data, { window: 'released' }, extras).releases
  // The ott window serves OttRelease entries, which carry platforms
  const ott = queryReleases(data, { window: 'ott' }, extras).releases as OttRelease[]
  const upcoming = queryReleases(data, { window: 'upcoming' }, extras).releases.slice(0, 15)

  // Per-language sections match how people actually search:
  // "OTT Telugu movies this week", "new Tamil movies in theatres", ...
  const theatreSections = byLanguage(released)
    .map(([lang, items]) =>
      section(
        `${lang} movies in theatres this week`,
        items.slice(0, 15).map((r) => `${esc(r.title)} — released ${day(r.releaseDate)}`)
      )
    )
    .join('')
  const ottSections = byLanguage(ott)
    .map(([lang, items]) =>
      section(
        `${lang} OTT releases this week in India`,
        items
          .slice(0, 15)
          .map(
            (r) =>
              `${esc(r.title)}${r.contentType === 'series' ? ' (web series)' : ''}${r.platforms?.length ? ` — streaming on ${esc(r.platforms.join(', '))}` : ''}`
          )
      )
    )
    .join('')

  return (
    WRAP_OPEN +
    '<h1>New Movie Releases This Week &amp; OTT Arrivals in India</h1>' +
    theatreSections +
    ottSections +
    section(
      'Coming soon',
      upcoming.map((r) => `${esc(r.title)} (${esc(r.languageLabel)}) — ${day(r.releaseDate)}`)
    ) +
    NAV +
    '</div>'
  )
}

export function buildCricketSeo(data: CricketCache): string {
  const results = queryCricket(data, { window: 'recent', week: 0 }, { syncing: false }).matches.slice(0, 20)
  const upcoming = queryCricket(data, { window: 'upcoming' }, { syncing: false }).matches

  const india = (m: { teams: Array<{ name: string }> }) =>
    m.teams.some((t) => t.name.toLowerCase().startsWith('india'))
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const fixture = (m: (typeof upcoming)[number]) =>
    `${esc(m.name)} — ${day(m.date)}${m.venue ? `, ${esc(m.venue)}` : ''} (${esc(m.series)})`

  // Headed the way people actually search: "India match today", "India
  // match tomorrow", then the rest of India's schedule and everyone else's
  const indiaToday = upcoming.filter((m) => india(m) && m.date.slice(0, 10) === today)
  const indiaTomorrow = upcoming.filter((m) => india(m) && m.date.slice(0, 10) === tomorrow)
  const indiaLater = upcoming
    .filter((m) => india(m) && m.date.slice(0, 10) > tomorrow)
    .slice(0, 10)
  const others = upcoming.filter((m) => !india(m)).slice(0, 15)

  return (
    WRAP_OPEN +
    '<h1>Cricket Results This Week &amp; Upcoming Fixtures</h1>' +
    section('India cricket match today', indiaToday.map(fixture)) +
    section('India cricket match tomorrow', indiaTomorrow.map(fixture)) +
    section('India upcoming matches & schedule', indiaLater.map(fixture)) +
    section(
      'Cricket results this week',
      results.map((m) => {
        const winner = m.teams.find((t) => t.winner)
        const line = winner ? `${winner.name} won` : m.statusDetail || 'Completed'
        return `${esc(m.name)} — ${esc(line)} (${esc(m.series)}, ${day(m.date)})`
      })
    ) +
    section('Other upcoming international matches', others.map(fixture)) +
    NAV +
    '</div>'
  )
}

export function buildBlogSeo(posts: BlogPost[]): string {
  return (
    WRAP_OPEN +
    '<h1>The WeekAdda Blog — Audience Takes on Movies &amp; Cricket</h1>' +
    section(
      'Latest posts',
      posts
        .slice(0, 20)
        .map((p) => `${esc(p.title)} — about ${esc(p.tag.label)}, by ${esc(p.author)}`)
    ) +
    NAV +
    '</div>'
  )
}
