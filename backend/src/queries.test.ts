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
  type ReleaseCache,
  type OttRelease,
  type Release,
  type CricketCache,
  type Click,
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
