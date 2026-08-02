import { describe, it, expect } from 'vitest'
import {
  queryPlatform,
  queryReleases,
  queryCricket,
  aggregateClicks,
  countMembers,
  isOwnerEmail,
  buildPost,
  releaseLanguages,
  isPanIndia,
  OTT_PLATFORMS,
  PLATFORM_MIN_TITLES,
  PAN_INDIA_CODE,
  titleUrl,
  reviewUrl,
  articleUrl,
  applyArticleEdit,
  buildArticle,
  canEditArticle,
  applyPostEdit,
  canEditPost,
  relatedReviews,
  summarizeLikes,
  imageExtension,
  publicArticle,
  relatedArticles,
  relatedTitles,
  applyWatchLogEdit,
  buildWatchLog,
  watchStats,
  buildPushSubscription,
  todaysReleasesFor,
  ALL_LANGUAGES_CODE,
  type ReleaseCache,
  type OttRelease,
  type Release,
  type CricketCache,
  type Click,
  type WatchLog,
} from './queries'

/**
 * Tests for the logic both the Express app and the Worker run. Everything here
 * is a pure function over JSON, and a bug in it is served twice.
 *
 * Dates are built relative to now rather than hard-coded: these assertions have
 * to still pass next month, and a suite that quietly rots into always-green is
 * worse than no suite.
 */

const iso = (daysFromToday: number) =>
  new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10)

const release = (over: Partial<Release> & { id: string }): Release => ({
  title: over.id,
  originalTitle: over.id,
  language: 'te',
  languageLabel: 'Telugu',
  releaseDate: iso(-1),
  overview: '',
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

const todaysIds = (list: Array<{ id: string }>) => list.map((r) => r.id)

const cache = (over: Partial<ReleaseCache> = {}): ReleaseCache => ({
  fetchedAt: new Date().toISOString(),
  source: 'sample',
  releases: [],
  ott: [],
  ottUpcoming: [],
  ...over,
})

// ---------------------------------------------------------------- platform hubs

describe('queryPlatform', () => {
  it('returns null for a platform we do not serve, so the route can 404', () => {
    expect(queryPlatform(cache(), 'hulu')).toBeNull()
    expect(queryPlatform(cache(), '')).toBeNull()
    // Not the display name — the slug is the key
    expect(queryPlatform(cache(), 'Netflix')).toBeNull()
  })

  it('splits streaming from upcoming on today, not on which pool it came from', () => {
    const data = cache({
      ott: [ott({ id: 'out-today', releaseDate: iso(0) }), ott({ id: 'old', releaseDate: iso(-30) })],
      ottUpcoming: [ott({ id: 'soon', releaseDate: iso(3) })],
    })
    const hub = queryPlatform(data, 'netflix')!
    expect(hub.streaming.map((r) => r.id)).toEqual(['out-today', 'old'])
    expect(hub.upcoming.map((r) => r.id)).toEqual(['soon'])
  })

  it('orders streaming newest first and upcoming soonest first', () => {
    const data = cache({
      ott: [
        ott({ id: 'older', releaseDate: iso(-10) }),
        ott({ id: 'newer', releaseDate: iso(-2) }),
      ],
      ottUpcoming: [ott({ id: 'later', releaseDate: iso(20) }), ott({ id: 'next', releaseDate: iso(2) })],
    })
    const hub = queryPlatform(data, 'netflix')!
    expect(hub.streaming.map((r) => r.id)).toEqual(['newer', 'older'])
    expect(hub.upcoming.map((r) => r.id)).toEqual(['next', 'later'])
  })

  it('matches any of a title’s platforms, not just the first', () => {
    const data = cache({ ott: [ott({ id: 'both', platforms: ['ZEE5', 'Netflix'] })] })
    expect(queryPlatform(data, 'netflix')!.streaming).toHaveLength(1)
    expect(queryPlatform(data, 'zee5')!.streaming).toHaveLength(1)
    expect(queryPlatform(data, 'aha')!.streaming).toHaveLength(0)
  })

  it('gates indexing on the threshold, counting streaming and upcoming together', () => {
    const withCount = (n: number) =>
      queryPlatform(
        cache({ ott: Array.from({ length: n }, (_, i) => ott({ id: `t${i}` })) }),
        'netflix'
      )!.indexable

    expect(withCount(PLATFORM_MIN_TITLES - 1)).toBe(false)
    expect(withCount(PLATFORM_MIN_TITLES)).toBe(true)

    // The boundary is the sum: two streaming + one upcoming qualifies
    const split = queryPlatform(
      cache({
        ott: [ott({ id: 'a' }), ott({ id: 'b' })],
        ottUpcoming: [ott({ id: 'c', releaseDate: iso(5) })],
      }),
      'netflix'
    )!
    expect(split.indexable).toBe(true)
  })

  it('an empty platform is served but never indexable', () => {
    const hub = queryPlatform(cache(), 'aha')!
    expect(hub.streaming).toEqual([])
    expect(hub.indexable).toBe(false)
  })

  it('every hub slug is url-safe and unique', () => {
    const slugs = OTT_PLATFORMS.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
    expect(new Set(OTT_PLATFORMS.map((p) => p.name)).size).toBe(OTT_PLATFORMS.length)
  })
})

// ---------------------------------------------------------------- release queries

describe('queryReleases', () => {
  const extras = { syncing: false, liveConfigured: true }

  it('filters on every language a pan-India film released in', () => {
    const panIndia = release({
      id: 'pan',
      language: 'te',
      languageLabel: 'Telugu',
      languages: ['te', 'hi', 'ta'],
    })
    const hindiOnly = release({ id: 'hi-only', language: 'hi', languageLabel: 'Hindi' })
    const data = cache({ releases: [panIndia, hindiOnly] })

    // The Telugu original shows in the Hindi row — the whole point of the field
    const hindi = queryReleases(data, { window: 'released', language: 'hi' }, extras).releases
    expect(hindi.map((r) => r.id).sort()).toEqual(['hi-only', 'pan'])

    const tamil = queryReleases(data, { window: 'released', language: 'ta' }, extras).releases
    expect(tamil.map((r) => r.id)).toEqual(['pan'])
  })

  it('the pan-India chip means multi-language, not a language', () => {
    const data = cache({
      releases: [
        release({ id: 'pan', languages: ['te', 'hi'] }),
        release({ id: 'single' }),
      ],
    })
    const out = queryReleases(data, { window: 'released', language: PAN_INDIA_CODE }, extras).releases
    expect(out.map((r) => r.id)).toEqual(['pan'])
  })

  it('reads languages through the helper, so an older cache still works', () => {
    const legacy = release({ id: 'legacy' }) // no `languages` field at all
    expect(releaseLanguages(legacy)).toEqual(['te'])
    expect(isPanIndia(legacy)).toBe(false)
    expect(isPanIndia(release({ id: 'x', languages: ['te', 'hi'] }))).toBe(true)
  })

  it('upcoming means strictly after today — a title out today is not upcoming', () => {
    const data = cache({
      releases: [release({ id: 'today', releaseDate: iso(0) }), release({ id: 'soon', releaseDate: iso(4) })],
    })
    const out = queryReleases(data, { window: 'upcoming' }, extras).releases
    expect(out.map((r) => r.id)).toEqual(['soon'])
  })

  it('puts Telugu first, then sorts within', () => {
    const data = cache({
      releases: [
        release({ id: 'hi-new', language: 'hi', languageLabel: 'Hindi', releaseDate: iso(0) }),
        release({ id: 'te-old', language: 'te', languageLabel: 'Telugu', releaseDate: iso(-3) }),
      ],
    })
    const out = queryReleases(data, { window: 'released' }, extras).releases
    expect(out[0].id).toBe('te-old')
  })

  it('separates movies from web series on the OTT tab', () => {
    const data = cache({
      ott: [ott({ id: 'film' }), ott({ id: 'show', contentType: 'series' })],
    })
    const series = queryReleases(data, { window: 'ott', contentType: 'series' }, extras).releases
    expect(series.map((r) => r.id)).toEqual(['show'])
  })

  // A search asks whether we have a film at all. Week-paging the answer made
  // "not this week" indistinguishable from "not here", with thirteen weeks of
  // cache sitting behind it.
  it('searches every week in theatres, not just the week being viewed', () => {
    const data = cache({
      releases: [
        release({ id: 'this-week', title: 'Kantara Chapter 2', releaseDate: iso(-1) }),
        release({ id: 'nine-weeks-ago', title: 'Kantara Legend', releaseDate: iso(-63) }),
      ],
    })
    const found = queryReleases(data, { window: 'released', week: 0, search: 'kantara' }, extras)
    expect(found.releases.map((r) => r.id).sort()).toEqual(['nine-weeks-ago', 'this-week'])
    // The week is still reported, because the timeline is still on screen
    expect(found.week?.index).toBe(0)
  })

  it('searches every week on the OTT tab too', () => {
    const data = cache({
      ott: [
        ott({ id: 'wk0', title: 'Objection My Lord', week: 0 }),
        ott({ id: 'wk7', title: 'Objection Overruled', week: 7 }),
      ],
    })
    const out = queryReleases(data, { window: 'ott', week: 0, search: 'objection' }, extras).releases
    expect(out.map((r) => r.id).sort()).toEqual(['wk0', 'wk7'])
  })

  it('still keeps unreleased films out of a theatres search', () => {
    const data = cache({
      releases: [
        release({ id: 'out', title: 'Peddi', releaseDate: iso(-20) }),
        release({ id: 'not-yet', title: 'Peddi Part Two', releaseDate: iso(9) }),
      ],
    })
    const out = queryReleases(data, { window: 'released', search: 'peddi' }, extras).releases
    expect(out.map((r) => r.id)).toEqual(['out'])
  })

  it('narrows to the viewed week again once the search is cleared', () => {
    const data = cache({
      releases: [
        release({ id: 'this-week', releaseDate: iso(-1) }),
        release({ id: 'long-ago', releaseDate: iso(-63) }),
      ],
    })
    const out = queryReleases(data, { window: 'released', week: 0, search: '  ' }, extras).releases
    expect(out.map((r) => r.id)).toEqual(['this-week'])
  })
})

// ---------------------------------------------------------------- cricket

describe('queryCricket', () => {
  const team = (name: string, winner: boolean) => ({
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    score: '150/4',
    logo: null,
    winner,
  })
  const cricket = (matches: CricketCache['matches']): CricketCache => ({
    fetchedAt: new Date().toISOString(),
    source: 'sample',
    matches,
  })
  const match = (over: Partial<CricketCache['matches'][number]> = {}) => ({
    id: 'm1',
    name: 'India v Australia',
    shortName: 'IND v AUS',
    series: 'India tour of Australia',
    seriesId: 's1',
    date: new Date(Date.now() - 86_400_000).toISOString(),
    venue: 'Chepauk',
    state: 'post' as const,
    statusDetail: 'Final',
    international: true,
    url: null,
    label: '1st T20I',
    teams: [team('India', true), team('Australia', false)],
    ...over,
  })

  it('never returns an in-progress match — no live scores is a decision', () => {
    const data = cricket([match({ id: 'live', state: 'in' }), match({ id: 'done' })])
    const out = queryCricket(data, { window: 'recent' }, { syncing: false }).matches
    expect(out.map((m) => m.id)).toEqual(['done'])
  })

  it('upcoming returns fixtures, not finished games', () => {
    const data = cricket([
      match({ id: 'past' }),
      match({ id: 'next', state: 'pre', date: new Date(Date.now() + 86_400_000).toISOString() }),
    ])
    const out = queryCricket(data, { window: 'upcoming' }, { syncing: false }).matches
    expect(out.map((m) => m.id)).toEqual(['next'])
  })
})

// ---------------------------------------------------------------- click stats

describe('aggregateClicks', () => {
  const now = new Date('2026-07-30T12:00:00Z')
  const click = (over: Partial<Click>): Click => ({
    ts: now.toISOString(),
    kind: 'watch',
    platform: 'Netflix',
    titleId: 't1',
    title: 'A Film',
    language: 'Telugu',
    ...over,
  })

  it('folds one person’s two browsers into one, and their earlier signed-out clicks with them', () => {
    const stats = aggregateClicks(
      [
        // Signed out on the phone, before ever signing in
        click({ visitorId: 'phone' }),
        // Then signs in on the phone, and later on the laptop
        click({ visitorId: 'phone', userEmail: 'a@x.com' }),
        click({ visitorId: 'laptop', userEmail: 'a@x.com' }),
      ],
      now
    )
    expect(stats.uniqueVisitors).toBe(2) // two browsers
    expect(stats.signedInVisitors).toBe(1) // one account
    expect(stats.uniquePeople).toBe(1) // one human — the number that means something
    expect(stats.totalClicks).toBe(3)
  })

  it('counts someone who never signs in once per browser — a floor, not a bug', () => {
    const stats = aggregateClicks([click({ visitorId: 'p' }), click({ visitorId: 'l' })], now)
    expect(stats.uniquePeople).toBe(2)
    expect(stats.signedInVisitors).toBe(0)
  })

  it('buckets days in IST, so "today" means today in India', () => {
    // 20:00 UTC on the 29th is 01:30 IST on the 30th — already tomorrow in India
    const stats = aggregateClicks([click({ ts: '2026-07-29T20:00:00Z', visitorId: 'v' })], now)
    expect(stats.today).toBe('2026-07-30')
    expect(stats.todayClicks).toBe(1)
  })

  it('never returns an email anywhere in the payload', () => {
    const stats = aggregateClicks([click({ visitorId: 'v', userEmail: 'secret@x.com' })], now)
    expect(JSON.stringify(stats)).not.toContain('secret@x.com')
  })
})

describe('countMembers', () => {
  const now = new Date('2026-07-30T12:00:00Z')

  it('counts one account once however many features it used', () => {
    const out = countMembers(
      [
        { email: 'a@x.com', ts: now.toISOString(), source: 'click' },
        { email: 'a@x.com', ts: now.toISOString(), source: 'blog' },
        { email: 'b@x.com', ts: '2026-01-01T00:00:00Z', source: 'adda' },
      ],
      now
    )
    expect(out.members).toBe(2)
    expect(out.membersToday).toBe(1)
    // One account can appear under several features — the split must not be
    // read as a total
    expect(out.membersBySource.click).toBe(1)
    expect(out.membersBySource.blog).toBe(1)
    expect(out.membersBySource.adda).toBe(1)
  })

  it('separates "new today" from "active today"', () => {
    const out = countMembers(
      [
        { email: 'old@x.com', ts: '2026-01-01T00:00:00Z', source: 'click' },
        { email: 'old@x.com', ts: now.toISOString(), source: 'click' },
        { email: 'fresh@x.com', ts: now.toISOString(), source: 'blog' },
      ],
      now
    )
    expect(out.membersToday).toBe(2)
    expect(out.newMembersToday).toBe(1)
  })

  it('ignores rows with no verified email', () => {
    const out = countMembers(
      [
        { email: null, ts: now.toISOString(), source: 'click' },
        { email: '  ', ts: now.toISOString(), source: 'click' },
      ],
      now
    )
    expect(out.members).toBe(0)
  })

  it('never returns an email', () => {
    const out = countMembers([{ email: 'secret@x.com', ts: now.toISOString(), source: 'click' }], now)
    expect(JSON.stringify(out)).not.toContain('secret@x.com')
  })
})

// ---------------------------------------------------------------- access control

describe('isOwnerEmail', () => {
  it('fails closed when no owner is configured', () => {
    expect(isOwnerEmail('me@x.com', undefined)).toBe(false)
    expect(isOwnerEmail('me@x.com', '')).toBe(false)
    expect(isOwnerEmail('me@x.com', '   ')).toBe(false)
  })

  it('accepts a comma-separated list, case- and space-insensitively', () => {
    expect(isOwnerEmail('Me@X.com', 'other@x.com, me@x.com')).toBe(true)
    expect(isOwnerEmail(' me@x.com ', 'me@x.com')).toBe(true)
  })

  it('rejects everyone else, including an empty caller', () => {
    expect(isOwnerEmail('someone@x.com', 'me@x.com')).toBe(false)
    expect(isOwnerEmail(undefined, 'me@x.com')).toBe(false)
    expect(isOwnerEmail('', 'me@x.com')).toBe(false)
  })
})

// ---------------------------------------------------------------- visitor content

describe('buildPost', () => {
  const good = {
    title: 'Worth the ticket',
    body: 'Genuinely good second half.',
    tag: { kind: 'movie', id: 'tmdb-1', label: 'Some Film' },
  }

  it('rejects anything missing its title, body or tag', () => {
    expect(buildPost({ ...good, title: '' })).toBeNull()
    expect(buildPost({ ...good, body: '   ' })).toBeNull()
    expect(buildPost({ ...good, tag: { kind: 'movie', label: '' } })).toBeNull()
    expect(buildPost(undefined)).toBeNull()
    expect(buildPost({})).toBeNull()
  })

  it('rejects a tag kind that is not movie or match', () => {
    expect(buildPost({ ...good, tag: { ...good.tag, kind: 'song' } })).toBeNull()
  })

  it('keeps the display name self-chosen, falling back to Google then Anonymous', () => {
    expect(buildPost(good)!.author).toBe('Anonymous')
    expect(buildPost({ ...good, author: 'Ravi' })!.author).toBe('Ravi')
    expect(buildPost(good, { email: 'g@x.com', name: 'Google Name', picture: '' })!.author).toBe('Google Name')
    expect(buildPost({ ...good, author: 'Ravi' }, { email: 'g@x.com', name: 'Google Name', picture: '' })!.author).toBe(
      'Ravi'
    )
  })

  it('caps the fields so one post cannot be a payload', () => {
    const post = buildPost({ ...good, title: 'x'.repeat(500), body: 'y'.repeat(9000) })!
    expect(post.title.length).toBeLessThanOrEqual(120)
    expect(post.body.length).toBeLessThanOrEqual(5000)
  })
})

// ---------------------------------------------------------------- urls

describe('titleUrl', () => {
  it('slugs the title and keeps the id as the lookup key', () => {
    expect(titleUrl({ id: 'tmdb-42', title: 'Oh Sukumari!' })).toBe('/movie/tmdb-42/oh-sukumari')
  })

  it('survives a title with no latin characters', () => {
    expect(titleUrl({ id: 'x', title: 'అమితా' })).toMatch(/^\/movie\/x\//)
  })
})

describe('buildArticle', () => {
  const ok = { title: 'The 1983 final', body: 'Sixty overs and no chance.', topic: 'match' }

  it('accepts an article with no tag — that is the whole point of one', () => {
    const a = buildArticle(ok)!
    expect(a.topic).toBe('match')
    expect(a.author).toBe('Anonymous')
    expect(a.id.startsWith('a-')).toBe(true)
  })

  it('rejects a missing or invented topic, so the rail can always group it', () => {
    expect(buildArticle({ ...ok, topic: undefined })).toBeNull()
    expect(buildArticle({ ...ok, topic: 'politics' })).toBeNull()
  })

  it('rejects an empty title or body', () => {
    expect(buildArticle({ ...ok, title: '   ' })).toBeNull()
    expect(buildArticle({ ...ok, body: '' })).toBeNull()
  })

  it('keeps the writer email server-side but records it', () => {
    const a = buildArticle(ok, { email: 'r@example.com', name: 'Ravi' } as never)!
    expect(a.authorEmail).toBe('r@example.com')
    expect(publicArticle(a)).not.toHaveProperty('authorEmail')
  })

  it('keeps attached films, on a cricket article too', () => {
    // The 1983 piece is filed under cricket and still points at the film of it
    const a = buildArticle({
      ...ok,
      films: [{ title: '83', platforms: ['Netflix', 'Netflix', 'ZEE5'] }],
    })!
    // Bare strings still accepted — the shape the picker sent before deep links
    expect(a.films).toEqual([{ title: '83', platforms: [{ name: 'Netflix' }, { name: 'ZEE5' }] }])
  })

  it('keeps a deep link, and refuses one that is not https', () => {
    const a = buildArticle({
      ...ok,
      films: [
        {
          title: 'RRR',
          platforms: [
            { name: 'Netflix', url: 'https://www.netflix.com/in/title/81476453' },
            // eslint-disable-next-line no-script-url
            { name: 'ZEE5', url: 'javascript:alert(1)' },
          ],
        },
      ],
    })!
    expect(a.films![0].platforms).toEqual([
      { name: 'Netflix', url: 'https://www.netflix.com/in/title/81476453' },
      { name: 'ZEE5' },
    ])
  })

  it('drops a film with no name, and caps how many can ride along', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `F${i}`, platforms: [] }))
    expect(buildArticle({ ...ok, films: [{ platforms: ['Netflix'] }] })!.films).toBeUndefined()
    expect(buildArticle({ ...ok, films: many })!.films).toHaveLength(6)
  })

  /**
   * The cover ends up in an <img src>, and it reaches the server through the
   * browser like any other field — so it is input, not a value we can trust
   * because we happen to have generated it a moment earlier.
   */
  describe('the cover image', () => {
    it('keeps a local upload path and an https URL', () => {
      expect(buildArticle({ ...ok, image: '/api/articles/image/abc123.jpg' })!.image).toBe(
        '/api/articles/image/abc123.jpg'
      )
      expect(buildArticle({ ...ok, image: 'https://cdn.example.com/a.png' })!.image).toBe(
        'https://cdn.example.com/a.png'
      )
    })

    it('drops anything that could execute or smuggle a payload', () => {
      // eslint-disable-next-line no-script-url
      for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://x/a.png', '/etc/passwd', '../secret']) {
        expect(buildArticle({ ...ok, image: bad })!.image).toBeUndefined()
      }
    })

    it('refuses a path that tries to climb out of the upload folder', () => {
      expect(
        buildArticle({ ...ok, image: '/api/articles/image/../../../../.env' })!.image
      ).toBeUndefined()
    })

    it('keeps a focal point and a fit chosen after upload', () => {
      const a = buildArticle({
        ...ok,
        image: '/api/articles/image/a.jpg',
        imagePosition: '40% 25%',
        imageFit: 'contain',
      })!
      expect(a.imagePosition).toBe('40% 25%')
      expect(a.imageFit).toBe('contain')
    })

    it('clamps a focal point and ignores a malformed one', () => {
      const framed = (imagePosition: unknown) =>
        buildArticle({ ...ok, image: '/api/articles/image/a.jpg', imagePosition })!.imagePosition
      expect(framed('900% 12%')).toBe('100% 12%')
      expect(framed('half way')).toBeUndefined()
      expect(framed('30%')).toBeUndefined()
    })

    it('drops framing when there is no picture to frame', () => {
      const a = buildArticle({ ...ok, imagePosition: '10% 10%', imageFit: 'contain' })!
      expect(a.imagePosition).toBeUndefined()
      expect(a.imageFit).toBeUndefined()
    })

    it('accepts only the five image types, whatever charset rides along', () => {
      expect(imageExtension('image/jpeg')).toBe('jpg')
      expect(imageExtension('image/PNG')).toBe('png')
      expect(imageExtension('image/webp; charset=binary')).toBe('webp')
      expect(imageExtension('image/avif')).toBe('avif')
      expect(imageExtension('image/svg+xml')).toBeNull()
      expect(imageExtension('text/html')).toBeNull()
      expect(imageExtension(undefined)).toBeNull()
    })
  })

  it('gives an article room to be an essay', () => {
    const a = buildArticle({ ...ok, body: 'x'.repeat(30000) })!
    expect(a.body.length).toBe(20000)
  })
})

/**
 * The stamp says "the site wrote this". It is worth only as much as the thing
 * it reads, so it reads the verified email — never the author field, which is
 * typed and therefore evidence of nothing.
 */
describe('the WeekAdda byline', () => {
  const ok = { title: 'The 1983 final', body: 'Sixty overs and no chance.', topic: 'match' }
  const owner = { email: 'owner@example.com', name: 'Owner' } as never
  const visitor = { email: 'someone@example.com', name: 'Ravi' } as never

  it('stamps an article published from the owner account', () => {
    const a = buildArticle({ ...ok, author: 'WeekAdda' }, owner, 'owner@example.com')!
    expect(a.official).toBe(true)
    expect(a.author).toBe('WeekAdda')
  })

  it('can be declined by the owner, for a piece written personally', () => {
    const a = buildArticle(
      { ...ok, author: 'Hemanth', official: false },
      owner,
      'owner@example.com'
    )!
    expect(a.official).toBeUndefined()
    expect(a.author).toBe('Hemanth')
  })

  it('cannot be claimed by asking for it in the body', () => {
    const a = buildArticle({ ...ok, official: true }, visitor, 'owner@example.com')!
    expect(a.official).toBeUndefined()
  })

  it('cannot be worn by typing the name as a display name', () => {
    const a = buildArticle({ ...ok, author: 'WeekAdda' }, visitor, 'owner@example.com')!
    expect(a.official).toBeUndefined()
    expect(a.author).toBe('Ravi')
    // spacing and case are not a way around it either
    expect(buildArticle({ ...ok, author: 'week adda' }, visitor, 'owner@example.com')!.author).toBe(
      'Ravi'
    )
  })

  it('credits the Google account name when the writer chose none', () => {
    // Blank, whitespace, or the field simply absent — all mean "use my name"
    for (const author of ['', '   ', undefined]) {
      expect(buildArticle({ ...ok, author }, visitor, 'owner@example.com')!.author).toBe('Ravi')
    }
    // and a review is credited the same way
    expect(
      buildPost(
        { title: 'Good', body: 'Worth it.', tag: { kind: 'movie', label: 'X' } },
        visitor,
        'owner@example.com'
      )!.author
    ).toBe('Ravi')
  })

  it('falls back to Anonymous only when there is no Google name either', () => {
    const nameless = { email: 'x@example.com' } as never
    expect(buildArticle(ok, nameless)!.author).toBe('Anonymous')
  })

  it('falls back to Anonymous when the Google name is the reserved one', () => {
    const impostor = { email: 'x@example.com', name: 'WeekAdda' } as never
    expect(buildArticle(ok, impostor, 'owner@example.com')!.author).toBe('Anonymous')
  })

  it('reserves the name on reviews too, which carry no stamp of their own', () => {
    const post = buildPost(
      { title: 'Good', body: 'Worth it.', author: 'WeekAdda', tag: { kind: 'movie', label: 'X' } },
      visitor,
      'owner@example.com'
    )!
    expect(post.author).toBe('Ravi')
  })

  it('stamps nothing when no owner is configured — it fails closed', () => {
    expect(buildArticle(ok, owner, undefined)!.official).toBeUndefined()
  })
})

/**
 * Editing is the first thing on this site that can destroy someone's work, so
 * the rules are asserted rather than assumed: only the verified writer, and an
 * edit changes what a piece says, never who published it.
 */
describe('editing an article', () => {
  const stored = buildArticle(
    { title: 'The 1983 final', body: 'Sixty overs.', topic: 'match', author: 'WeekAdda' },
    { email: 'owner@example.com', name: 'Owner' } as never,
    'owner@example.com'
  )!

  it('lets the verified writer edit, and nobody else', () => {
    expect(canEditArticle(stored, 'owner@example.com')).toBe(true)
    expect(canEditArticle(stored, 'someone@example.com')).toBe(false)
    expect(canEditArticle(stored, undefined)).toBe(false)
  })

  it('never lets an anonymous article be claimed', () => {
    const anon = buildArticle({ title: 'T', body: 'Body here.', topic: 'movie' })!
    expect(anon.authorEmail).toBeUndefined()
    expect(canEditArticle(anon, 'anyone@example.com')).toBe(false)
  })

  it('keeps identity while changing the writing', () => {
    const edited = applyArticleEdit(stored, {
      title: 'A better title',
      body: 'Rewritten entirely.',
      topic: 'movie',
    })!
    expect(edited.title).toBe('A better title')
    expect(edited.topic).toBe('movie')
    // identity is not editable
    expect(edited.id).toBe(stored.id)
    expect(edited.ts).toBe(stored.ts)
    expect(edited.author).toBe('WeekAdda')
    expect(edited.authorEmail).toBe('owner@example.com')
    expect(edited.official).toBe(true)
  })

  it('cannot be used to steal the byline or the stamp', () => {
    const edited = applyArticleEdit(stored, {
      title: 'T',
      body: 'Body here.',
      topic: 'match',
      author: 'Someone Else',
      official: false,
      authorEmail: 'thief@example.com',
      id: 'a-other',
    })!
    expect(edited.author).toBe('WeekAdda')
    expect(edited.official).toBe(true)
    expect(edited.authorEmail).toBe('owner@example.com')
    expect(edited.id).toBe(stored.id)
  })

  it('actually removes a cover or a film that was cleared', () => {
    const withExtras = applyArticleEdit(stored, {
      title: 'T',
      body: 'Body here.',
      topic: 'match',
      image: '/api/articles/image/a.jpg',
      imagePosition: '10% 10%',
      films: [{ title: '83', platforms: [{ name: 'Netflix' }] }],
    })!
    expect(withExtras.image).toBeTruthy()
    const cleared = applyArticleEdit(withExtras, { title: 'T', body: 'Body here.', topic: 'match' })!
    expect(cleared.image).toBeUndefined()
    expect(cleared.imagePosition).toBeUndefined()
    expect(cleared.films).toBeUndefined()
  })

  it('refuses an edit that would empty the article', () => {
    expect(applyArticleEdit(stored, { title: '', body: 'x', topic: 'match' })).toBeNull()
    expect(applyArticleEdit(stored, { title: 'T', body: '', topic: 'match' })).toBeNull()
    expect(applyArticleEdit(stored, { title: 'T', body: 'x', topic: 'politics' })).toBeNull()
  })
})

describe('editing a review', () => {
  const stored = buildPost(
    {
      title: 'Worth the ticket',
      body: 'The second half earns it.',
      author: 'Ravi',
      tag: { kind: 'movie', id: 'n1', label: 'Netflix One' },
    },
    { email: 'ravi@example.com', name: 'Ravi' } as never
  )!

  it('lets the verified writer edit, and nobody else', () => {
    expect(canEditPost(stored, 'ravi@example.com')).toBe(true)
    expect(canEditPost(stored, 'someone@example.com')).toBe(false)
    expect(canEditPost(stored, undefined)).toBe(false)
  })

  it('never lets an anonymous review be claimed', () => {
    const anon = buildPost({
      title: 'T',
      body: 'Body here.',
      tag: { kind: 'movie', label: 'X' },
    })!
    expect(anon.authorEmail).toBeUndefined()
    expect(canEditPost(anon, 'anyone@example.com')).toBe(false)
  })

  it('keeps identity while changing the writing and the tag', () => {
    const edited = applyPostEdit(stored, {
      title: 'Actually, no',
      body: 'Changed my mind entirely.',
      tag: { kind: 'match', id: 'm1', label: 'India vs Zimbabwe' },
    })!
    expect(edited.title).toBe('Actually, no')
    expect(edited.tag.kind).toBe('match')
    expect(edited.id).toBe(stored.id)
    expect(edited.ts).toBe(stored.ts)
    expect(edited.author).toBe('Ravi')
    expect(edited.authorEmail).toBe('ravi@example.com')
  })

  it('cannot be used to reassign the review to somebody else', () => {
    const edited = applyPostEdit(stored, {
      title: 'T',
      body: 'Body here.',
      author: 'Thief',
      authorEmail: 'thief@example.com',
      id: 'p-other',
      tag: { kind: 'movie', label: 'X' },
    })!
    expect(edited.author).toBe('Ravi')
    expect(edited.authorEmail).toBe('ravi@example.com')
    expect(edited.id).toBe(stored.id)
  })

  it('refuses an edit that would leave it untagged or empty', () => {
    expect(applyPostEdit(stored, { title: 'T', body: 'x' })).toBeNull()
    expect(applyPostEdit(stored, { title: '', body: 'x', tag: { kind: 'movie', label: 'X' } })).toBeNull()
  })
})

describe('relatedReviews', () => {
  const review = (id: string, tagId: string, ts: string) => ({
    id,
    ts,
    author: 'Ravi',
    title: id,
    body: 'x',
    tag: { kind: 'movie' as const, id: tagId, label: tagId, sub: '', poster: null },
  })
  const all = [
    review('p1', 'film-a', '2026-03-01T00:00:00Z'),
    review('p2', 'film-b', '2026-04-01T00:00:00Z'),
    review('p3', 'film-a', '2026-05-01T00:00:00Z'),
    review('p4', 'film-b', '2026-06-01T00:00:00Z'),
  ]

  it('puts other takes on the same title first, and never the review itself', () => {
    const out = relatedReviews(all, 'p1').map((p) => p.id)
    expect(out[0]).toBe('p3')
    expect(out).not.toContain('p1')
  })

  it('tops up from everything else rather than showing a short row', () => {
    expect(relatedReviews(all, 'p1').map((p) => p.id)).toEqual(['p3', 'p4', 'p2'])
  })

  it('still returns something for an id it does not hold', () => {
    expect(relatedReviews(all, 'gone')).toHaveLength(4)
  })
})

describe('summarizeLikes', () => {
  const rows = [
    { articleId: 'a1', userEmail: 'x@example.com' },
    { articleId: 'a1', userEmail: 'y@example.com' },
    { articleId: 'a2', userEmail: 'x@example.com' },
  ]

  it('counts hearts per article', () => {
    const out = summarizeLikes(rows)
    expect(out.a1.count).toBe(2)
    expect(out.a2.count).toBe(1)
  })

  it('says which are yours only when it knows who is asking', () => {
    expect(summarizeLikes(rows).a1.mine).toBeUndefined()
    expect(summarizeLikes(rows, 'x@example.com').a1.mine).toBe(true)
    expect(summarizeLikes(rows, 'z@example.com').a1.mine).toBeUndefined()
  })

  it('never leaks who liked what — counts only', () => {
    expect(JSON.stringify(summarizeLikes(rows, 'x@example.com'))).not.toContain('@example.com')
  })
})

describe('relatedArticles', () => {
  const a = (id: string, topic: 'movie' | 'match', ts: string) => ({ id, topic, ts })
  const all = [
    a('a1', 'match', '2026-03-01T00:00:00Z'),
    a('a2', 'movie', '2026-04-01T00:00:00Z'),
    a('a3', 'match', '2026-05-01T00:00:00Z'),
    a('a4', 'movie', '2026-06-01T00:00:00Z'),
  ]

  it('puts the same topic first, newest first, and never the article itself', () => {
    const out = relatedArticles(all, 'a1').map((x) => x.id)
    expect(out[0]).toBe('a3')
    expect(out).not.toContain('a1')
  })

  it('tops up from the other topic rather than leaving the rail half empty', () => {
    // Only one other match article exists; the movie ones fill the rest
    expect(relatedArticles(all, 'a1')).toHaveLength(3)
    expect(relatedArticles(all, 'a1').map((x) => x.topic)).toEqual(['match', 'movie', 'movie'])
  })

  it('still returns something for an id it does not hold', () => {
    expect(relatedArticles(all, 'gone').map((x) => x.id)).toEqual(['a4', 'a3', 'a2', 'a1'])
  })
})

describe('reviewUrl', () => {
  it('slugs the heading and keeps the id as the lookup key', () => {
    expect(reviewUrl({ id: 'p-7', title: 'Worth the ticket!' })).toBe('/review/p-7/worth-the-ticket')
  })

  it('never collides with a title page', () => {
    expect(reviewUrl({ id: 'p-7', title: 'x' }).startsWith('/movie/')).toBe(false)
  })
})

describe('articleUrl', () => {
  it('gets its own namespace, distinct from reviews and titles', () => {
    expect(articleUrl({ id: 'a-3', title: 'My top 10 films!' })).toBe('/article/a-3/my-top-10-films')
  })
})

// ---------------------------------------------------------------- notifications

describe('buildPushSubscription', () => {
  const body = (languages: unknown) => ({
    subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } },
    languages,
  })

  it('collapses "all" to the sentinel, not to today’s list of codes', () => {
    // Storing the expansion would quietly exclude any language added later —
    // the opposite of what someone asking for everything meant
    expect(buildPushSubscription(body([ALL_LANGUAGES_CODE, 'te']))?.languages).toEqual([
      ALL_LANGUAGES_CODE,
    ])
  })

  it('keeps a normal pick as itself', () => {
    expect(buildPushSubscription(body(['te', 'ml']))?.languages).toEqual(['te', 'ml'])
  })

  it('drops codes we do not publish, and refuses a subscription to nothing', () => {
    expect(buildPushSubscription(body(['te', 'xx']))?.languages).toEqual(['te'])
    expect(buildPushSubscription(body(['xx']))).toBeNull()
    expect(buildPushSubscription(body([]))).toBeNull()
  })
})

describe('todaysReleasesFor', () => {
  // Fixed instant: 11:30 IST, far from either midnight, so the IST day is not
  // in question whatever timezone the suite runs in
  const now = new Date('2026-08-01T06:00:00Z')
  const data = cache({
    ott: [
      ott({ id: 'te-today', language: 'te', releaseDate: '2026-08-01' }),
      ott({ id: 'ml-today', language: 'ml', releaseDate: '2026-08-01' }),
      ott({ id: 'te-yesterday', language: 'te', releaseDate: '2026-07-31' }),
    ],
  })

  it('sends only what landed today, in the languages asked for', () => {
    expect(todaysReleasesFor(data, ['te'], now).map((r) => r.id)).toEqual(['te-today'])
  })

  it('takes every language for a subscriber who asked for all', () => {
    expect(todaysReleasesFor(data, [ALL_LANGUAGES_CODE], now).map((r) => r.id)).toEqual([
      'te-today',
      'ml-today',
    ])
  })

  it('still sends nothing to a subscription with no languages at all', () => {
    expect(todaysReleasesFor(data, [], now)).toEqual([])
  })
})

describe('relatedTitles', () => {
  // Each status draws from its own pool — a film in cinemas must never be
  // followed by things already streaming, which is what it used to do
  const data = cache({
    ott: [ott({ id: 'ott-now', releaseDate: iso(-2) })],
    ottUpcoming: [ott({ id: 'ott-soon', releaseDate: iso(5) })],
    releases: [
      release({ id: 'cinema-now', releaseDate: iso(-3) }),
      release({ id: 'cinema-soon', releaseDate: iso(9) }),
    ],
  })
  const subject = release({ id: 'subject' })

  it('follows a streaming title with streaming titles', () => {
    expect(todaysIds(relatedTitles(data, subject, 8, 'streaming'))).toEqual(['ott-now'])
  })

  it('follows a coming-to-OTT title with other coming-to-OTT titles', () => {
    expect(todaysIds(relatedTitles(data, subject, 8, 'upcoming-ott'))).toEqual(['ott-soon'])
  })

  it('follows a cinema release with what else is in cinemas, never with OTT', () => {
    expect(todaysIds(relatedTitles(data, subject, 8, 'in-theatres'))).toEqual(['cinema-now'])
  })

  it('follows an upcoming cinema release with the other upcoming ones', () => {
    expect(todaysIds(relatedTitles(data, subject, 8, 'upcoming-theatre'))).toEqual(['cinema-soon'])
  })

  it('never lists the title you are already reading', () => {
    const self = release({ id: 'cinema-now', releaseDate: iso(-3) })
    expect(todaysIds(relatedTitles(data, self, 8, 'in-theatres'))).toEqual([])
  })
})

// ---------------------------------------------------------------- watch log

describe('buildWatchLog', () => {
  it('takes the account from the token and never from the body', () => {
    // The whole privacy model rests on this one line: a body claiming to be
    // somebody else must not be able to write into their log
    const entry = buildWatchLog(
      { title: 'Kingdom', userEmail: 'someone.else@example.com' },
      'me@example.com'
    )
    expect(entry?.userEmail).toBe('me@example.com')
  })

  it('refuses an entry with no film and one with no account', () => {
    expect(buildWatchLog({ title: '   ' }, 'me@example.com')).toBeNull()
    expect(buildWatchLog({ title: 'Kingdom' }, '')).toBeNull()
  })

  it('falls back to today when the date is missing or unparseable', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(buildWatchLog({ title: 'X' }, 'me@x.com')?.watchedOn).toBe(today)
    expect(buildWatchLog({ title: 'X', watchedOn: 'last tuesday' }, 'me@x.com')?.watchedOn).toBe(
      today
    )
    expect(buildWatchLog({ title: 'X', watchedOn: '2026-07-04' }, 'me@x.com')?.watchedOn).toBe(
      '2026-07-04'
    )
  })

  it('drops a city on a home entry — a platform has no city', () => {
    const home = buildWatchLog(
      { title: 'X', where: 'home', venue: 'Netflix', city: 'Hyderabad' },
      'me@x.com'
    )
    expect(home?.where).toBe('home')
    expect(home?.venue).toBe('Netflix')
    expect(home?.city).toBeUndefined()
  })
})

describe('watchStats', () => {
  const log = (over: Partial<WatchLog> & { watchedOn: string }): WatchLog => ({
    id: over.watchedOn + (over.venue ?? ''),
    ts: '2026-01-01T00:00:00.000Z',
    userEmail: 'me@x.com',
    kind: 'movie',
    where: 'out',
    title: 'A film',
    ...over,
  })

  const logs = [
    log({ watchedOn: '2026-07-01', venue: 'PVR Forum' }),
    log({ watchedOn: '2026-07-08', venue: 'PVR Forum' }),
    log({ watchedOn: '2026-07-09', venue: 'AMB' }),
    log({ watchedOn: '2026-07-10', where: 'home', venue: 'Netflix' }),
    log({ watchedOn: '2025-12-30', venue: 'PVR Forum' }),
  ]

  it('counts trips, not distinct titles, and only this year', () => {
    const s = watchStats(logs, 2026)
    expect(s.watched).toBe(4)
    expect(s.out).toBe(3)
    expect(s.home).toBe(1)
  })

  it('splits films from matches — a log holds both', () => {
    const mixed = [...logs, log({ watchedOn: '2026-07-11', kind: 'match', venue: 'Uppal' })]
    const s = watchStats(mixed, 2026)
    expect(s.films).toBe(4)
    expect(s.matches).toBe(1)
    expect(s.watched).toBe(5)
  })

  it('counts theatres, never the platform watched at home', () => {
    expect(watchStats(logs, 2026).venues).toBe(2)
  })

  it('names the most-visited theatre', () => {
    expect(watchStats(logs, 2026).top).toEqual({ name: 'PVR Forum', count: 2 })
  })

  it('has no favourite when nothing is logged', () => {
    expect(watchStats([], 2026)).toEqual({
      watched: 0,
      films: 0,
      matches: 0,
      out: 0,
      home: 0,
      venues: 0,
      top: null,
    })
  })
})

describe('applyWatchLogEdit', () => {
  const existing: WatchLog = {
    id: 'w-1',
    ts: '2026-07-01T10:00:00.000Z',
    watchedOn: '2026-07-01',
    userEmail: 'me@x.com',
    kind: 'movie',
    where: 'out',
    title: 'Kingdom',
    venue: 'PVR Forum',
    city: 'Hyderabad',
    note: 'Went with Ravi',
  }

  it('never lets identity be edited, whatever the body claims', () => {
    const out = applyWatchLogEdit(existing, {
      id: 'w-someone-else',
      ts: '2020-01-01T00:00:00.000Z',
      userEmail: 'attacker@x.com',
      title: 'Changed',
    })
    expect(out.id).toBe('w-1')
    expect(out.ts).toBe(existing.ts)
    expect(out.userEmail).toBe('me@x.com')
    expect(out.title).toBe('Changed')
  })

  it('leaves out what the edit did not mention', () => {
    const out = applyWatchLogEdit(existing, { note: 'Better note' })
    expect(out.note).toBe('Better note')
    expect(out.venue).toBe('PVR Forum')
    expect(out.city).toBe('Hyderabad')
    expect(out.watchedOn).toBe('2026-07-01')
  })

  it('clears a field given an empty string, which is how removal is asked for', () => {
    expect(applyWatchLogEdit(existing, { note: '' }).note).toBeUndefined()
    expect(applyWatchLogEdit(existing, { venue: '   ' }).venue).toBeUndefined()
  })

  it('drops the city when the entry moves home — a platform has none', () => {
    const out = applyWatchLogEdit(existing, { where: 'home' })
    expect(out.where).toBe('home')
    expect(out.city).toBeUndefined()
  })

  it('keeps the old title rather than accepting a blank one', () => {
    expect(applyWatchLogEdit(existing, { title: '   ' }).title).toBe('Kingdom')
  })
})
