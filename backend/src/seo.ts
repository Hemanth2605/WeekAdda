import {
  ReleaseCache,
  CricketCache,
  BlogPost,
  Release,
  OttRelease,
  CricketMatch,
  queryReleases,
  queryCricket,
  findTitle,
  relatedTitles,
  titleUrl,
} from './queries'

/**
 * Edge pre-render: plain-HTML content blocks the Worker injects inside
 * <div id="root"> so crawlers (and no-JS clients) see real titles instead of
 * an empty shell. React clears the container when it mounts, so visitors only
 * glimpse this during the first paint. Must stay free of Node-only imports.
 *
 * Wording here is deliberately phrased the way people search: "OTT releases
 * this week", "[movie] OTT release date", "which platform is [movie] on",
 * "[movie] theatre release date", "India vs [team] next match date & time".
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

/** Match start time in IST, or '' when the feed only carries a date. */
function istTime(iso: string): string {
  if (iso.length <= 10 || /T00:00/.test(iso)) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }) + ' IST'
  )
}

/** JSON-LD block; </script>-safe. Crawlers read it from the raw HTML. */
function jsonLd(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`
}

const WRAP_OPEN =
  '<div style="max-width:900px;margin:0 auto;padding:40px 24px;line-height:1.7">'
const NAV =
  '<p><a href="/movies">Movies &amp; OTT</a> · <a href="/cricket">Cricket</a> · <a href="/blog">Blog</a></p>'

function section(title: string, items: string[]): string {
  if (items.length === 0) return ''
  return `<h2>${esc(title)}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

// ---------------- per-route <head> metadata ----------------

/**
 * Route-specific <title> / meta description the Worker stamps into the raw
 * HTML (the SPA sets its own at runtime, but crawlers that skip rendering
 * would otherwise see the homepage title on every route). Returned strings
 * are HTML-escaped and safe to splice into attributes/text.
 */
export function routeMeta(pathname: string): { title: string; description: string } | null {
  const meta: Record<string, { title: string; description: string }> = {
    '/movies': {
      title: 'OTT & Theatre Movie Releases This Week India | WeekAdda',
      description:
        'New OTT releases this week in India — movies & web series on Netflix, Prime Video, JioHotstar, ZEE5 & Aha, plus theatre releases and upcoming release dates.',
    },
    '/blog': {
      title: 'WeekAdda Blog — Audience Takes on Movies & Cricket',
      description:
        'Real audience blogs about this week\u2019s movies, OTT releases and cricket matches — written by WeekAdda visitors, tagged to the title or match they talk about.',
    },
    '/about': {
      title: 'About WeekAdda — Built by Hemanth Mareedu',
      description:
        'WeekAdda is built by Hemanth Mareedu, a software engineer and movie & cricket fan — weekly movie releases, OTT arrivals and cricket updates in one place.',
    },
    '/adda': {
      title: 'The Adda — Ask, Offer & Find Company | WeekAdda',
      description:
        'A community board for movie and cricket fans in India: spare tickets at face value, company for a show or match, honest asks. Free to read; respond with Google sign-in.',
    },
    '/privacy': {
      title: 'Privacy Policy | WeekAdda',
      description:
        'What WeekAdda collects, why, and who can see it — in plain language. Browsing needs no account; Google sign-in is used only for posting, rating and the Adda.',
    },
  }
  const m = meta[pathname]
  return m ? { title: esc(m.title), description: esc(m.description) } : null
}

// ---------------- /movies ----------------

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

/** Crawlable link to the title's own page. */
function titleLink(r: { id: string; title: string }): string {
  return `<a href="${titleUrl(r)}">${esc(r.title)}</a>`
}

/** "Kingdom (web series) is now streaming on Netflix — OTT release date 22 Jul 2026" */
function ottLine(r: OttRelease): string {
  const kind = r.contentType === 'series' ? ' (web series)' : ''
  const where = r.platforms?.length
    ? ` is now streaming on ${esc(r.platforms.join(', '))}`
    : ' is now streaming on OTT in India'
  return `${titleLink(r)}${kind}${where} — OTT release date ${day(r.releaseDate)}`
}

export function buildMoviesSeo(data: ReleaseCache): string {
  const extras = { syncing: false, liveConfigured: data.source === 'tmdb' }
  const released = queryReleases(data, { window: 'released' }, extras).releases
  // The ott window serves OttRelease entries, which carry platforms
  const ott = queryReleases(data, { window: 'ott' }, extras).releases as OttRelease[]
  const upcoming = queryReleases(data, { window: 'upcoming' }, extras).releases.slice(0, 15)
  const upcomingOtt = queryReleases(
    data,
    { window: 'upcoming', source: 'ott' },
    extras
  ).releases.slice(0, 15) as OttRelease[]

  const weekFrom = day(new Date(Date.now() - 6 * 86_400_000).toISOString())
  const weekTo = day(new Date().toISOString())

  // Per-language sections match how people actually search:
  // "OTT Telugu movies this week", "new Tamil movies in theatres", ...
  const ottSections = byLanguage(ott)
    .map(([lang, items]) =>
      section(
        `${lang} OTT releases this week in India — new movies & web series`,
        items.slice(0, 15).map(ottLine)
      )
    )
    .join('')
  const webSeries = ott.filter((r) => r.contentType === 'series')
  const theatreSections = byLanguage(released)
    .map(([lang, items]) =>
      section(
        `${lang} movies in theatres this week`,
        items.slice(0, 15).map((r) => `${titleLink(r)} — released ${day(r.releaseDate)}`)
      )
    )
    .join('')

  const ld =
    ott.length === 0
      ? ''
      : jsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'New OTT releases this week in India',
          itemListElement: ott.slice(0, 20).map((r, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': r.contentType === 'series' ? 'TVSeries' : 'Movie',
              name: r.title,
              ...(r.poster ? { image: r.poster } : {}),
              datePublished: r.releaseDate,
              inLanguage: r.language,
            },
          })),
        })

  return (
    WRAP_OPEN +
    '<h1>OTT Releases This Week in India &amp; New Movies in Theatres</h1>' +
    `<p>Updated for the week of ${esc(weekFrom)} – ${esc(weekTo)}: new OTT releases on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5 and Aha, this week's theatre releases in every language, and upcoming OTT &amp; theatre release dates in India.</p>` +
    ottSections +
    section(
      'New web series on OTT this week',
      webSeries
        .slice(0, 15)
        .map(
          (r) =>
            `${titleLink(r)} (${esc(r.languageLabel)}) — new web series${r.platforms?.length ? ` streaming on ${esc(r.platforms.join(', '))}` : ' on OTT'}`
        )
    ) +
    theatreSections +
    section(
      'Upcoming movie release dates in theatres',
      upcoming.map(
        (r) => `${titleLink(r)} (${esc(r.languageLabel)}) releases in theatres on ${day(r.releaseDate)}`
      )
    ) +
    section(
      'Upcoming OTT release dates in India',
      upcomingOtt.map(
        (r) =>
          `${titleLink(r)} (${esc(r.languageLabel)}) — OTT release date ${day(r.releaseDate)}${r.platforms?.length ? ` on ${esc(r.platforms.join(', '))}` : ''}`
      )
    ) +
    NAV +
    ld +
    '</div>'
  )
}

// ---------------- /movie/:id/:slug (per-title pages) ----------------

/**
 * A dedicated crawlable page per movie/series — the unit Google prefers to
 * rank for "[movie] OTT release date" / "where to watch [movie]" queries.
 */
export function buildTitlePage(
  data: ReleaseCache,
  id: string
): { block: string; title: string; description: string; canonical: string; image?: string } | null {
  const found = findTitle(data, id)
  if (!found) return null
  const r = found.item as OttRelease
  const lang = r.languageLabel
  const kind = r.contentType === 'series' ? 'web series' : 'movie'
  const platforms = r.platforms?.length ? r.platforms.join(', ') : ''
  const date = day(r.releaseDate)
  const related = relatedTitles(data, r)

  // The one-line answer to the query that lands people here
  const answer =
    found.status === 'streaming'
      ? `${r.title} is streaming on ${platforms || 'OTT in India'} — OTT release date ${date}.`
      : found.status === 'upcoming-ott'
        ? `${r.title} releases on OTT on ${date}${platforms ? ` on ${platforms}` : ' (platform to be announced)'}.`
        : found.status === 'upcoming-theatre'
          ? `${r.title} releases in theatres on ${date}.`
          : `${r.title} released in theatres on ${date}.`

  const heading =
    found.status === 'streaming' || found.status === 'upcoming-ott'
      ? `${r.title} (${lang}) — OTT Release Date & Where to Watch`
      : `${r.title} (${lang} ${kind}) — Release Date & Details`

  const facts = [
    `Language: ${esc(lang)}`,
    `Type: ${esc(kind)}`,
    `Release date: ${esc(date)}`,
    ...(platforms ? [`Streaming on: ${esc(platforms)}`] : []),
    ...(r.rating > 0 ? [`Rating: ${r.rating.toFixed(1)} / 10 (${r.votes} votes)`] : []),
  ]

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': r.contentType === 'series' ? 'TVSeries' : 'Movie',
    name: r.title,
    ...(r.originalTitle && r.originalTitle !== r.title ? { alternateName: r.originalTitle } : {}),
    ...(r.poster ? { image: r.poster } : {}),
    ...(r.overview ? { description: r.overview } : {}),
    datePublished: r.releaseDate,
    inLanguage: r.language,
    ...(r.rating > 0 && r.votes > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: r.rating,
            ratingCount: r.votes,
            bestRating: 10,
          },
        }
      : {}),
  })

  const block =
    WRAP_OPEN +
    `<h1>${esc(heading)}</h1>` +
    `<p><strong>${esc(answer)}</strong></p>` +
    (r.overview ? `<p>${esc(r.overview)}</p>` : '') +
    `<ul>${facts.map((f) => `<li>${f}</li>`).join('')}</ul>` +
    section(
      `More ${lang} releases on WeekAdda`,
      related.map((t) => `${titleLink(t)} — ${day(t.releaseDate)}`)
    ) +
    NAV +
    ld +
    '</div>'

  // Cap absurdly long source titles (anime/light-novel names) so the tag
  // stays within engines' display budget; the full name lives in the H1
  const shortName =
    r.title.length > 45 ? `${r.title.slice(0, 42).replace(/\s+\S*$/, '')}…` : r.title
  const metaTitle = `${shortName} ${lang} ${
    found.status === 'in-theatres' || found.status === 'upcoming-theatre'
      ? 'Movie Release Date'
      : 'OTT Release Date & Platform'
  } | WeekAdda`
  // ≤160 chars, cut at a word boundary, so engines show this text verbatim
  const full = `${answer}${r.overview ? ` ${r.overview}` : ''}`
  const description =
    full.length <= 160 ? full : `${full.slice(0, 157).replace(/\s+\S*$/, '')}…`

  return {
    block,
    title: esc(metaTitle),
    description: esc(description),
    canonical: `https://weekadda.com${titleUrl(r)}`,
    image: r.poster ?? undefined,
  }
}

// ---------------- /sitemap.xml ----------------

/** Sitemap with every current title page; lastmod = last agent sweep. */
export function buildSitemap(data: ReleaseCache): string {
  const base = 'https://weekadda.com'
  const lastmod = /^\d{4}-\d{2}-\d{2}/.test(data.fetchedAt) ? data.fetchedAt.slice(0, 10) : ''
  const mod = lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
  const urls = ['/', '/movies', '/cricket', '/blog', '/adda', '/about', '/privacy'].map(
    (p) => `<url><loc>${base}${p}</loc>${mod}<changefreq>daily</changefreq><priority>${p === '/' || p === '/movies' ? '1.0' : '0.8'}</priority></url>`
  )
  const seen = new Set<string>()
  for (const r of [...data.ott, ...data.ottUpcoming, ...data.releases] as Release[]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    urls.push(`<url><loc>${base}${titleUrl(r)}</loc>${mod}</url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`
}

// ---------------- /cricket ----------------

const isIndiaTeam = (name: string) => name.toLowerCase().startsWith('india')

const india = (m: { teams: Array<{ name: string }> }) => m.teams.some((t) => isIndiaTeam(t.name))

function fixtureLine(m: CricketMatch, prefix = ''): string {
  const time = istTime(m.date)
  return `${prefix}${esc(m.label || m.name)} on ${day(m.date)}${time ? ` at ${esc(time)}` : ''}${m.venue ? `, ${esc(m.venue)}` : ''} (${esc(m.series)})`
}

/**
 * One section per India series, headed the way people search:
 * "India vs Australia — next match, date & schedule".
 */
function indiaSeriesSections(indiaUpcoming: CricketMatch[]): string {
  const bySeries = new Map<string, CricketMatch[]>()
  for (const m of indiaUpcoming) {
    const key = m.seriesId || m.series
    const arr = bySeries.get(key) ?? []
    arr.push(m)
    bySeries.set(key, arr)
  }
  return [...bySeries.values()]
    .slice(0, 6)
    .map((matches) => {
      const next = matches[0]
      const indiaSide = next.teams.find((t) => isIndiaTeam(t.name))
      const opponent = next.teams.find((t) => !isIndiaTeam(t.name))
      const heading =
        indiaSide && opponent
          ? `${indiaSide.name} vs ${opponent.name} — next match, date & schedule`
          : `${next.series} — next match, date & schedule`
      return section(heading, [
        fixtureLine(next, 'Next match: '),
        ...matches.slice(1, 8).map((m) => fixtureLine(m)),
      ])
    })
    .join('')
}

/** "Australia vs England, 2nd ODI at 4:30 pm IST" — any country, no bias. */
function matchPhrase(m: CricketMatch, withDate = false): string {
  const versus =
    m.teams.length === 2 ? `${m.teams[0].name} vs ${m.teams[1].name}` : m.shortName || m.name
  const time = istTime(m.date)
  return `${versus}${m.label ? `, ${m.label}` : ''}${withDate ? ` on ${day(m.date)}` : ''}${time ? ` at ${time}` : ''}`
}

/** Today's fixtures (all countries) and the soonest upcoming match. */
function fixturesPulse(data: CricketCache): { todays: CricketMatch[]; next: CricketMatch | null } {
  const upcoming = queryCricket(data, { window: 'upcoming' }, { syncing: false }).matches
  const today = new Date().toISOString().slice(0, 10)
  const todays = upcoming.filter((m) => m.date.slice(0, 10) === today)
  const next = [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  return { todays, next }
}

/**
 * Cricket <title>/description built from the live cache so the page never
 * claims "matches today" on a day no cricket is on — every country counts.
 */
export function cricketMeta(data: CricketCache): { title: string; description: string } {
  const { todays, next } = fixturesPulse(data)
  const title =
    todays.length > 0
      ? 'Cricket Matches Today — Time, Venue & Fixtures | WeekAdda'
      : 'Upcoming Cricket Fixtures & Results This Week | WeekAdda'
  const lead =
    todays.length > 0
      ? `Today: ${todays.slice(0, 2).map((m) => matchPhrase(m)).join('; ')}.`
      : next
        ? `Next match: ${matchPhrase(next, true)}.`
        : 'Cricket fixtures and results, updated daily.'
  const full = `${lead} Fixtures with date, time and venue for every international series, plus this week's results.`
  const description = full.length <= 160 ? full : `${full.slice(0, 157).replace(/\s+\S*$/, '')}…`
  return { title: esc(title), description: esc(description) }
}

export function buildCricketSeo(data: CricketCache): string {
  const results = queryCricket(data, { window: 'recent', week: 0 }, { syncing: false }).matches.slice(0, 20)
  const upcoming = queryCricket(data, { window: 'upcoming' }, { syncing: false }).matches

  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  // Headed the way people actually search: "India match today", "India match
  // tomorrow", then each India series as "India vs X — next match & schedule"
  const indiaUpcoming = upcoming.filter(india)
  const indiaToday = indiaUpcoming.filter((m) => m.date.slice(0, 10) === today)
  const indiaTomorrow = indiaUpcoming.filter((m) => m.date.slice(0, 10) === tomorrow)
  const others = upcoming.filter((m) => !india(m)).slice(0, 15)

  const ld =
    indiaUpcoming.length === 0
      ? ''
      : jsonLd({
          '@context': 'https://schema.org',
          '@graph': indiaUpcoming.slice(0, 10).map((m) => ({
            '@type': 'SportsEvent',
            name: m.name,
            sport: 'Cricket',
            startDate: m.date,
            ...(m.venue ? { location: { '@type': 'Place', name: m.venue } } : {}),
            competitor: m.teams.map((t) => ({ '@type': 'SportsTeam', name: t.name })),
          })),
        })

  const { todays, next } = fixturesPulse(data)
  const h1 =
    todays.length > 0
      ? 'Cricket Matches Today, Upcoming Fixtures &amp; Results'
      : 'Upcoming Cricket Fixtures &amp; Results This Week'
  const lead =
    todays.length > 0
      ? `Today: ${esc(todays.slice(0, 3).map((m) => matchPhrase(m)).join('; '))}. `
      : next
        ? `Next match: ${esc(matchPhrase(next, true))}${next.venue ? `, ${esc(next.venue)}` : ''}. `
        : ''

  return (
    WRAP_OPEN +
    `<h1>${h1}</h1>` +
    `<p>${lead}Upcoming fixtures with date, time (IST) and venue for every international series, today's and tomorrow's matches, and this week's completed results — updated daily.</p>` +
    section('India cricket match today', indiaToday.map((m) => fixtureLine(m))) +
    section('India cricket match tomorrow', indiaTomorrow.map((m) => fixtureLine(m))) +
    indiaSeriesSections(indiaUpcoming) +
    section(
      'Cricket results this week',
      results.map((m) => {
        const winner = m.teams.find((t) => t.winner)
        const line = winner ? `${winner.name} won` : m.statusDetail || 'Completed'
        return `${esc(m.name)} — ${esc(line)} (${esc(m.series)}, ${day(m.date)})`
      })
    ) +
    section('Other upcoming international matches', others.map((m) => fixtureLine(m))) +
    NAV +
    ld +
    '</div>'
  )
}

// ---------------- /about ----------------

export function buildAboutSeo(): string {
  return (
    WRAP_OPEN +
    '<h1>About WeekAdda — This Week in Movies, OTT &amp; Cricket</h1>' +
    '<p>WeekAdda — live since July 2026 — puts the week&#39;s entertainment in one clean place, free, no account needed, refreshed automatically every morning:</p>' +
    '<ul>' +
    '<li>New movie releases in Telugu, Hindi, Tamil, Malayalam, Kannada, English and 12+ languages, browsable week by week</li>' +
    '<li>Daily OTT arrivals on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5 and Aha, plus upcoming theatre and OTT release dates</li>' +
    '<li>Cricket fixtures with date, time and venue for every international series, and results week by week</li>' +
    '<li>A visitor blog with real takes and star ratings, each post tagged to the movie or match it talks about</li>' +
    '<li>The Adda — a community board to ask, offer and find company: spare tickets at face value, someone to watch a movie or match with, honest asks between fellow fans</li>' +
    '</ul>' +
    '<h2>Founder</h2>' +
    '<p><strong>Hemanth Mareedu</strong> — a software engineer with 10+ years of experience and a lifelong movie and cricket fan who loves building things that are genuinely helpful to people. Connect with Hemanth on <a href="https://www.linkedin.com/in/hemanth-mareedu-a69271116/" rel="me">LinkedIn</a>.</p>' +
    NAV +
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Hemanth Mareedu',
      url: 'https://weekadda.com/about',
      image: 'https://weekadda.com/founder.jpg',
      jobTitle: 'Software Engineer',
      sameAs: ['https://www.linkedin.com/in/hemanth-mareedu-a69271116/'],
      knowsAbout: ['Movies', 'OTT platforms', 'Cricket'],
      mainEntityOfPage: 'https://weekadda.com/about',
    }) +
    '</div>'
  )
}

// ---------------- /adda ----------------

export function buildAddaSeo(listings: Array<{ title: string; author: string; ts: string }>): string {
  return (
    WRAP_OPEN +
    '<h1>The Adda — Ask, Offer &amp; Find Company</h1>' +
    '<p>A community board for movie and cricket fans in India: spare tickets at face value, company for a show or a match, honest asks. Free to read; responding takes a Google sign-in, and contact details are shared only between the two people.</p>' +
    section(
      'Open on the adda right now',
      listings.slice(0, 20).map((l) => `${esc(l.title)} — posted by ${esc(l.author)}, ${day(l.ts)}`)
    ) +
    NAV +
    '</div>'
  )
}

// ---------------- /privacy ----------------

export function buildPrivacySeo(): string {
  return (
    WRAP_OPEN +
    '<h1>WeekAdda Privacy Policy</h1>' +
    '<p>Browsing WeekAdda needs no account and uses no tracking cookies. Google sign-in (name, email, photo) is required only to publish blog posts, rate posts, or post and respond on the Adda community board. Emails are never shown publicly; on the Adda they are shared mutually, and only between a poster and someone who responds. Data is stored in Supabase and served via Cloudflare; nothing is sold or shared with advertisers. Contact the maintainer via the About page to have your data removed.</p>' +
    NAV +
    '</div>'
  )
}

// ---------------- /blog ----------------

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
