import {
  ReleaseCache,
  CricketCache,
  BlogPost,
  Release,
  OttRelease,
  CricketMatch,
  queryReleases,
  queryCricket,
  queryPlatform,
  OTT_PLATFORMS,
  platformShort,
  findTitle,
  relatedTitles,
  titleUrl,
  titleIsThin,
  reviewUrl,
  relatedReviews,
  articleUrl,
  articleTopicLabel,
  Article,
  ArticleFilm,
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

/**
 * A *timestamp* as its calendar day in India.
 *
 * `day()` above is for release dates, which arrive as bare 'YYYY-MM-DD' and
 * must be read as-is — reading those in IST would shift half of them. A sweep
 * time is a different animal: it is a real instant, and the sweep lands at
 * 22:30 UTC, which is already the next morning in Delhi. Formatted in UTC it
 * reported every sweep as a day older than it was, on a page whose only claim
 * is being current. Same reason aggregateClicks buckets clicks with istDay.
 */
function istDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
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
/**
 * Turn bare http(s) URLs in already-escaped prose into links. Visitor-supplied,
 * so `nofollow ugc` — the page must never lend its ranking to whatever anyone
 * pastes. Must match Prose.tsx on the client, or a crawler and a reader see
 * different pages.
 *
 * Runs on escaped text, never raw: esc() has already neutralised < > " ', so
 * nothing here can open a tag, and an & inside a query string arrives as the
 * &amp; that an href is supposed to carry.
 */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const href = url.replace(/[.,;:!?)\]}]+$/, '')
    const tail = url.slice(href.length)
    // A recognised service is labelled by name: "Netflix" is readable, and a
    // crawler reading anchor text learns something a raw URL never tells it
    const platform = platformFromUrl(href)
    const label = platform ? esc(platform) : href
    return `<a href="${href}" target="_blank" rel="nofollow ugc noopener noreferrer">${label}</a>${tail}`
  })
}

/**
 * The platform a pasted URL belongs to. Matched on the registrable domain, not
 * on "contains", so a URL that merely mentions netflix in a path is not
 * mistaken for one. Mirrors platformFromUrl in frontend/src/filmLinks.ts.
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

function platformFromUrl(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  return URL_PLATFORMS.find(([re]) => re.test(host))?.[1] ?? null
}

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
/**
 * The footer of every pre-rendered block. /articles is in here rather than only
 * on /reviews so a crawler reaches it from any page it happens to land on —
 * principle 5 again, and the list of articles is the one page that keeps older
 * pieces from being orphaned as newer ones push them out of the rail.
 */
const NAV =
  '<p><a href="/movies">Movies &amp; OTT</a> · <a href="/cricket">Cricket</a> · <a href="/reviews">Reviews</a> · <a href="/articles">All articles</a></p>'

/**
 * Links into the per-platform hubs. /movies carries them so the hubs are two
 * clicks from the homepage and reachable by a crawler that never runs JS —
 * a page only the sitemap knows about is an orphan. SEO-PLAN.md, principle 5.
 */
const PLATFORM_NAV =
  '<p>Browse by platform: ' +
  OTT_PLATFORMS.map((p) => `<a href="/ott/${p.slug}">${esc(p.name)}</a>`).join(' · ') +
  '</p>'

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
      // 66 chars before — past where engines truncate, so "| WeekAdda" was
      // being cut off and the brand never appeared in the result
      title: 'Upcoming Movies & OTT Release Dates in India | WeekAdda',
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
      title: 'Movie & Cricket Reviews & Articles by Viewers | WeekAdda',
      description:
        'Honest reviews of this week\u2019s movies, OTT releases and cricket matches — written by the people who watched them, plus articles worth going back to.',
    },
    '/articles': {
      title: 'All Articles — Movies & Cricket Writing | WeekAdda',
      description:
        'Every article on WeekAdda: old films revisited, matches worth remembering, top tens and the arguments behind them — written by viewers, not critics.',
    },
    '/about': {
      title: 'About WeekAdda — Founded by Hemanth Mareedu',
      description:
        'WeekAdda was founded by Hemanth Mareedu, a software engineer and lifelong movie and cricket fan — weekly movie releases, OTT arrivals and cricket in one place.',
    },
    '/adda': {
      title: 'The Adda — Ask, Offer & Find Company | WeekAdda',
      description:
        'A community board for movie and cricket fans in India: spare tickets at face value, company for a show or a match, honest asks. Free to read, sign in to reply.',
    },
    '/privacy': {
      title: 'Privacy Policy | WeekAdda',
      description:
        'What WeekAdda collects, why, and who can see it — in plain language. Browsing needs no account; Google sign-in is used only for posting, rating and the Adda.',
    },
  }
  const hub = platformMeta(pathname)
  if (hub) return hub
  const m = meta[pathname]
  return m ? { title: esc(m.title), description: esc(m.description) } : null
}

/**
 * /ott/<slug> titles, built rather than listed — eight platforms times two
 * strings is a table nobody would keep in step by hand. Phrased as the query:
 * people search "new movies on netflix india", not "netflix hub".
 */
function platformMeta(pathname: string): { title: string; description: string } | null {
  const slug = pathname.startsWith('/ott/') ? pathname.slice(5) : ''
  const platform = OTT_PLATFORMS.find((p) => p.slug === slug)
  if (!platform) return null
  // Built to a budget — ≤60 for the title, 140–160 for the description —
  // measured against the longest platform name, not the shortest.
  //
  // "This Week" stays: it is how the query is actually typed ("new movies on
  // netflix this week"), and it is what has to give way is the "| WeekAdda"
  // suffix, which the breadcrumb now supplies in the result anyway. The page
  // earns the phrase by leading with the last seven days — see the thisWeek
  // section in buildPlatformSeo. A title claiming a week over three months of
  // back catalogue would be the mismatch worth avoiding, not the phrase.
  const name = platformShort(platform)
  return {
    title: esc(`New Movies & Web Series on ${name} India This Week`),
    description: esc(
      `New this week on ${name} in India — the movies and web series that just started streaming, plus everything from recent weeks and what is coming next.`
    ),
  }
}

// ---------------- /movies ----------------

/**
 * Group releases by language in the site's fixed order — Telugu, Tamil,
 * English, Hindi, Malayalam, Kannada — then remaining languages biggest-first.
 * Mirrors LANGUAGE_ORDER in frontend/src/languages.ts — keep the two in step.
 */
const LANGUAGE_ORDER = ['Telugu', 'Tamil', 'English', 'Hindi', 'Malayalam', 'Kannada']

function byLanguage<T extends { languageLabel: string }>(list: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const r of list) {
    const arr = map.get(r.languageLabel) ?? []
    arr.push(r)
    map.set(r.languageLabel, arr)
  }
  const rank = (label: string) => {
    const i = LANGUAGE_ORDER.indexOf(label)
    return i === -1 ? LANGUAGE_ORDER.length : i
  }
  return [...map.entries()].sort(
    (a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length
  )
}

/** Crawlable link to the title's own page. */
function titleLink(r: { id: string; title: string }): string {
  return `<a href="${titleUrl(r)}">${esc(r.title)}</a>`
}

/**
 * Where this page sits, said twice: a visible trail and the matching
 * `BreadcrumbList`.
 *
 * Both, deliberately. Markup that describes a path the reader cannot see is
 * the same mistake as reviews carrying a `reviewRating` nobody was asked for —
 * and the visible trail is doing real work anyway, since it puts a link from
 * every title page back into its platform hub.
 *
 * The last crumb is the current page: named, not linked, which is what Google
 * expects (`item` omitted on the final entry).
 */
function breadcrumb(trail: Array<{ name: string; href?: string }>): string {
  const visible =
    '<p class="wa-crumbs">' +
    trail
      .map((c) => (c.href ? `<a href="${c.href}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`))
      .join(' › ') +
    '</p>'
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: `https://weekadda.com${c.href}` } : {}),
    })),
  })
  return visible + ld
}

/** The hub a title belongs under, when one of its platforms has one. */
function platformCrumb(r: OttRelease): { name: string; href: string } | null {
  for (const name of r.platforms ?? []) {
    const p = OTT_PLATFORMS.find((x) => x.name === name)
    if (p) return { name: p.name, href: `/ott/${p.slug}` }
  }
  return null
}

/**
 * When the *page* was last refreshed — said visibly and in schema.
 *
 * Every other date on a listing page belongs to a film or a match, and with
 * nothing saying otherwise Google dates the page from those: a cricket page
 * swept this morning was showing as "3 days ago" in search results, because
 * the oldest result on it was three days old. For a site whose entire pitch is
 * being current, that snippet is the worst thing it can say.
 *
 * Both halves matter. `dateModified` alone is a claim; a visible `<time>` is
 * the corroboration, and Google is documented as preferring pages where the
 * two agree. Extracted so no listing page can be built without one — /movies
 * had this and cricket did not, which is exactly how the bug survived.
 */
function pageFreshness(fetchedAt: string, name: string): { line: string; ld: string } {
  const updated = /^\d{4}-\d{2}-\d{2}/.test(fetchedAt) ? fetchedAt : ''
  if (!updated) return { line: '', ld: '' }
  // The label is the sweep's IST calendar day; the datetime attribute stays
  // the full instant, which carries its own offset and needs no interpreting
  return {
    line: `<p>Updated <time datetime="${esc(updated)}">${esc(istDayLabel(updated) || day(updated))}</time>, and every morning at 4 AM IST.</p>`,
    ld: jsonLd({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      dateModified: updated,
    }),
  }
}

/** Shared by /movies and the /ott hubs — an empty list emits nothing at all. */
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

  // See pageFreshness: without this Google dates the page from the film dates
  // on it and shows a page swept this morning as days old
  const { line: updatedLine, ld: pageLd } = pageFreshness(
    data.fetchedAt,
    'WeekAdda — OTT & theatre releases this week in India'
  )

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
      updatedLine +
      upcomingTheatreSection +
      upcomingOttSection +
      NAV +
      pageLd +
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
      updatedLine +
      theatreSections +
      upcomingTheatreSection +
      NAV +
      pageLd +
      itemListLd('New movies in theatres this week in India', released) +
      '</div>'
    )
  }

  return (
    WRAP_OPEN +
    '<h1>OTT Releases This Week in India &amp; New Movies in Theatres</h1>' +
    `<p>Updated for the week of ${esc(weekFrom)} – ${esc(weekTo)}: new OTT releases on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5, Sun NXT, Apple TV and Aha, this week's theatre releases in every language, and upcoming OTT &amp; theatre release dates in India.</p>` +
    updatedLine +
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
    PLATFORM_NAV +
    NAV +
    pageLd +
    ld +
    '</div>'
  )
}

/**
 * The page a film keeps once it has aged out of the release cache, built from
 * the reviews alone.
 *
 * Everything factual here comes off the review's own tag — the title, the
 * poster, the language line — because the release row is gone. It is a smaller
 * page than the live one and it says so: no release date, no watch links, no
 * related titles, since none of those are still known. What it does have is the
 * only part that was ever unique to us, which is what people wrote.
 *
 * No reviews and no cache row means the title genuinely does not exist here,
 * and the Worker 404s it as before.
 */
function buildReviewedTitlePage(
  id: string,
  reviews: BlogPost[]
): TitlePage | null {
  const own = reviews.filter((p) => p.tag?.kind === 'movie' && p.tag?.id === id)
  if (own.length === 0) return null
  const tag = own[0].tag!
  const name = tag.label
  const poster = tag.poster ?? undefined
  const excerpt = (body: string) => {
    const flat = body.replace(/\s+/g, ' ').trim()
    return flat.length > 240 ? `${flat.slice(0, 237).replace(/\s+\S*$/, '')}…` : flat
  }
  const count = `${own.length} review${own.length === 1 ? '' : 's'}`

  const block =
    WRAP_OPEN +
    breadcrumb([
      { name: 'WeekAdda', href: '/' },
      { name: 'Movies & OTT', href: '/movies' },
      { name },
    ]) +
    `<h1>${esc(name)} — Reviews from Viewers</h1>` +
    `<p><strong>${count} of ${esc(name)}, written by people who watched it.</strong> ` +
    'This title has left WeekAdda&rsquo;s current release window, so release dates and ' +
    'streaming links are no longer tracked — the reviews stay.</p>' +
    section(
      `${name} review — what viewers said`,
      own
        .slice(0, 20)
        .map(
          (p) =>
            `<strong>${esc(p.title)}</strong> — ${esc(excerpt(p.body))} <em>— ${esc(p.author)}</em>`
        )
    ) +
    '<p><a href="/reviews">More reviews on WeekAdda</a></p>' +
    NAV +
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Movie',
      name,
      ...(poster ? { image: poster } : {}),
      review: own.slice(0, 20).map((p) => ({
        '@type': 'Review',
        name: p.title,
        reviewBody: excerpt(p.body),
        datePublished: p.ts,
        author: { '@type': 'Person', name: p.author },
      })),
    }) +
    '</div>'

  const description = `${count} of ${name} from viewers who actually watched it — what was worth it and what was not, on WeekAdda.`
  return {
    block,
    title: esc(`${name} Review — What Viewers Said | WeekAdda`),
    description: esc(description.slice(0, 160)),
    canonical: `https://weekadda.com${titleUrl({ id, title: name })}`,
    ...(poster ? { image: poster } : {}),
    // Reviews are writing that exists nowhere else — never thin
    indexable: true,
  }
}

// ---------------- /ott/<platform> (per-platform hubs) ----------------

/**
 * One page per streaming service, answering "new movies on netflix india" and
 * "zee5 new release" — queries /movies cannot win because its title says
 * "this week" and names eight platforms at once.
 *
 * Not week-scoped, unlike every other movies block: the question is standing,
 * so the page carries everything the cache holds for that platform, oldest
 * weeks included. Returns null for an unknown slug so the Worker can 404 it.
 */
export function buildPlatformSeo(data: ReleaseCache, slug: string): string | null {
  const result = queryPlatform(data, slug)
  if (!result) return null
  const { platform, streaming, thisWeek, earlier, upcoming } = result
  const name = esc(platform.name)

  // The page's title says "this week", so this is what has to be at the top of
  // it. Everything else the cache holds follows underneath.
  const thisWeekSection = section(
    `New this week on ${platform.name} in India`,
    thisWeek.slice(0, 20).map(ottLine)
  )

  // Then by language, because that is how the rest is really asked for:
  // "telugu movies on aha", "new hindi web series on jiohotstar".
  // Introduced explicitly rather than just appearing: the page says "this
  // week", so the moment it stops being about this week it should say so.
  //
  // A quiet week is normal — ZEE5 had none the day this was written, and it
  // rotates. The title stays put (one URL, one title; a data-dependent title
  // would make the same address say different things on different days), so
  // the *page* is what has to admit it rather than silently sliding into the
  // archive under a heading promising this week.
  const earlierLead = !earlier.length
    ? ''
    : thisWeek.length > 0
      ? `<p>Everything else that landed on ${name} in the last few weeks — ${earlier.length} more, newest first:</p>`
      : `<p>Nothing new arrived on ${name} this week. Here is what landed in the weeks before — ${earlier.length} titles, newest first:</p>`
  const streamingSections = byLanguage(earlier.length ? earlier : streaming)
    .map(([lang, items]) =>
      section(
        `${lang} movies & web series on ${platform.name} in India`,
        items.slice(0, 20).map(ottLine)
      )
    )
    .join('')

  const upcomingSection = section(
    `Coming soon to ${platform.name} in India`,
    upcoming
      .slice(0, 20)
      .map(
        (r) =>
          `${titleLink(r)} (${esc(r.languageLabel)}) — ${platform.name} release date ${day(r.releaseDate)}`
      )
  )

  const fresh = pageFreshness(data.fetchedAt, `New releases on ${platform.name} in India`)

  const empty =
    streaming.length === 0 && upcoming.length === 0
      ? `<p>Nothing from ${name} has been recorded in the last few weeks. New arrivals are added every morning.</p>`
      : ''

  return (
    WRAP_OPEN +
    breadcrumb([
      { name: 'WeekAdda', href: '/' },
      { name: 'Movies & OTT', href: '/movies' },
      { name: platform.name },
    ]) +
    `<h1>New Movies &amp; Web Series on ${name} in India This Week</h1>` +
    `<p>What just started streaming on ${name} in India this week, then everything else that landed recently — newest first, with release dates and languages, plus what is announced for ${name} next. Updated every morning.</p>` +
    fresh.line +
    empty +
    thisWeekSection +
    earlierLead +
    streamingSections +
    upcomingSection +
    platformNav(platform.slug) +
    fresh.ld +
    itemListLd(`New releases on ${platform.name} in India`, streaming) +
    '</div>'
  )
}

/**
 * Every hub links to every other hub, and back to /movies. Crawl depth ≤ 3
 * needs real hrefs, and eight pages that only the sitemap knows about are eight
 * orphans — see SEO-PLAN.md, principle 5.
 */
function platformNav(current: string): string {
  const others = OTT_PLATFORMS.filter((p) => p.slug !== current)
    .map((p) => `<a href="/ott/${p.slug}">${esc(p.name)}</a>`)
    .join(' · ')
  return `<p>${others}</p>` + NAV
}

// ---------------- /movie/:id/:slug (per-title pages) ----------------

/**
 * A dedicated crawlable page per movie/series — the unit Google prefers to
 * rank for "[movie] OTT release date" / "where to watch [movie]" queries.
 */
/**
 * What a title page hands the Worker. `indexable` is false for a page too thin
 * to submit — it still serves, but gets `noindex, follow` and no sitemap entry.
 */
export interface TitlePage {
  block: string
  title: string
  description: string
  canonical: string
  image?: string
  indexable: boolean
}

export function buildTitlePage(
  data: ReleaseCache,
  id: string,
  reviews: BlogPost[] = []
): TitlePage | null {
  const found = findTitle(data, id)
  // A film leaves the 13-week cache; the reviews people wrote about it do not.
  // Without this the page that ranks for "<film> review" 404s a few months
  // after release, taking the reviews and the ranking with it — the one kind
  // of content here that was never going to expire.
  if (!found) return buildReviewedTitlePage(id, reviews)
  const r = found.item as OttRelease
  const lang = r.languageLabel
  const kind = r.contentType === 'series' ? 'web series' : 'movie'
  const platforms = r.platforms?.length ? r.platforms.join(', ') : ''
  const date = day(r.releaseDate)
  // Same half of the site as the title itself — the pre-render must list what
  // the page will actually render, or the markup is unsupported by the page
  const related = relatedTitles(data, r, 8, found.status)

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

  // A film sitting under its platform's hub is both true and useful: it is the
  // only link from a title page back into the hub, which is the page we are
  // trying to build authority for.
  const hubCrumb = platformCrumb(r)
  const block =
    WRAP_OPEN +
    breadcrumb([
      { name: 'WeekAdda', href: '/' },
      { name: 'Movies & OTT', href: '/movies' },
      ...(hubCrumb ? [hubCrumb] : []),
      { name: r.title },
    ]) +
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
    // Serve it either way; a page with no poster and half a sentence of TMDB
    // synopsis is kept out of the index. Reviews of the title lift it out of
    // thin, which is why they are counted here and not just rendered.
    indexable: !titleIsThin(r, ownReviews.length),
  }
}

// ---------------- /sitemap.xml ----------------

/** Sitemap with every current title page; lastmod = last agent sweep. */
export function buildSitemap(
  data: ReleaseCache,
  reviews: BlogPost[] = [],
  articles: Article[] = []
): string {
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
    '/articles',
    '/adda',
    '/about',
    '/privacy',
    // Platform hubs, but only the ones with something on them: a hub listing
    // one film is thin content, and submitting it costs more than it earns
    ...OTT_PLATFORMS.filter((p) => queryPlatform(data, p.slug)?.indexable).map(
      (p) => `/ott/${p.slug}`
    ),
  ].map(
    (p) => `<url><loc>${base}${p}</loc>${mod}<changefreq>daily</changefreq><priority>${p === '/' || p === '/movies' ? '1.0' : '0.8'}</priority></url>`
  )
  const seen = new Set<string>()
  // Which titles somebody has written about — a reviewed page is never thin
  const reviewed = new Set(
    reviews.map((p) => (p.tag?.kind === 'movie' ? p.tag.id : '')).filter(Boolean)
  )
  for (const r of [...data.ott, ...data.ottUpcoming, ...data.releases] as Release[]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    // A poster-less title with half a sentence of TMDB synopsis is a
    // near-duplicate of the same film on a hundred stronger domains. It still
    // serves; submitting a thousand of them is what makes a domain look
    // derivative. Same gate the Worker applies as `noindex, follow`.
    if (titleIsThin(r, reviewed.has(r.id) ? 1 : 0)) continue
    urls.push(`<url><loc>${base}${titleUrl(r)}</loc>${mod}</url>`)
  }
  // Titles that have left the release window but still have reviews keep a
  // page (see buildReviewedTitlePage), so they keep a sitemap entry — dropping
  // the URL is how an indexed page quietly becomes an orphan.
  for (const p of reviews) {
    const tag = p.tag
    if (!tag || tag.kind !== 'movie' || !tag.id || seen.has(tag.id)) continue
    seen.add(tag.id)
    urls.push(`<url><loc>${base}${titleUrl({ id: tag.id, title: tag.label })}</loc>${mod}</url>`)
  }
  // Every review also has a page of its own (buildReviewPage). Its lastmod is
  // the review's own timestamp, not the sweep's — a take written weeks ago did
  // not change because the release cache refreshed this morning.
  for (const p of reviews) {
    const written = /^\d{4}-\d{2}-\d{2}/.test(p.ts) ? `<lastmod>${p.ts.slice(0, 10)}</lastmod>` : ''
    urls.push(`<url><loc>${base}${reviewUrl(p)}</loc>${written}</url>`)
  }
  // Articles age far better than anything else here — nothing on one expires
  // when the release window moves — so they are listed on the same terms.
  for (const a of articles) {
    const written = /^\d{4}-\d{2}-\d{2}/.test(a.ts) ? `<lastmod>${a.ts.slice(0, 10)}</lastmod>` : ''
    urls.push(`<url><loc>${base}${articleUrl(a)}</loc>${written}</url>`)
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
      // No superEvent. Naming the series as a nested SportsEvent looked like
      // better data, but Google parses nested events as items in their own
      // right — and a series has no single start time or venue to give one, so
      // each fixture silently shipped a second, invalid Event alongside it.
      // Ten valid fixtures were reported as "20 items, some invalid".
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
    // Results are the worst case for this: every date on the page is in the
    // past, so with nothing else to go on Google dates the page from them
    const fresh = pageFreshness(data.fetchedAt, 'WeekAdda — cricket results')
    return (
      WRAP_OPEN +
      '<h1>Cricket Results This Week — Scores &amp; Winners</h1>' +
      '<p>Completed cricket match results in the last few weeks — internationals and leagues, with the winner, the series and the date. India results first. Updated every morning.</p>' +
      fresh.line +
      section('India cricket results', indiaResults.map((m) => {
        const winner = m.teams.find((t) => t.winner)
        return `${esc(m.name)} — ${esc(winner ? `${winner.name} won` : m.statusDetail || 'Completed')} (${esc(m.series)}, ${day(m.date)})`
      })) +
      resultsSection +
      NAV +
      fresh.ld +
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

  const fresh = pageFreshness(data.fetchedAt, 'WeekAdda — cricket fixtures and results')

  return (
    WRAP_OPEN +
    `<h1>${h1}</h1>` +
    `<p>${lead}Upcoming fixtures with date, time (IST) and venue for every international series, today's and tomorrow's matches, and this week's completed results — updated daily.</p>` +
    fresh.line +
    section('India cricket match today', indiaToday.map((m) => fixtureLine(m))) +
    section('India cricket match tomorrow', indiaTomorrow.map((m) => fixtureLine(m))) +
    indiaSeriesSections(indiaUpcoming) +
    resultsSection +
    section('Other upcoming international matches', others.map((m) => fixtureLine(m))) +
    NAV +
    fresh.ld +
    ld +
    '</div>'
  )
}

// ---------------- /about ----------------

export function buildAboutSeo(): string {
  return (
    WRAP_OPEN +
    '<h1>About WeekAdda — This Week in Movies, OTT &amp; Cricket</h1>' +
    '<p>WeekAdda — live since July 2026 — puts the week’s entertainment in one clean place, free, no account needed, refreshed automatically every morning:</p>' +
    '<ul>' +
    '<li>New movie releases in Telugu, Hindi, Tamil, Malayalam, Kannada, English and 12+ languages, browsable week by week</li>' +
    '<li>Daily OTT arrivals on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5, Sun NXT, Apple TV and Aha, plus upcoming theatre and OTT release dates</li>' +
    '<li>Cricket fixtures with date, time and venue for every international series, and results week by week</li>' +
    '<li>Reviews from people who actually watched, rated out of five and tagged to the film or match they are about</li>' +
    '<li>The Adda — a community board to ask, offer and find company: spare tickets at face value, someone to watch a movie or match with, honest asks between fellow fans</li>' +
    '</ul>' +
    // Phrased as the question, because that is what gets lifted into an
    // answer: "who is the founder of WeekAdda" wants a sentence saying so, not
    // a heading called Founder above a biography that never uses the word.
    '<h2>Who is the founder of WeekAdda?</h2>' +
    '<p><strong>WeekAdda was founded by Hemanth Mareedu</strong>, a software engineer with 10+ years of experience and a lifelong movie and cricket fan who loves building things that are genuinely helpful to people. He built and runs WeekAdda single-handedly. Connect with Hemanth Mareedu on <a href="https://www.linkedin.com/in/hemanth-mareedu-a69271116/" rel="me">LinkedIn</a>.</p>' +
    NAV +
    // ProfilePage is Google's type for a page about one person, and the @id is
    // the same node the site-wide Organization names as its founder — so the
    // photo and detail here strengthen that entity instead of forming a rival
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        '@id': 'https://weekadda.com/about#hemanth-mareedu',
        name: 'Hemanth Mareedu',
        url: 'https://weekadda.com/about',
        image: 'https://weekadda.com/founder.jpg',
        jobTitle: 'Software Engineer',
        description:
          'Founder of WeekAdda — a software engineer with 10+ years of experience and a lifelong movie and cricket fan.',
        sameAs: ['https://www.linkedin.com/in/hemanth-mareedu-a69271116/'],
        knowsAbout: ['Movies', 'OTT platforms', 'Cricket'],
        worksFor: { '@id': 'https://weekadda.com/#organization' },
      },
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
    '<p>Browsing WeekAdda needs no account and uses no tracking cookies. Google sign-in (name, email, photo) is required only to publish a review, rate one, or post and respond on the Adda community board. Emails are never shown publicly; on the Adda they are shared mutually, and only between a poster and someone who responds. Release notifications are anonymous: no account and no email are stored, only the browser&rsquo;s own delivery address, your chosen languages and timezone, and they stop the moment you turn the bell off. Data is stored in Supabase and served via Cloudflare; nothing is sold or shared with advertisers. Contact the maintainer via the About page to have your data removed.</p>' +
    NAV +
    '</div>'
  )
}

// ---------------- /reviews ----------------

/**
 * /articles — every article, listed.
 *
 * The rail on /reviews links only the newest twenty, so before this page an
 * older article's only inbound link disappeared as soon as twenty newer ones
 * existed. This is the durable one: every article is linked here, so none of
 * them can become an orphan by ageing.
 */
export function buildAllArticlesSeo(articles: Article[]): string {
  // Summary-page ItemList: `position` + `url` and nothing else, which is the
  // shape Google documents for a list that points at full pages. Nesting a
  // partial Article in each item would ship a second, thinner copy of every
  // piece — the same mistake `superEvent` made on the cricket fixtures, where
  // ten events were read as twenty items. The article's own page carries the
  // real Article markup; this only says which pages the list points at.
  const ld =
    articles.length === 0
      ? ''
      : jsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'WeekAdda articles',
          itemListElement: articles.slice(0, 100).map((a, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `https://weekadda.com${articleUrl(a)}`,
          })),
        })
  return (
    WRAP_OPEN +
    ld +
    '<h1>All Articles — Movies &amp; Cricket</h1>' +
    '<p>Writing that is not tied to a release date: old films revisited, matches worth remembering, top tens and the arguments behind them — by the people who watched them.</p>' +
    (articles.length > 0
      ? section(
          `${articles.length} article${articles.length === 1 ? '' : 's'}`,
          articles.map(
            (a) =>
              `<a href="${articleUrl(a)}">${esc(a.title)}</a> — ${esc(
                articleTopicLabel(a.topic)
              )}, by ${esc(a.author)}`
          )
        )
      : '<p>No articles published yet.</p>') +
    NAV +
    '</div>'
  )
}

export function buildBlogSeo(posts: BlogPost[], articles: Article[] = []): string {
  return (
    WRAP_OPEN +
    '<h1>Movie &amp; Cricket Reviews by Real Viewers</h1>' +
    '<p>What people who actually watched thought of this week’s films, OTT releases and cricket matches — each review tagged to the title or match it is about, and rated out of five.</p>' +
    section(
      'Latest reviews',
      posts
        .slice(0, 20)
        .map((p) => `${esc(p.title)} — a review of ${esc(p.tag.label)}, by ${esc(p.author)}`)
    ) +
    // The panel beside the feed, and the only crawlable way into the articles:
    // without these links every article page is an orphan.
    (articles.length > 0
      ? section(
          'Articles',
          articles
            .slice(0, 20)
            .map(
              (a) =>
                `<a href="${articleUrl(a)}">${esc(a.title)}</a> — ${esc(
                  articleTopicLabel(a.topic)
                )}, by ${esc(a.author)}`
            )
        )
      : '') +
    NAV +
    '</div>'
  )
}

// ---------------- /article/:id/:slug ----------------

/**
 * Mirror of `watchUrl` in frontend/src/watchLinks.ts — keep the two in step.
 * Every link is a *search* on the platform, which is what makes this work for
 * the old films articles are usually about: it needs the title and nothing else.
 */
function watchSearch(platform: string, title: string): string {
  const q = encodeURIComponent(title)
  const firstResult = (query: string) =>
    `https://duckduckgo.com/?q=${encodeURIComponent('\\' + query)}`
  switch (platform) {
    case 'Netflix':
      return `https://www.netflix.com/search?q=${q}`
    case 'Amazon Prime Video':
      return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`
    case 'ZEE5':
      return `https://www.zee5.com/search?q=${q}`
    case 'JioHotstar':
      return firstResult(`${title} site:jiohotstar.com`)
    case 'Sony LIV':
      return firstResult(`${title} site:sonyliv.com`)
    case 'Aha':
      return firstResult(`${title} site:aha.video`)
    case 'ETV Win':
      return firstResult(`${title} site:etvwin.com`)
    default:
      return firstResult(`watch ${title} on ${platform}`)
  }
}

/** The exact title page when the writer had one, a search otherwise. */
function watchHref(w: { name: string; url?: string }, title: string): string {
  return w.url ?? watchSearch(w.name, title)
}

/** The where-to-watch block on a movie article, as crawlable HTML. */
function watchSection(films: ArticleFilm[]): string {
  if (films.length === 0) return ''
  return section(
    'Where to watch',
    films.map((f) => {
      const name = f.id
        ? `<a href="${titleUrl({ id: f.id, title: f.title })}">${esc(f.title)}</a>`
        : `<strong>${esc(f.title)}</strong>`
      if (f.platforms.length === 0) return name
      const links = f.platforms
        .map(
          (p) =>
            `<a href="${esc(watchHref(p, f.title))}" rel="nofollow noopener noreferrer">${esc(p.name)}</a>`
        )
        .join(', ')
      return `${name} — watch on ${links}`
    })
  )
}

/**
 * Link each film named in the prose, right where it is named. A top-ten list
 * reads as ten titles, and the useful place for "watch it here" is beside the
 * title being talked about — not only in a block underneath.
 *
 * First mention only, one film per match, and only on a word boundary, so the
 * film "83" is not found inside "1983". Runs on escaped text like linkify.
 */
function markFilmsEscaped(escaped: string, films: ArticleFilm[], used: Set<string>): string {
  let out = escaped
  for (const f of films) {
    if (used.has(f.title) || f.platforms.length === 0) continue
    const needle = esc(f.title)
    const at = out.toLowerCase().indexOf(needle.toLowerCase())
    if (at < 0) continue
    const before = out[at - 1]
    const after = out[at + needle.length]
    if ((before && /[A-Za-z0-9]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) continue
    used.add(f.title)
    const icons = f.platforms
      .map(
        (p) =>
          `<a href="${esc(watchHref(p, f.title))}" rel="nofollow noopener noreferrer" title="Watch ${esc(
            f.title
          )} on ${esc(p.name)}">${esc(p.name)}</a>`
      )
      .join(' ')
    out = `${out.slice(0, at + needle.length)} (${icons})${out.slice(at + needle.length)}`
  }
  return out
}

/**
 * An article and the rail of related ones beside it. Unlike a review, nothing
 * here is pinned to a release — so there is no date to go stale, and the page
 * is written to still make sense in a year.
 *
 * `Article` schema, not `Review`: there is nothing being reviewed and no
 * rating, and claiming otherwise is the kind of markup that earns a manual
 * action rather than a rich result.
 */
export function buildArticlePage(
  article: Article,
  related: Article[] = []
): {
  block: string
  title: string
  description: string
  canonical: string
  image?: string
} | null {
  if (!article) return null
  const topic = articleTopicLabel(article.topic)
  const flat = article.body.replace(/\s+/g, ' ').trim()
  const excerpt = flat.length > 240 ? `${flat.slice(0, 237).replace(/\s+\S*$/, '')}…` : flat

  const block =
    WRAP_OPEN +
    breadcrumb([
      { name: 'WeekAdda', href: '/' },
      { name: 'Reviews', href: '/reviews' },
      { name: article.title },
    ]) +
    `<h1>${esc(article.title)}</h1>` +
    // The cover is on the page for readers, so it is in the block too — a
    // crawler must not be shown a version of the page that is missing it
    (article.image ? `<p><img src="${esc(article.image)}" alt="${esc(article.title)}"></p>` : '') +
    `<p><strong>${esc(topic)}</strong> — ${
      article.official ? 'published by WeekAdda' : `by ${esc(article.author)}`
    }, ${day(article.ts)}.</p>` +
    ((): string => {
      const films = article.films ?? []
      const named = new Set<string>()
      const paragraphs = article.body
        .split(/\n+/)
        .filter((p) => p.trim())
        .map((p) => `<p>${markFilmsEscaped(linkify(esc(p.trim())), films, named)}</p>`)
        .join('')
      // Only what the prose never mentioned needs a block of its own
      return paragraphs + watchSection(films.filter((f) => !named.has(f.title)))
    })() +
    (related.length > 0
      ? section(
          'More articles',
          related
            .slice(0, 12)
            .map(
              (a) =>
                `<a href="${articleUrl(a)}">${esc(a.title)}</a> — ${esc(articleTopicLabel(a.topic))}`
            )
        )
      : '') +
    '<p><a href="/reviews">Reviews and articles on WeekAdda</a></p>' +
    NAV +
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      articleBody: flat,
      // The cover, when it is an absolute URL — a stored upload path means
      // nothing to a crawler fetching from another host. Google reads image
      // for the Article rich result, and it is on the page either way.
      ...(article.image?.startsWith('https://') ? { image: article.image } : {}),
      datePublished: article.ts,
      // A site-published piece is authored by the site, not by a person —
      // Organization is what that actually is, and the flag is server-set
      author: article.official
        ? { '@type': 'Organization', name: 'WeekAdda', url: 'https://weekadda.com' }
        : { '@type': 'Person', name: article.author },
    }) +
    '</div>'

  const heading =
    article.title.length > 60
      ? `${article.title.slice(0, 57).replace(/\s+\S*$/, '')}…`
      : article.title
  return {
    block,
    title: esc(`${heading} | WeekAdda`),
    description: esc(`${article.author} on ${topic}: ${excerpt}`.slice(0, 160)),
    canonical: `https://weekadda.com${articleUrl(article)}`,
    // A relative upload path is meaningless to a share card, which is fetched
    // by another server — only an absolute URL is worth advertising
    ...(article.image?.startsWith('https://') ? { image: article.image } : {}),
  }
}

// ---------------- /review/:id/:slug (one review's own page) ----------------

/**
 * A single review, full text, on its own URL. The feed at /reviews can only
 * ever show an opening — this is the page that answers "<film> review" with
 * the whole take, and the one a shared link should land on.
 *
 * No `reviewRating` in the markup, for the same reason the title pages carry
 * none: the five stars measure how useful readers found the *review*, not the
 * writer's verdict on the film, and mapping one to the other would be a lie in
 * structured data. Match reviews get no JSON-LD at all rather than an invented
 * itemReviewed type — see the schema note in CLAUDE.md.
 */
export function buildReviewPage(
  posts: BlogPost[],
  id: string
): { block: string; title: string; description: string; canonical: string; image?: string } | null {
  const post = posts.find((p) => p.id === id)
  if (!post) return null
  const tag = post.tag
  const label = tag?.label ?? ''
  const poster = tag?.poster ?? undefined
  const flat = post.body.replace(/\s+/g, ' ').trim()
  const excerpt = flat.length > 240 ? `${flat.slice(0, 237).replace(/\s+\S*$/, '')}…` : flat
  const movieId = tag?.kind === 'movie' && tag.id ? tag.id : null

  const block =
    WRAP_OPEN +
    breadcrumb([
      { name: 'WeekAdda', href: '/' },
      { name: 'Reviews', href: '/reviews' },
      ...(movieId ? [{ name: label, href: titleUrl({ id: movieId, title: label }) }] : []),
      { name: post.title },
    ]) +
    `<h1>${esc(post.title)}</h1>` +
    `<p><strong>A review of ${esc(label)}</strong>, written by ${esc(post.author)} on ${day(post.ts)}.</p>` +
    post.body
      .split(/\n+/)
      .filter((p) => p.trim())
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join('') +
    (movieId
      ? `<p><a href="${titleUrl({ id: movieId, title: label })}">Everything about ${esc(label)} — release date, where to watch</a></p>`
      : '') +
    // The row of related takes is on the page for readers, so it is in the
    // block too — and those links are the only crawlable path between reviews
    ((): string => {
      const more = relatedReviews(posts, post.id)
      return more.length > 0
        ? section(
            'More reviews',
            more.map(
              (p) =>
                `<a href="${reviewUrl(p)}">${esc(p.title)}</a> — ${esc(
                  p.tag?.label ?? ''
                )}, by ${esc(p.author)}`
            )
          )
        : ''
    })() +
    '<p><a href="/reviews">More reviews on WeekAdda</a></p>' +
    NAV +
    (movieId
      ? jsonLd({
          '@context': 'https://schema.org',
          '@type': 'Review',
          name: post.title,
          reviewBody: flat,
          datePublished: post.ts,
          author: { '@type': 'Person', name: post.author },
          itemReviewed: {
            '@type': 'Movie',
            name: label,
            ...(poster ? { image: poster } : {}),
          },
        })
      : '') +
    '</div>'

  const heading =
    post.title.length > 60 ? `${post.title.slice(0, 57).replace(/\s+\S*$/, '')}…` : post.title
  return {
    block,
    title: esc(`${heading} — ${label} Review | WeekAdda`),
    description: esc(`${post.author} on ${label}: ${excerpt}`.slice(0, 160)),
    canonical: `https://weekadda.com${reviewUrl(post)}`,
    ...(poster ? { image: poster } : {}),
  }
}
