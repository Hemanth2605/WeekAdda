import { describe, it, expect } from 'vitest'
import {
  buildPlatformSeo,
  buildMoviesSeo,
  buildTitlePage,
  buildReviewPage,
  buildArticlePage,
  buildBlogSeo,
  buildSitemap,
  buildAboutSeo,
  buildCricketSeo,
  routeMeta,
} from './seo'
import {
  OTT_PLATFORMS,
  type Article,
  type BlogPost,
  type ReleaseCache,
  type OttRelease,
  type Release,
} from './queries'

/**
 * The pre-render is a string, which is exactly why it needs tests: every bug it
 * has had was invisible in review and expensive in production — schema landing
 * where React would delete it, a `ListItem` that was not a ListItem, a page
 * shipped with no crawlable link on it.
 *
 * These assert the *contracts*, not the prose. Wording is meant to change with
 * how people search; a test that pins a sentence would only ever be deleted.
 */

const iso = (daysFromToday: number) =>
  new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10)

const release = (over: Partial<Release> & { id: string }): Release => ({
  title: over.id,
  originalTitle: over.id,
  language: 'te',
  languageLabel: 'Telugu',
  releaseDate: iso(-1),
  overview: 'An overview.',
  poster: null,
  rating: 0,
  votes: 0,
  ...over,
})

const ott = (over: Partial<OttRelease> & { id: string }): OttRelease => ({
  ...release(over),
  platforms: ['Netflix'],
  week: 0,
  contentType: 'movie',
  ...over,
})

const data: ReleaseCache = {
  fetchedAt: new Date().toISOString(),
  source: 'tmdb',
  releases: [release({ id: 'theatre-1', title: 'A Theatre Film' })],
  ott: [
    ott({ id: 'n1', title: 'Netflix One' }),
    ott({ id: 'n2', title: 'Netflix Two', language: 'hi', languageLabel: 'Hindi' }),
    ott({ id: 'n3', title: 'Netflix Three', contentType: 'series' }),
    ott({ id: 'z1', title: 'Zee Film', platforms: ['ZEE5'] }),
  ],
  ottUpcoming: [ott({ id: 'n4', title: 'Netflix Soon', releaseDate: iso(6) })],
}

const post = (over: Partial<BlogPost> & { id: string }): BlogPost => ({
  ts: new Date().toISOString(),
  author: 'Ravi',
  title: 'Worth the ticket',
  body: 'The second half earns the ending.\n\nStay for the last twenty minutes.',
  tag: { kind: 'movie', id: 'n1', label: 'Netflix One', sub: 'Telugu', poster: null },
  ...over,
})

const article = (over: Partial<Article> & { id: string }): Article => ({
  ts: new Date().toISOString(),
  author: 'Ravi',
  topic: 'match',
  title: 'The 1983 final still does not make sense',
  body: 'Sixty overs, and nobody gave them a chance.\n\nKapil did not agree.',
  ...over,
})

/** Every route that ships a title/description, hubs included. */
const ALL_META_PATHS = [
  '/movies',
  '/movies/theatres',
  '/movies/upcoming',
  '/cricket/results',
  '/reviews',
  '/about',
  '/adda',
  '/privacy',
  ...OTT_PLATFORMS.map((p) => `/ott/${p.slug}`),
]

/** routeMeta returns HTML-escaped strings; length budgets are about what a
 *  reader sees, so "&amp;" counts as the one character it renders as. */
const unescape_ = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** Every ld+json block in a chunk of markup, parsed. Throws on invalid JSON. */
const schemas = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1])
  )

describe('buildPlatformSeo', () => {
  it('returns null for a platform we do not serve', () => {
    expect(buildPlatformSeo(data, 'hulu')).toBeNull()
  })

  it('lists only that platform’s titles', () => {
    const html = buildPlatformSeo(data, 'netflix')!
    expect(html).toContain('Netflix One')
    expect(html).not.toContain('Zee Film')

    const zee = buildPlatformSeo(data, 'zee5')!
    expect(zee).toContain('Zee Film')
    expect(zee).not.toContain('Netflix One')
  })

  it('links every title to its own page — the hub exists to pass authority on', () => {
    const html = buildPlatformSeo(data, 'netflix')!
    expect(html).toMatch(/<a href="\/movie\/n1\//)
  })

  it('links to the other hubs, so none of them is an orphan', () => {
    const html = buildPlatformSeo(data, 'netflix')!
    for (const p of OTT_PLATFORMS) {
      if (p.slug === 'netflix') continue
      expect(html).toContain(`href="/ott/${p.slug}"`)
    }
    // and back to the section hub
    expect(html).toContain('href="/movies"')
  })

  /**
   * The title promises "this week", so the page leads with it — and when a
   * platform has a quiet week (ZEE5 had one the day this was written, and it
   * rotates) the page says so rather than sliding into the archive under a
   * heading that promised something else. The title stays put either way: one
   * URL keying its title on the day's data would say different things on
   * different days.
   */
  it('leads with this week, then labels the archive', () => {
    // Its own fixture: the shared one is all from yesterday, so it has no
    // archive to label and would pass this test vacuously
    const mixed: ReleaseCache = {
      ...data,
      ott: [
        ott({ id: 'fresh', title: 'Landed Yesterday', releaseDate: iso(-1) }),
        ott({ id: 'old', title: 'Landed Last Month', releaseDate: iso(-40) }),
      ],
    }
    const html = buildPlatformSeo(mixed, 'netflix')!
    const week = html.indexOf('New this week on Netflix')
    const archive = html.indexOf('Everything else that landed')
    const langs = html.indexOf('Telugu movies')
    expect(week).toBeGreaterThan(-1)
    expect(week).toBeLessThan(archive)
    expect(archive).toBeLessThan(langs)
    // and the split itself is right
    expect(html.indexOf('Landed Yesterday')).toBeLessThan(archive)
    expect(html.indexOf('Landed Last Month')).toBeGreaterThan(archive)
  })

  it('admits a quiet week instead of pretending', () => {
    // Everything on this platform is older than seven days
    const stale: ReleaseCache = {
      ...data,
      ott: [ott({ id: 'old1', title: 'Old One', releaseDate: iso(-40) })],
      ottUpcoming: [],
    }
    const html = buildPlatformSeo(stale, 'netflix')!
    expect(html).toContain('Nothing new arrived on Netflix this week')
    expect(html).not.toContain('Everything else that landed')
    // …and still lists what it does have
    expect(html).toContain('Old One')
  })

  it('still renders a working page for a platform with nothing on it', () => {
    const empty: ReleaseCache = { ...data, ott: [], ottUpcoming: [] }
    const html = buildPlatformSeo(empty, 'aha')!
    expect(html).toContain('Aha')
    expect(html).toContain('</div>')
  })

  it('emits valid schema, and a BreadcrumbList whose last crumb is the page itself', () => {
    const found = schemas(buildPlatformSeo(data, 'netflix')!)
    const crumbs = found.find((s) => s['@type'] === 'BreadcrumbList')
    expect(crumbs).toBeTruthy()
    const items = crumbs.itemListElement
    expect(items.every((i: { '@type': string }) => i['@type'] === 'ListItem')).toBe(true)
    expect(items.map((i: { position: number }) => i.position)).toEqual([1, 2, 3])
    // Google expects the current page to be named but not linked
    expect(items[items.length - 1].item).toBeUndefined()
    expect(items[items.length - 1].name).toBe('Netflix')
  })

  it('the visible trail matches the marked-up one — no invisible breadcrumb', () => {
    const html = buildPlatformSeo(data, 'netflix')!
    expect(html).toMatch(/<p class="wa-crumbs">[\s\S]*?Netflix[\s\S]*?<\/p>/)
  })

  it('ItemList entries are ListItems wrapping the work, not the work itself', () => {
    const list = schemas(buildPlatformSeo(data, 'netflix')!).find((s) => s['@type'] === 'ItemList')
    expect(list).toBeTruthy()
    for (const entry of list.itemListElement) {
      expect(entry['@type']).toBe('ListItem')
      expect(['Movie', 'TVSeries']).toContain(entry.item['@type'])
    }
  })
})

describe('routeMeta', () => {
  it('gives every hub its own title and description', () => {
    const seen = new Set<string>()
    for (const p of OTT_PLATFORMS) {
      const meta = routeMeta(`/ott/${p.slug}`)
      expect(meta).toBeTruthy()
      // The short name where one exists — a <title> has a character budget
      expect(meta!.title).toContain((p.short ?? p.name).replace(/&/g, '&amp;'))
      expect(seen.has(meta!.title)).toBe(false)
      seen.add(meta!.title)
    }
  })

  it('has nothing to say about a path that is not a page', () => {
    expect(routeMeta('/ott/hulu')).toBeNull()
    expect(routeMeta('/ott')).toBeNull()
    expect(routeMeta('/nope')).toBeNull()
  })

  it('escapes for HTML, since these go straight into attributes', () => {
    const meta = routeMeta('/ott/netflix')!
    expect(meta.title).not.toMatch(/(?<!&amp;)&(?!amp;|quot;|lt;|gt;)/)
  })

  /**
   * Guards the four-place coupling: `platformMeta` here and in
   * frontend/src/platforms.ts must produce the same strings, or one URL
   * advertises two titles. Pinning the shape makes a drift a failing test
   * rather than a silent SEO bug.
   */
  it('keeps the hub title format the frontend mirrors', () => {
    expect(routeMeta('/ott/netflix')!.title).toBe(
      'New Movies &amp; Web Series on Netflix India This Week'
    )
  })

  it('uses the short platform name where characters are rationed', () => {
    // "Amazon Prime Video" put this tag at 72 characters — past truncation, so
    // "| WeekAdda" never appeared in the result. "Prime Video" is the searched
    // form anyway. The full name is still what the page itself says.
    expect(routeMeta('/ott/prime-video')!.title).toContain('Prime Video')
    expect(routeMeta('/ott/prime-video')!.title).not.toContain('Amazon')
    expect(buildPlatformSeo(data, 'prime-video')).toContain('Amazon Prime Video')
  })

  /**
   * Bing Webmaster flagged the hubs for both. Measured across every route, not
   * just the one reported: eight hub descriptions were over 160 and five
   * titles over 60, plus /movies/upcoming and /adda, which nothing had caught.
   * Budgets are checked against the *longest* platform name, since that is the
   * one that breaks.
   */
  it('keeps every title inside what search engines display', () => {
    for (const path of ALL_META_PATHS) {
      const plain = unescape_(routeMeta(path)!.title)
      expect(plain.length, `${path} title is ${plain.length} chars`).toBeLessThanOrEqual(60)
    }
  })

  it('keeps every description inside 160, and long enough to be worth showing', () => {
    for (const path of ALL_META_PATHS) {
      const plain = unescape_(routeMeta(path)!.description)
      expect(plain.length, `${path} description is ${plain.length} chars`).toBeLessThanOrEqual(160)
      expect(plain.length, `${path} description is only ${plain.length} chars`).toBeGreaterThan(110)
    }
  })

  /**
   * These drifted once — the Worker said "Built by Hemanth Mareedu" while the
   * SPA overwrote it with a title about movies and cricket, so one URL
   * advertised two titles and the React one won in search results. Pinned to
   * whatever usePageMeta in About.tsx says.
   */
  it('keeps /about identical to what the SPA sets on mount', () => {
    expect(routeMeta('/about')!.title).toBe('About WeekAdda — Founded by Hemanth Mareedu')
    expect(routeMeta('/about')!.description).toBe(
      'WeekAdda was founded by Hemanth Mareedu, a software engineer and lifelong movie and cricket fan — weekly movie releases, OTT arrivals and cricket in one place.'
    )
  })
})

describe('buildAboutSeo', () => {
  const html = buildAboutSeo()

  it('answers the question in words, not only in markup', () => {
    expect(html).toContain('Who is the founder of WeekAdda?')
    expect(html).toContain('WeekAdda was founded by Hemanth Mareedu')
  })

  it('is one Person entity, sharing the @id the Organization names as founder', () => {
    const profile = schemas(html).find((s) => s['@type'] === 'ProfilePage')
    expect(profile).toBeTruthy()
    expect(profile.mainEntity['@id']).toBe('https://weekadda.com/about#hemanth-mareedu')
    expect(profile.mainEntity.sameAs).toContain(
      'https://www.linkedin.com/in/hemanth-mareedu-a69271116/'
    )
  })

  it('links out to the profile that corroborates the identity', () => {
    expect(html).toContain('linkedin.com/in/hemanth-mareedu-a69271116')
    expect(html).toContain('rel="me"')
  })
})

describe('buildSitemap', () => {
  const map = buildSitemap(data)

  it('includes a hub that clears the threshold and omits one that does not', () => {
    // Netflix has 4 entries here, ZEE5 only 1
    expect(map).toContain('<loc>https://weekadda.com/ott/netflix</loc>')
    expect(map).not.toContain('<loc>https://weekadda.com/ott/zee5</loc>')
  })

  it('lists every title page exactly once across all three pools', () => {
    const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(new Set(locs).size).toBe(locs.length)
    expect(locs).toContain('https://weekadda.com/movie/n1/netflix-one')
  })

  it('never advertises the private dashboard', () => {
    expect(map).not.toContain('/stats')
  })

  it('keeps a reviewed title listed after it leaves the release window', () => {
    const withReview = buildSitemap(data, [
      {
        id: 'p1',
        ts: new Date().toISOString(),
        author: 'Ravi',
        title: 'Worth it',
        body: 'Good.',
        tag: { kind: 'movie', id: 'aged-out', label: 'Chennai Love Story', sub: '', poster: null },
      },
    ])
    expect(withReview).toContain('/movie/aged-out/chennai-love-story')
    // and does not duplicate one that is still in the cache
    const dupes = buildSitemap(data, [
      {
        id: 'p2',
        ts: new Date().toISOString(),
        author: 'Ravi',
        title: 'Worth it',
        body: 'Good.',
        tag: { kind: 'movie', id: 'n1', label: 'Netflix One', sub: '', poster: null },
      },
    ])
    const locs = [...dupes.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(new Set(locs).size).toBe(locs.length)
  })

  it('lists every review page, dated by the review rather than by the sweep', () => {
    const withReview = buildSitemap(data, [post({ id: 'p-1', ts: '2026-01-09T10:00:00.000Z' })])
    expect(withReview).toContain(
      '<loc>https://weekadda.com/review/p-1/worth-the-ticket</loc><lastmod>2026-01-09</lastmod>'
    )
  })

  it('lists every article page too', () => {
    const withArticle = buildSitemap(data, [], [article({ id: 'a-1', ts: '2026-02-03T08:00:00Z' })])
    expect(withArticle).toContain(
      '<loc>https://weekadda.com/article/a-1/the-1983-final-still-does-not-make-sense</loc><lastmod>2026-02-03</lastmod>'
    )
  })

  it('is well-formed XML with a single urlset', () => {
    expect(map.startsWith('<?xml')).toBe(true)
    expect([...map.matchAll(/<urlset/g)]).toHaveLength(1)
    expect([...map.matchAll(/<url>/g)].length).toBe([...map.matchAll(/<\/url>/g)].length)
  })
})

describe('buildTitlePage', () => {
  const review = (id: string, title = 'Worth it') => ({
    id: `p-${id}`,
    ts: new Date().toISOString(),
    author: 'Ravi',
    title,
    body: 'The second half earns the ending. Worth the ticket.',
    tag: { kind: 'movie' as const, id, label: 'Chennai Love Story', sub: 'Telugu', poster: null },
  })

  it('returns null for an id with no cache row and nothing written about it', () => {
    expect(buildTitlePage(data, 'gone')).toBeNull()
    expect(buildTitlePage(data, 'gone', [])).toBeNull()
  })

  it('keeps a page alive for a film that aged out but has reviews', () => {
    // The release row is gone; the reviews are not. The page that ranks for
    // "<film> review" must not 404 and take them with it.
    const page = buildTitlePage(data, 'aged-out', [review('aged-out')])!
    expect(page).toBeTruthy()
    expect(page.title).toContain('Chennai Love Story')
    expect(page.title).toContain('Review')
    expect(page.block).toContain('The second half earns the ending')
    expect(page.canonical).toBe('https://weekadda.com/movie/aged-out/chennai-love-story')
  })

  it('the surviving page says what it no longer knows, rather than inventing it', () => {
    const page = buildTitlePage(data, 'aged-out', [review('aged-out')])!
    expect(page.block).toContain('no longer tracked')
    // Nothing that would need the release row
    expect(page.block).not.toMatch(/Release date:/)
  })

  it('carries Review schema on the surviving page too', () => {
    const page = buildTitlePage(data, 'aged-out', [review('aged-out')])!
    const movie = schemas(page.block).find((s) => s['@type'] === 'Movie')
    expect(movie.review).toHaveLength(1)
    expect(movie.review[0]['@type']).toBe('Review')
    // The stars measure how useful the review was, not a verdict on the film
    expect(movie.review[0].reviewRating).toBeUndefined()
  })

  it('ignores reviews of a different title', () => {
    expect(buildTitlePage(data, 'aged-out', [review('some-other-film')])).toBeNull()
  })

  it('puts a film under its platform hub — the only link from a title back in', () => {
    const page = buildTitlePage(data, 'n1')!
    expect(page.block).toContain('href="/ott/netflix"')
  })

  it('does not invent a hub for a theatre release', () => {
    const page = buildTitlePage(data, 'theatre-1')!
    expect(page.block).not.toContain('/ott/')
  })

  it('keeps the meta description inside what search engines display', () => {
    const page = buildTitlePage(data, 'n1')!
    expect(page.description.length).toBeLessThanOrEqual(160)
    expect(page.canonical).toBe('https://weekadda.com/movie/n1/netflix-one')
  })
})

describe('buildReviewPage', () => {
  it('returns null for a review that is no longer held', () => {
    expect(buildReviewPage([], 'p-gone')).toBeNull()
    expect(buildReviewPage([post({ id: 'p-1' })], 'p-2')).toBeNull()
  })

  it('carries the whole take, not the opening the feed shows', () => {
    const page = buildReviewPage([post({ id: 'p-1' })], 'p-1')!
    expect(page.block).toContain('The second half earns the ending')
    expect(page.block).toContain('Stay for the last twenty minutes')
    expect(page.canonical).toBe('https://weekadda.com/review/p-1/worth-the-ticket')
  })

  it('links back to the film it is about, and to the rest of the reviews', () => {
    const page = buildReviewPage([post({ id: 'p-1' })], 'p-1')!
    expect(page.block).toContain('href="/movie/n1/netflix-one"')
    expect(page.block).toContain('href="/reviews"')
  })

  it('marks the review up without a rating — the stars are not a verdict', () => {
    const page = buildReviewPage([post({ id: 'p-1' })], 'p-1')!
    const review = schemas(page.block).find((s) => s['@type'] === 'Review')
    expect(review.author.name).toBe('Ravi')
    expect(review.itemReviewed['@type']).toBe('Movie')
    // Same rule as the title pages: the five stars measure how useful readers
    // found the review, so mapping them to a score out of five would be a lie
    expect(review.reviewRating).toBeUndefined()
  })

  it('invents no itemReviewed type for a match review', () => {
    const match = post({
      id: 'p-m',
      tag: { kind: 'match', id: 'm1', label: 'India vs Zimbabwe', sub: '', poster: null },
    })
    const page = buildReviewPage([match], 'p-m')!
    expect(page.block).toContain('India vs Zimbabwe')
    // The breadcrumb still emits its own schema; what must not appear is a
    // Review pointing at a made-up itemReviewed type for a cricket match
    expect(schemas(page.block).some((s) => s['@type'] === 'Review')).toBe(false)
    // and no /movie/ link, which would point at a page that does not exist
    expect(page.block).not.toContain('href="/movie/')
  })

  it('keeps the meta description inside what search engines display', () => {
    const long = post({ id: 'p-long', body: 'Very good film. '.repeat(60) })
    const page = buildReviewPage([long], 'p-long')!
    expect(page.description.length).toBeLessThanOrEqual(160)
    expect(page.title).toContain('Netflix One')
  })
})

describe('buildArticlePage', () => {
  it('carries the whole article and canonicalises to its own path', () => {
    const page = buildArticlePage(article({ id: 'a-1' }))!
    expect(page.block).toContain('nobody gave them a chance')
    expect(page.block).toContain('Kapil did not agree')
    expect(page.canonical).toBe(
      'https://weekadda.com/article/a-1/the-1983-final-still-does-not-make-sense'
    )
  })

  it('is an Article, not a Review — nothing here is being rated', () => {
    const page = buildArticlePage(article({ id: 'a-1' }))!
    const ld = schemas(page.block).find((s) => s['@type'] === 'Article')
    expect(ld.author.name).toBe('Ravi')
    expect(ld.headline).toContain('1983')
    expect(schemas(page.block).some((s) => s['@type'] === 'Review')).toBe(false)
  })

  /**
   * The related rail is the only crawlable path from one article to the next —
   * nothing else on the site links to them individually. If it stops being
   * rendered, every article becomes an island that only the sitemap knows.
   */
  it('links to the related articles beside it', () => {
    const page = buildArticlePage(article({ id: 'a-1' }), [
      article({ id: 'a-2', title: 'Ten films that hold up' }),
    ])!
    expect(page.block).toContain('href="/article/a-2/ten-films-that-hold-up"')
  })

  it('keeps the meta description inside what search engines display', () => {
    const page = buildArticlePage(article({ id: 'a-1', body: 'Very long. '.repeat(80) }))!
    expect(page.description.length).toBeLessThanOrEqual(160)
  })

  /**
   * A pasted link is the whole point of "watch it here" — as plain text it is
   * a string the reader has to select and copy. The client renders these the
   * same way (Prose.tsx); if the two disagree, a crawler and a reader are
   * looking at different pages.
   */
  describe('where to watch', () => {
    it('links each named platform, and the film page when we still hold it', () => {
      const page = buildArticlePage(
        article({
          id: 'a-1',
          films: [
            { id: 'n1', title: 'Netflix One', platforms: [{ name: 'Netflix' }] },
            { title: '83', platforms: [{ name: 'Netflix' }] },
          ],
        })
      )!
      expect(page.block).toContain('Where to watch')
      expect(page.block).toContain('href="/movie/n1/netflix-one"')
      expect(page.block).toContain('https://www.netflix.com/search?q=83')
      // A film outside the release window has no page to link to
      expect(page.block).toContain('<strong>83</strong>')
    })

    it('names a film with no platform rather than dropping it', () => {
      const page = buildArticlePage(
        article({ id: 'a-1', films: [{ title: 'Sholay', platforms: [] }] })
      )!
      expect(page.block).toContain('Sholay')
    })

    it('says nothing at all when no film is attached', () => {
      expect(buildArticlePage(article({ id: 'a-1' }))!.block).not.toContain('Where to watch')
    })

    it('prefers the writer’s exact title page over a search', () => {
      const page = buildArticlePage(
        article({
          id: 'a-1',
          films: [
            {
              title: 'RRR',
              platforms: [{ name: 'Netflix', url: 'https://www.netflix.com/in/title/81476453' }],
            },
          ],
        })
      )!
      expect(page.block).toContain('https://www.netflix.com/in/title/81476453')
      expect(page.block).not.toContain('netflix.com/search')
    })

    /**
     * The useful place for "watch it here" is beside the title being talked
     * about. A ten-film list would otherwise make the reader scroll past all
     * ten to a block at the bottom and match them up by eye.
     */
    it('badges a film where the prose names it, instead of only underneath', () => {
      const page = buildArticlePage(
        article({
          id: 'a-1',
          body: 'Rangasthalam is sound design as a character.',
          films: [
            {
              title: 'Rangasthalam',
              platforms: [{ name: 'Amazon Prime Video', url: 'https://www.primevideo.com/detail/X' }],
            },
          ],
        })
      )!
      expect(page.block).toContain('Rangasthalam (<a href="https://www.primevideo.com/detail/X"')
      // and is not then repeated in a block below
      expect(page.block).not.toContain('Where to watch')
    })

    it('does not find a film inside a longer word or number', () => {
      const page = buildArticlePage(
        article({
          id: 'a-1',
          // "83" must not match inside "1983"
          body: 'The 1983 final was the whole point.',
          films: [{ title: '83', platforms: [{ name: 'Netflix' }] }],
        })
      )!
      expect(page.block).toContain('The 1983 final')
      expect(page.block).not.toContain('1983 <a')
      // unnamed, so it falls through to the block instead
      expect(page.block).toContain('Where to watch')
    })

    it('badges only the first mention, however often a film comes up', () => {
      const page = buildArticlePage(
        article({
          id: 'a-1',
          body: 'RRR opens loud.\n\nRRR closes louder.',
          films: [{ title: 'RRR', platforms: [{ name: 'Netflix' }] }],
        })
      )!
      expect([...page.block.matchAll(/netflix\.com\/search/g)]).toHaveLength(1)
    })
  })

  describe('links a writer pastes', () => {
    const withLink = (body: string) => buildArticlePage(article({ id: 'a-1', body }))!.block

    it('become real links, marked as visitor-supplied', () => {
      const html = withLink('Watch it: https://www.netflix.com/in/title/81144147')
      expect(html).toContain('<a href="https://www.netflix.com/in/title/81144147"')
      expect(html).toContain('rel="nofollow ugc noopener noreferrer"')
      expect(html).toContain('target="_blank"')
    })

    it('are labelled by the service instead of showing a raw URL', () => {
      const html = withLink(
        'Film: https://www.netflix.com/in/title/81144147 and highlights: https://www.youtube.com/watch?v=abc'
      )
      expect(html).toContain('>Netflix</a>')
      expect(html).toContain('>YouTube</a>')
      // the href is still the real link, only the visible text changed
      expect(html).toContain('href="https://www.netflix.com/in/title/81144147"')
    })

    it('matches on the domain, not on the URL merely containing the word', () => {
      const html = withLink('https://example.com/netflix/review')
      expect(html).not.toContain('>Netflix</a>')
      expect(html).toContain('>https://example.com/netflix/review</a>')
    })

    it('leave the sentence its full stop', () => {
      const html = withLink('See https://example.com/a.')
      expect(html).toContain('<a href="https://example.com/a"')
      expect(html).toContain('</a>.')
    })

    it('cannot smuggle markup through the body', () => {
      const html = withLink('<script>alert(1)</script> and <a href="x">no</a>')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<a href="x"')
      expect(html).toContain('&lt;script&gt;')
    })

    it('do not turn a bare domain or a javascript: URL into a link', () => {
      expect(withLink('go to example.com now')).not.toContain('<a href="example.com')
      // eslint-disable-next-line no-script-url
      expect(withLink('javascript:alert(1)')).not.toContain('<a href="javascript:')
    })
  })
})

describe('buildBlogSeo', () => {
  it('links the articles beside the feed, so they are not orphans', () => {
    const block = buildBlogSeo([post({ id: 'p-1' })], [article({ id: 'a-1' })])
    expect(block).toContain('href="/article/a-1/')
    expect(block).toContain('Articles')
  })

  it('says nothing about articles when there are none', () => {
    const block = buildBlogSeo([post({ id: 'p-1' })])
    expect(block).not.toContain('/article/')
  })

  it('never lists an article as though it were a review', () => {
    const block = buildBlogSeo([post({ id: 'p-1' })], [article({ id: 'a-1' })])
    const reviews = block.slice(block.indexOf('Latest reviews'), block.indexOf('Articles'))
    expect(reviews).not.toContain('1983')
  })
})

/**
 * Google showed a cricket page swept that morning as "3 days ago", because
 * every date on it belonged to a match and the oldest was three days old. The
 * fix existed on /movies and had never been applied to cricket — so this
 * asserts it for every listing page at once, which is the only way it stays
 * applied to the next one somebody adds.
 */
describe('page freshness', () => {
  const cricket = {
    fetchedAt: '2026-07-30T04:00:00.000Z',
    source: 'sample' as const,
    matches: [],
  }
  const pages: Array<[string, string]> = [
    ['/movies', buildMoviesSeo(data)],
    ['/movies/theatres', buildMoviesSeo(data, 'theatres')],
    ['/movies/upcoming', buildMoviesSeo(data, 'upcoming')],
    ['/ott/netflix', buildPlatformSeo(data, 'netflix')!],
    ['/cricket', buildCricketSeo(cricket)],
    ['/cricket/results', buildCricketSeo(cricket, 'results')],
  ]

  it.each(pages)('%s carries a visible <time> for the page itself', (_name, html) => {
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}[^"]*">/)
  })

  it.each(pages)('%s declares dateModified to match', (_name, html) => {
    const page = schemas(html).find((s) => s.dateModified)
    expect(page).toBeTruthy()
    // The claim and the visible date have to agree, or neither is trusted
    const visible = html.match(/<time datetime="([^"]*)">/)![1]
    expect(page.dateModified).toBe(visible)
  })

  it('says nothing rather than something wrong when the sweep date is junk', () => {
    const broken = buildCricketSeo({ ...cricket, fetchedAt: 'not-a-date' })
    expect(broken).not.toContain('<time')
    expect(broken).not.toContain('dateModified')
  })

  /**
   * The sweep runs at 22:30 UTC, which is already the next morning in Delhi.
   * Read in UTC it reported every single sweep as a day older than it was —
   * on the one page whose whole claim is being current.
   */
  it('labels the sweep by its Indian calendar day, not its UTC one', () => {
    // 23:32 UTC on the 29th is 05:02 IST on the 30th — a page swept this
    // morning, not yesterday
    const html = buildCricketSeo({ ...cricket, fetchedAt: '2026-07-29T23:32:40.453Z' })
    expect(html).toContain('>30 Jul 2026</time>')
    expect(html).not.toContain('>29 Jul 2026</time>')
    // The machine-readable half keeps the exact instant, offset and all
    expect(html).toContain('datetime="2026-07-29T23:32:40.453Z"')
  })

  it('leaves a sweep already inside the Indian day alone', () => {
    const html = buildCricketSeo({ ...cricket, fetchedAt: '2026-07-30T04:00:00.000Z' })
    expect(html).toContain('>30 Jul 2026</time>')
  })
})

describe('every pre-render block', () => {
  const blocks: Array<[string, string]> = [
    ['movies', buildMoviesSeo(data)],
    ['theatres', buildMoviesSeo(data, 'theatres')],
    ['upcoming', buildMoviesSeo(data, 'upcoming')],
    ['hub', buildPlatformSeo(data, 'netflix')!],
    ['title', buildTitlePage(data, 'n1')!.block],
    ['review', buildReviewPage([post({ id: 'p-1' })], 'p-1')!.block],
    ['article', buildArticlePage(article({ id: 'a-1' }), [article({ id: 'a-2' })])!.block],
  ]

  it.each(blocks)('%s emits only valid JSON-LD', (_name, html) => {
    expect(() => schemas(html)).not.toThrow()
    for (const s of schemas(html)) expect(s['@context']).toBe('https://schema.org')
  })

  it.each(blocks)('%s is a balanced fragment', (_name, html) => {
    expect(html.startsWith('<div id="wa-prerender"')).toBe(true)
    expect(html.endsWith('</div>')).toBe(true)
  })

  it.each(blocks)('%s carries at least one crawlable link', (_name, html) => {
    expect(html).toMatch(/<a href="\//)
  })

  /**
   * A double-escaped entity is the one HTML bug that looks fine in the source
   * and renders as literal gibberish — "week&#39;s" on the page instead of an
   * apostrophe. It happens the moment a string containing an entity meets
   * esc(), which turns its & into &amp;. Prose here uses real characters (’ —
   * &) precisely so that can never happen; this catches it if someone
   * reintroduces one.
   */
  it.each(blocks)('%s never double-escapes an entity', (_name, html) => {
    expect(html).not.toMatch(/&amp;(#\d+|[a-z]+);/)
  })
})

describe('meta strings', () => {
  it('carry real characters, not HTML entities that could be escaped twice', () => {
    for (const path of ['/movies', '/movies/theatres', '/movies/upcoming', '/reviews', '/about', '/adda', '/privacy', '/cricket/results', '/ott/netflix']) {
      const meta = routeMeta(path)!
      expect(meta.description).not.toMatch(/&amp;(#\d+|[a-z]+);/)
      expect(meta.title).not.toMatch(/&amp;(#\d+|[a-z]+);/)
      // esc() turns a bare & into &amp;, which is correct and expected; what
      // must never appear is an entity that was already an entity
      expect(meta.description).not.toContain('&#39;')
    }
  })
})
