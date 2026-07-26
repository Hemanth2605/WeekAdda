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
  '<div id="wa-prerender" style="max-width:900px;margin:0 auto;padding:40px 24px;line-height:1.7">'

/**
 * What a human sees while the JS bundle boots.
 *
 * The pre-rendered block below is written for crawlers — headings and lists,
 * no app styling — so on a slower phone it flashes as a bare text document for
 * the few hundred milliseconds before React mounts and clears it. This skeleton
 * is injected ahead of it and the inline script hides the text, so a browser
 * shows shimmer instead. The classes are the app's own (.sk, index.css), which
 * is already loaded by then, so it matches the loading state React renders a
 * moment later.
 *
 * SEO is unaffected: React deletes the block on mount either way, so a
 * rendering crawler never saw it, and a crawler that does not execute JS never
 * runs the hiding script and gets the full copy.
 */
export const SKELETON =
  '<div id="wa-skeleton" aria-hidden="true">' +
  '<div class="wa-sk-nav"></div>' +
  '<div class="wa-sk-pad"><div class="sk sk-line wa-sk-eyebrow"></div>' +
  '<div class="sk sk-line wa-sk-title"></div></div>' +
  '<div class="wa-sk-pad wa-sk-tabs">' +
  '<div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line"></div></div>' +
  [0, 1]
    .map(
      () =>
        '<div class="wa-sk-pad"><div class="sk sk-line wa-sk-heading"></div>' +
        '<div class="wa-sk-row">' +
        '<div class="sk sk-poster"></div>'.repeat(6) +
        '</div></div>'
    )
    .join('') +
  '</div>' +
  // Runs during parse, so the crawler copy is never painted for a human
  '<script>var e=document.getElementById("wa-prerender");if(e)e.style.display="none"</script>'
const NAV =
  '<p><a href="/movies">Movies &amp; OTT</a> · <a href="/cricket">Cricket</a> · <a href="/reviews">Reviews</a></p>'

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
        'New OTT releases this week in India — movies & web series on Netflix, Prime Video, JioHotstar, ZEE5, Sun NXT & Aha, plus theatre and upcoming release dates.',
    },
    '/movies/upcoming': {
      title: 'Upcoming Movies & OTT Releases in India — Release Dates | WeekAdda',
      description:
        'Upcoming movie release dates in India — theatre releases and upcoming OTT releases & web series, with the streaming platform where confirmed. Updated daily.',
    },
    '/movies/theatres': {
      title: 'New Movies in Theatres This Week India | WeekAdda',
      description:
        'Movies released in cinemas across India this week — Telugu, Hindi, Tamil, Malayalam, Kannada and English — plus the theatre release dates coming next.',
    },
    '/cricket/results': {
      title: 'Cricket Results This Week — All Series & Leagues | WeekAdda',
      description:
        'Completed cricket match results week by week — internationals and leagues, with scores, venue and series, India first. Updated every morning.',
    },
    '/reviews': {
      title: 'Movie & Cricket Reviews by Real Viewers | WeekAdda',
      description:
        'Honest reviews of this week\u2019s movies, OTT releases and cricket matches — written and rated out of five by the people who actually watched them.',
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

/**
 * Which of the three /movies URLs is being rendered. They share a data source
 * but must not share a block: three pages with identical content is duplication,
 * and Google would pick one and drop the others. Each focus leads with the
 * content its own URL is about. See SEO-PLAN.md.
 */
export type MoviesFocus = 'all' | 'theatres' | 'upcoming'

export function buildMoviesSeo(data: ReleaseCache, focus: MoviesFocus = 'all'): string {
  const extras = { syncing: false, liveConfigured: data.source === 'tmdb' }
  const released = queryReleases(data, { window: 'released' }, extras).releases
  // The ott window serves OttRelease entries, which carry platforms
  const ott = queryReleases(data, { window: 'ott' }, extras).releases as OttRelease[]
  // The dedicated upcoming page is the whole point of that URL, so it lists more
  const upcomingLimit = focus === 'upcoming' ? 30 : 15
  const upcoming = queryReleases(data, { window: 'upcoming' }, extras).releases.slice(
    0,
    upcomingLimit
  )
  const upcomingOtt = queryReleases(
    data,
    { window: 'upcoming', source: 'ott' },
    extras
  ).releases.slice(0, upcomingLimit) as OttRelease[]

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

  const itemListLd = (name: string, items: Array<Release | OttRelease>) =>
    items.length === 0
      ? ''
      : jsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name,
          itemListElement: items.slice(0, 20).map((r, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': (r as OttRelease).contentType === 'series' ? 'TVSeries' : 'Movie',
              name: r.title,
              ...(r.poster ? { image: r.poster } : {}),
              datePublished: r.releaseDate,
              inLanguage: r.language,
            },
          })),
        })
  const ld = itemListLd('New OTT releases this week in India', ott)

  const upcomingTheatreSection = section(
    'Upcoming movie release dates in theatres',
    upcoming.map(
      (r) => `${titleLink(r)} (${esc(r.languageLabel)}) releases in theatres on ${day(r.releaseDate)}`
    )
  )
  const upcomingOttSection = section(
    'Upcoming OTT release dates in India',
    upcomingOtt.map(
      (r) =>
        `${titleLink(r)} (${esc(r.languageLabel)}) — OTT release date ${day(r.releaseDate)}${r.platforms?.length ? ` on ${esc(r.platforms.join(', '))}` : ''}`
    )
  )

  // /movies/upcoming — release dates, nothing about this week
  if (focus === 'upcoming') {
    return (
      WRAP_OPEN +
      '<h1>Upcoming Movies &amp; OTT Releases in India — Release Dates</h1>' +
      '<p>Announced release dates for upcoming movies in theatres and upcoming OTT releases and web series in India, across Telugu, Hindi, Tamil, Malayalam, Kannada and English — with the streaming platform wherever it has been confirmed. Updated every morning.</p>' +
      upcomingTheatreSection +
      upcomingOttSection +
      NAV +
      itemListLd('Upcoming OTT releases in India', upcomingOtt) +
      '</div>'
    )
  }

  // /movies/theatres — what is playing now, and what opens next
  if (focus === 'theatres') {
    return (
      WRAP_OPEN +
      '<h1>New Movies in Theatres This Week in India</h1>' +
      `<p>Movies released in cinemas across India for the week of ${esc(weekFrom)} – ${esc(weekTo)}, by language — Telugu, Hindi, Tamil, Malayalam, Kannada and English — plus the theatre release dates coming next.</p>` +
      theatreSections +
      upcomingTheatreSection +
      NAV +
      itemListLd('New movies in theatres this week in India', released) +
      '</div>'
    )
  }

  return (
    WRAP_OPEN +
    '<h1>OTT Releases This Week in India &amp; New Movies in Theatres</h1>' +
    `<p>Updated for the week of ${esc(weekFrom)} – ${esc(weekTo)}: new OTT releases on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5, Sun NXT, Apple TV and Aha, this week's theatre releases in every language, and upcoming OTT &amp; theatre release dates in India.</p>` +
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
    upcomingTheatreSection +
    upcomingOttSection +
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
  id: string,
  reviews: BlogPost[] = []
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

  // Reviews of *this* title. "Oh Sukumari review" is a query WeekAdda can
  // realistically win — the head term belongs to IMDb — and the page that
  // should answer it is the one already indexed for the film, not the reviews
  // hub. Body text is trimmed: enough to be a real excerpt, not the whole
  // review, which still lives on /reviews.
  const ownReviews = reviews.filter((p) => p.tag?.kind === 'movie' && p.tag?.id === r.id)
  const excerpt = (body: string) => {
    const flat = body.replace(/\s+/g, ' ').trim()
    return flat.length > 240 ? `${flat.slice(0, 237).replace(/\s+\S*$/, '')}…` : flat
  }

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
    // Deliberately no reviewRating on these. The five stars on a WeekAdda
    // review measure how useful readers found the *review*, not what the writer
    // thought of the film — claiming otherwise would be inaccurate markup, and
    // Google treats that harshly. Star snippets would need the composer to ask
    // for a verdict out of five, which it does not.
    ...(ownReviews.length > 0
      ? {
          review: ownReviews.slice(0, 10).map((p) => ({
            '@type': 'Review',
            name: p.title,
            reviewBody: excerpt(p.body),
            datePublished: p.ts,
            author: { '@type': 'Person', name: p.author },
          })),
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
      `${r.title} review — what viewers said`,
      ownReviews
        .slice(0, 10)
        .map(
          (p) =>
            `<strong>${esc(p.title)}</strong> — ${esc(excerpt(p.body))} <em>— ${esc(p.author)}</em>`
        )
    ) +
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
  // A title someone has reviewed leads with the word they searched for
  const metaTitle = ownReviews.length
    ? `${shortName} ${lang} ${kind === 'web series' ? 'Web Series' : 'Movie'} Review & Release Date | WeekAdda`
    : `${shortName} ${lang} ${
        found.status === 'in-theatres' || found.status === 'upcoming-theatre'
          ? 'Movie Release Date'
          : 'OTT Release Date & Platform'
      } | WeekAdda`
  // ≤160 chars, cut at a word boundary, so engines show this text verbatim
  const reviewNote = ownReviews.length
    ? ` ${ownReviews.length} review${ownReviews.length === 1 ? '' : 's'} from viewers who watched it.`
    : ''
  const full = `${answer}${reviewNote}${r.overview ? ` ${r.overview}` : ''}`
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
  const urls = [
    '/',
    '/movies',
    '/movies/theatres',
    '/movies/upcoming',
    '/cricket',
    '/cricket/results',
    '/reviews',
    '/adda',
    '/about',
    '/privacy',
  ].map(
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

/**
 * Which of the two cricket URLs is being rendered — same reasoning as
 * MoviesFocus: /cricket and /cricket/results must not serve the same block, or
 * Google picks one and drops the other. See SEO-PLAN.md.
 */
export type CricketFocus = 'fixtures' | 'results'

export function buildCricketSeo(data: CricketCache, focus: CricketFocus = 'fixtures'): string {
  // The results page is about completed matches, so it lists several weeks
  const resultWeeks = focus === 'results' ? [0, 1, 2] : [0]
  const results = resultWeeks
    .flatMap((week) => queryCricket(data, { window: 'recent', week }, { syncing: false }).matches)
    .slice(0, focus === 'results' ? 40 : 20)
  const upcoming = queryCricket(data, { window: 'upcoming' }, { syncing: false }).matches

  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  // Headed the way people actually search: "India match today", "India match
  // tomorrow", then each India series as "India vs X — next match & schedule"
  const indiaUpcoming = upcoming.filter(india)
  const indiaToday = indiaUpcoming.filter((m) => m.date.slice(0, 10) === today)
  const indiaTomorrow = indiaUpcoming.filter((m) => m.date.slice(0, 10) === tomorrow)
  const others = upcoming.filter((m) => !india(m)).slice(0, 15)

  /**
   * Fills in the Event fields Search Console asks for — but only the ones we
   * genuinely know.
   *
   * `organizer` and `offers` stay absent on purpose. We do not know which board
   * runs a fixture, and we neither sell tickets nor hold a ticket URL; inventing
   * either would be a lie told in machine-readable form, and `offers` in
   * particular asserts that something is purchasable here. Two non-critical
   * warnings are a far better outcome than markup that misleads.
   *
   * ESPN venues arrive as "Ground Name" or "Ground Name, City", so a city is
   * only claimed when the string actually carries one.
   */
  const eventLd = (m: CricketMatch) => {
    const [ground, city] = m.venue.split(',').map((s) => s.trim())
    const logos = m.teams.map((t) => t.logo).filter((l): l is string => Boolean(l))
    return {
      '@type': 'SportsEvent',
      name: m.name,
      sport: 'Cricket',
      startDate: m.date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      ...(m.series ? { superEvent: { '@type': 'SportsEvent', name: m.series } } : {}),
      ...(logos.length ? { image: logos } : {}),
      ...(m.venue
        ? {
            location: {
              '@type': 'Place',
              name: ground,
              ...(city ? { address: { '@type': 'PostalAddress', addressLocality: city } } : {}),
            },
          }
        : {}),
      // competitor only. `performer` was added to answer Search Console's
      // "missing performer" warning and made every event *invalid*: Google
      // accepts only Person or PerformingGroup there, and a SportsTeam is
      // neither. A warning on a valid item beats a silenced warning on an
      // invalid one.
      competitor: m.teams.map((t) => ({ '@type': 'SportsTeam', name: t.name })),
    }
  }

  // Only fixtures we can describe validly. Google requires a physical Event to
  // carry location.address, and ESPN venues do not all name a city — "Harare
  // Sports Club" gives nothing to put there. Nine valid events beat nine valid
  // ones plus a tenth that is permanently ineligible and permanently reported.
  const markupReady = indiaUpcoming.filter((m) => m.venue.includes(','))
  const ld =
    markupReady.length === 0
      ? ''
      : jsonLd({
          '@context': 'https://schema.org',
          '@graph': markupReady.slice(0, 10).map(eventLd),
        })

  const resultsSection = section(
    focus === 'results' ? 'Cricket results — completed matches' : 'Cricket results this week',
    results.map((m) => {
      const winner = m.teams.find((t) => t.winner)
      const line = winner ? `${winner.name} won` : m.statusDetail || 'Completed'
      return `${esc(m.name)} — ${esc(line)} (${esc(m.series)}, ${day(m.date)})`
    })
  )

  // /cricket/results — who won, not who plays next
  if (focus === 'results') {
    const indiaResults = results.filter(india)
    return (
      WRAP_OPEN +
      '<h1>Cricket Results This Week — Scores &amp; Winners</h1>' +
      '<p>Completed cricket match results in the last few weeks — internationals and leagues, with the winner, the series and the date. India results first. Updated every morning.</p>' +
      section('India cricket results', indiaResults.map((m) => {
        const winner = m.teams.find((t) => t.winner)
        return `${esc(m.name)} — ${esc(winner ? `${winner.name} won` : m.statusDetail || 'Completed')} (${esc(m.series)}, ${day(m.date)})`
      })) +
      resultsSection +
      NAV +
      '</div>'
    )
  }

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
    resultsSection +
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
    '<li>Daily OTT arrivals on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5, Sun NXT, Apple TV and Aha, plus upcoming theatre and OTT release dates</li>' +
    '<li>Cricket fixtures with date, time and venue for every international series, and results week by week</li>' +
    '<li>Reviews from people who actually watched, rated out of five and tagged to the film or match they are about</li>' +
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
    '<p>Browsing WeekAdda needs no account and uses no tracking cookies. Google sign-in (name, email, photo) is required only to publish a review, rate one, or post and respond on the Adda community board. Emails are never shown publicly; on the Adda they are shared mutually, and only between a poster and someone who responds. Data is stored in Supabase and served via Cloudflare; nothing is sold or shared with advertisers. Contact the maintainer via the About page to have your data removed.</p>' +
    NAV +
    '</div>'
  )
}

// ---------------- /reviews ----------------

export function buildBlogSeo(posts: BlogPost[]): string {
  return (
    WRAP_OPEN +
    '<h1>Movie &amp; Cricket Reviews by Real Viewers</h1>' +
    '<p>What people who actually watched thought of this week&#39;s films, OTT releases and cricket matches — each review tagged to the title or match it is about, and rated out of five.</p>' +
    section(
      'Latest reviews',
      posts
        .slice(0, 20)
        .map((p) => `${esc(p.title)} — a review of ${esc(p.tag.label)}, by ${esc(p.author)}`)
    ) +
    NAV +
    '</div>'
  )
}
