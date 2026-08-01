import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Search,
  Bot,
  Popcorn,
  CalendarClock,
  Sparkles,
  Film,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MonitorPlay,
} from 'lucide-react'
import { Star } from 'lucide-react'
import { api } from '../api'
import { usePageMeta, titlePath } from '../seo'
import { Release, ReleaseMeta, LanguageInfo, WeekInfo } from '../types'
import NotifyCard from '../components/NotifyCard'
import PipShow, { MAX_SLIDES } from '../components/PipShow'
import WeekTimeline from '../components/WeekTimeline'
import ReleaseCard, { coverGradient, formatDate } from '../components/ReleaseCard'
import ReleaseModal from '../components/ReleaseModal'
import { platformClass } from '../share'
import { languageLabel, releaseLanguagesOf } from '../languages'
import { useHomeLanguage, orderWithHome } from '../geo'
import PlatformLinks from '../components/PlatformLinks'

type Window = 'released' | 'ott' | 'upcoming'

/**
 * Each tab is its own URL so it can rank for its own query — /movies is about
 * this week, /movies/upcoming is about release dates, and Google can only tell
 * them apart if they are separate pages. OTT is the default and deliberately
 * has no /movies/ott alias: a second URL for the same content is duplication,
 * not coverage. See SEO-PLAN.md.
 */
const TAB_PATH: Record<Window, string> = {
  ott: '/movies',
  released: '/movies/theatres',
  upcoming: '/movies/upcoming',
}
const WINDOW_FOR_TAB: Record<string, Window> = {
  theatres: 'released',
  upcoming: 'upcoming',
}

/**
 * One title and description per URL, and they must be the same strings
 * routeMeta serves from backend/src/seo.ts.
 *
 * Two things set these tags: the Worker writes routeMeta into the HTML, which
 * is what a social scraper and a non-rendering crawler read, and then
 * usePageMeta overwrites them on mount, which is what Google's rendering pass
 * reads. If the two disagree the same URL advertises two different titles.
 *
 * Keyed on the tab alone, deliberately — week and the theatres/OTT sub-toggle
 * are not in the URL, so letting them change the title would give one address
 * several titles depending on where the visitor had clicked.
 */
const PAGE_META: Record<Window, { title: string; description: string }> = {
  ott: {
    title: 'OTT & Theatre Movie Releases This Week India | WeekAdda',
    description:
      'New OTT releases this week in India — movies & web series on Netflix, Prime Video, JioHotstar, ZEE5, Sun NXT & Aha, plus theatre and upcoming release dates.',
  },
  released: {
    title: 'New Movies in Theatres This Week India | WeekAdda',
    description:
      'Movies released in cinemas across India this week — Telugu, Hindi, Tamil, Malayalam, Kannada and English — plus the theatre release dates coming next.',
  },
  upcoming: {
    title: 'Upcoming Movies & OTT Releases in India — Release Dates | WeekAdda',
    description:
      'Upcoming movie release dates in India — theatre releases and upcoming OTT releases & web series, with the streaming platform where confirmed. Updated daily.',
  },
}

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function shortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function weekTitle(index: number) {
  if (index === 0) return 'This Week'
  if (index === 1) return 'Last Week'
  return `${index} Weeks Ago`
}

export default function Releases() {
  const { tab } = useParams<{ tab?: string }>()
  const windowTab: Window = (tab && WINDOW_FOR_TAB[tab]) || 'ott'
  // Remembered too — it is the same page and the same kind of choice as the
  // language filter and the source toggle below, and a control that forgets
  // while the two beside it remember reads as a bug. Applies to both the OTT
  // week view and upcoming-on-OTT, which is the one filter shared by the two.
  const [ottType, setOttType] = useState<'all' | 'movie' | 'series'>(() => {
    try {
      const saved = localStorage.getItem('weekadda-ott-type')
      return saved === 'movie' || saved === 'series' ? saved : 'all'
    } catch {
      return 'all'
    }
  })
  // Remembered like the language filter: someone who came for upcoming OTT
  // should not have to say so again after a reload. Theatres is still where a
  // first visit starts. Deliberately not in the URL — the sub-toggle must not
  // give /movies/upcoming a second address or a second title.
  const [upcomingSource, setUpcomingSource] = useState<'theatres' | 'ott'>(() => {
    try {
      return localStorage.getItem('weekadda-upcoming-source') === 'ott' ? 'ott' : 'theatres'
    } catch {
      return 'theatres'
    }
  })
  const [week, setWeek] = useState(0)
  const [weekInfo, setWeekInfo] = useState<WeekInfo | null>(null)
  const [releases, setReleases] = useState<Release[]>([])
  const [meta, setMeta] = useState<ReleaseMeta | null>(null)
  const [languages, setLanguages] = useState<LanguageInfo[]>([])
  const [search, setSearch] = useState('')
  // Remembered across visits, and settable by a notification deep-link
  // (/movies?language=te) so tapping one lands on what it was about
  const [language, setLanguage] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('language')
      return fromUrl || localStorage.getItem('weekadda-language') || 'all'
    } catch {
      return 'all'
    }
  })
  const [selected, setSelected] = useState<Release | null>(null)
  const [loading, setLoading] = useState(true)

  // Each tab opens on its own most recent week — carrying "6 weeks ago" across
  // from another tab is never what someone switching tabs means. The tab is now
  // a URL, so this replaces the reset the old tab buttons did inline.
  useEffect(() => {
    setWeek(0)
  }, [windowTab])

  // Someone who filters to Telugu every visit should not have to say so again;
  // it also pre-ticks the right box in the notification picker
  useEffect(() => {
    try {
      localStorage.setItem('weekadda-language', language)
    } catch {
      // private mode — the filter just resets next visit
    }
  }, [language])

  useEffect(() => {
    try {
      localStorage.setItem('weekadda-upcoming-source', upcomingSource)
      localStorage.setItem('weekadda-ott-type', ottType)
    } catch {
      // private mode — the toggles just reset next visit
    }
  }, [upcomingSource, ottType])

  usePageMeta(PAGE_META[windowTab].title, PAGE_META[windowTab].description)

  function load() {
    const params = new URLSearchParams({ window: windowTab })
    if (windowTab !== 'upcoming') params.set('week', String(week))
    if (windowTab === 'upcoming') params.set('source', upcomingSource)
    const ottTypeApplies =
      windowTab === 'ott' || (windowTab === 'upcoming' && upcomingSource === 'ott')
    if (ottTypeApplies && ottType !== 'all') params.set('contentType', ottType)
    if (search.trim()) params.set('search', search.trim())
    if (language !== 'all') params.set('language', language)
    return api<{
      releases: Release[]
      week: WeekInfo | null
      meta: ReleaseMeta
      languages: LanguageInfo[]
    }>(`/releases?${params}`)
      .then((res) => {
        setReleases(res.releases)
        setWeekInfo(res.week)
        setMeta(res.meta)
        setLanguages(res.languages)
      })
      .catch(console.error)
  }

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => load().finally(() => setLoading(false)), 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowTab, week, search, language, ottType, upcomingSource])

  // The visitor's own language leads when we can tell where they are
  // (Karnataka → Kannada first, Japan → Japanese, abroad → English);
  // undetected keeps the fixed order untouched.
  const homeLang = useHomeLanguage()
  const langOrder = useMemo(() => orderWithHome(homeLang), [homeLang])

  // Group by language; home language first, then the fixed order Telugu,
  // Tamil, English, Hindi, Malayalam, Kannada, then the rest largest-first.
  // A pan-India film is listed in every language it released in, not just the
  // one it was shot in — someone reading the Hindi row is exactly the person
  // who would otherwise never learn a Telugu-original film is playing in Hindi.
  // The card carries a Pan-India badge naming the original, so the repeat reads
  // as information rather than a duplicate. (To place each film once again,
  // iterate `[r.language]` here instead.)
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; items: Release[] }>()
    for (const r of releases) {
      for (const code of releaseLanguagesOf(r)) {
        if (!map.has(code)) {
          map.set(code, {
            label: code === r.language ? r.languageLabel : languageLabel(code),
            items: [],
          })
        }
        map.get(code)!.items.push(r)
      }
    }
    const rank = (code: string) => {
      const i = langOrder.indexOf(code)
      return i === -1 ? langOrder.length : i
    }
    return [...map.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => rank(a.code) - rank(b.code) || b.items.length - a.items.length)
  }, [releases, langOrder])

  const showRows = language === 'all' && !search.trim()
  const maxWeeks = weekInfo?.maxWeeks ?? 13
  const isWeekView = windowTab !== 'upcoming'

  // Filter chips follow the same home-first order as the sections
  const chipLanguages = useMemo(() => {
    const rank = (code: string) => {
      const i = langOrder.indexOf(code)
      return i === -1 ? langOrder.length : i
    }
    return [...languages].sort((a, b) => rank(a.code) - rank(b.code))
  }, [languages, langOrder])

  // Mini-player slides: this page's films, posters only, regrouped into the
  // same home-first language order (stable sort keeps the page's order within)
  const pipSlides = useMemo(() => {
    const rank = (code: string) => {
      const i = langOrder.indexOf(code)
      return i === -1 ? langOrder.length : i
    }
    return releases
      .filter((r) => r.poster)
      .sort((a, b) => rank(a.language) - rank(b.language))
      .slice(0, MAX_SLIDES)
      .map((r) => ({
        title: r.title,
        sub: `${r.languageLabel} · ${formatDate(r.releaseDate)}${
          r.platforms?.[0] ? ` · ${r.platforms[0]}` : ''
        }`,
        image: r.poster,
        href: titlePath(r),
      }))
  }, [releases, langOrder])

  // The week's biggest titles (by ratings volume) headline the page
  const heroPicks = useMemo(() => {
    if (!isWeekView || !showRows) return []
    return [...releases]
      .filter((r) => r.poster)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 4)
  }, [releases, isWeekView, showRows])

  /**
   * The badge on each pick after the first.
   *
   * Picks are ranked by TMDB vote count, so the honest claim is about how much
   * attention a title is getting — not about seats. "Fast filling" is a booking
   * term, and we hold no booking data at all: printing it would be inventing a
   * fact about a cinema we have never talked to. These say the same thing the
   * section subtitle already says, in two words.
   */
  const heroTag =
    windowTab === 'ott' ? 'Most watched' : windowTab === 'upcoming' ? 'Most awaited' : 'Trending'

  // Below 1024px the spotlight is a snap carousel — swipeable, with arrows, and
  // advancing on its own every 2s. Tablet gets it too: the four-column grid
  // squeezed each card to a strip there, and one card at a time is the whole
  // point of a "top pick". Auto-advance pauses for a while whenever the visitor
  // moves it themselves, so it never fights the hand that is using it.
  const heroRef = useRef<HTMLElement | null>(null)
  const heroTouchedAt = useRef(0)

  /** One card left or right; wraps at either end so the row has no dead stop. */
  const stepHero = (dir: 1 | -1) => {
    const el = heroRef.current
    const first = el?.children[0] as HTMLElement | undefined
    const second = el?.children[1] as HTMLElement | undefined
    if (!el || !first || !second) return
    heroTouchedAt.current = Date.now()
    const step = second.offsetLeft - first.offsetLeft
    const index = Math.round(el.scrollLeft / step)
    const last = el.children.length - 1
    const next = dir === 1 ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1
    el.scrollTo({ left: next * step, behavior: 'smooth' })
  }

  useEffect(() => {
    const el = heroRef.current
    if (!el || heroPicks.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const markTouch = () => {
      heroTouchedAt.current = Date.now()
    }
    el.addEventListener('touchstart', markTouch, { passive: true })
    el.addEventListener('pointerdown', markTouch)

    const timer = setInterval(() => {
      if (!window.matchMedia('(max-width: 1024px)').matches) return
      // Nothing moves while the tab is in the background — it would arrive back
      // on a card nobody chose, several picks from where it was left
      if (document.hidden) return
      if (Date.now() - heroTouchedAt.current < 6000) return
      stepHero(1)
      // stepHero stamps the touch clock; undo that, or the timer would consider
      // its own move a visitor's and pause for six seconds after every step
      heroTouchedAt.current = 0
    }, 2000)

    return () => {
      clearInterval(timer)
      el.removeEventListener('touchstart', markTouch)
      el.removeEventListener('pointerdown', markTouch)
    }
  }, [heroPicks, loading])

  return (
    <main>
      <section className="opp-header">
        <div>
          <span className="hero-eyebrow">
            {windowTab === 'ott' ? (
              <>
                <MonitorPlay size={13} /> Streaming across India
              </>
            ) : (
              <>
                <Popcorn size={13} /> Fresh from the box office
              </>
            )}
          </span>
          <h1 className="sr-only">
            {windowTab === 'upcoming'
              ? upcomingSource === 'ott'
                ? 'Coming Soon on OTT'
                : 'Coming Soon'
              : windowTab === 'ott'
                ? `OTT · ${weekTitle(week)}`
                : weekTitle(week)}
          </h1>
          <p>
            {windowTab === 'ott'
              ? 'Movies and web series that just arrived on JioHotstar, Prime Video, Netflix, Sony LIV, ZEE5 and Aha — swept daily, laid out language by language, week by week.'
              : windowTab === 'upcoming' && upcomingSource === 'ott'
                ? 'Digital premieres announced for the next 90 days — platform-tagged where known, plus India digital releases whose platform is yet to be announced.'
                : 'Movie releases from every region and language — swept daily by the WeekAdda agent and laid out language by language, one week at a time.'}
          </p>
          {/* Wayfinding, so it sits with the intro copy rather than in the
              toolbar competing with the filters */}
          {windowTab === 'ott' && <PlatformLinks />}
        </div>
        <div className="agent-panel">
          <div className={`agent-chip${meta?.source === 'sample' ? ' sample' : ''}`}>
            <Bot size={15} />
            <span>
              {meta ? (
                meta.source === 'tmdb' ? (
                  <>
                    {/* The relative wording is for people; the dateTime attribute is
                        the only unambiguous "this page is from today" on the page.
                        Without it Google dated the homepage from the film release
                        dates in the markup and showed "4 days ago" on a site whose
                        whole pitch is being current. */}
                    Agent synced <time dateTime={meta.fetchedAt}>{timeAgo(meta.fetchedAt)}</time> ·{' '}
                    {meta.total} films · daily at 6 AM
                  </>
                ) : (
                  'Sample data · add a free TMDB key for live daily releases'
                )
              ) : (
                'Agent status…'
              )}
            </span>
          </div>
        </div>
      </section>

      <div className="opp-tabs">
        <Link to={TAB_PATH.ott} className={windowTab === 'ott' ? 'active' : ''}>
          <span className="tab-ico ico-ott">
            <MonitorPlay size={15} />
          </span>
          OTT India
        </Link>
        <Link to={TAB_PATH.released} className={windowTab === 'released' ? 'active' : ''}>
          <span className="tab-ico ico-theatre">
            <Sparkles size={15} />
          </span>
          In Theatres
        </Link>
        <Link to={TAB_PATH.upcoming} className={windowTab === 'upcoming' ? 'active' : ''}>
          <span className="tab-ico ico-soon">
            <CalendarClock size={15} />
          </span>
          Coming Soon
        </Link>
      </div>

      {/* Floating mini-player launcher — fixed bottom-right, above the grid */}
      <PipShow
        slides={pipSlides}
        noun="films"
          context={{
            tab:
              windowTab === 'ott'
                ? 'OTT India'
                : windowTab === 'released'
                  ? 'In Theatres'
                  : 'Coming Soon',
            detail:
              windowTab === 'upcoming'
                ? upcomingSource === 'ott'
                  ? 'On OTT'
                  : 'In Theatres'
                : weekInfo
                  ? `${weekTitle(week)} · ${shortDate(weekInfo.from)} – ${shortDate(weekInfo.to)}`
                  : weekTitle(week),
          }}
          weekJumps={
            isWeekView
              ? [
                  ...(week > 0
                    ? [
                        {
                          label: weekTitle(week - 1),
                          dir: 'newer' as const,
                          go: () => setWeek((w) => Math.max(0, w - 1)),
                        },
                      ]
                    : []),
                  ...(week < maxWeeks - 1
                    ? [
                        {
                          label: weekTitle(week + 1),
                          dir: 'older' as const,
                          go: () => setWeek((w) => Math.min(maxWeeks - 1, w + 1)),
                        },
                      ]
                    : []),
                ]
              : undefined
          }
        />

      {isWeekView && (
        <div className="week-nav">
          <button
            className="week-arrow"
            onClick={() => setWeek((w) => Math.min(w + 1, maxWeeks - 1))}
            disabled={week >= maxWeeks - 1}
            title="Older week"
          >
            <ChevronLeft size={19} />
          </button>

          <div className="week-label">
            <h3>{weekTitle(week)}</h3>
            {weekInfo && (
              <span>
                <CalendarDays size={13} /> {shortDate(weekInfo.from)} — {shortDate(weekInfo.to)}
              </span>
            )}
          </div>

          <button
            className="week-arrow"
            onClick={() => setWeek((w) => Math.max(w - 1, 0))}
            disabled={week <= 0}
            title="Newer week"
          >
            <ChevronRight size={19} />
          </button>

          <WeekTimeline weeks={maxWeeks} week={week} onPick={setWeek} />
        </div>
      )}

      {!loading && heroPicks.length >= 3 && (
        <div className="spotlight-head">
          <h2>
            <Star size={16} fill="currentColor" /> Top Picks · {weekTitle(week)}
          </h2>
          <span>
            {windowTab === 'ott'
              ? 'The most talked-about OTT arrivals of the week'
              : 'The most talked-about releases of the week'}
          </span>
        </div>
      )}
      {!loading && heroPicks.length >= 3 && (
        <div className="hero-wrap">
          {/* Shown only where the section is a carousel — on the desktop grid
              every pick is already on screen and there is nothing to step
              through. Hidden from screen readers: the cards are all in the DOM
              and reachable by tab, so these are a pointer convenience, not a
              second way to navigate. */}
          <button
            className="hero-arrow prev"
            onClick={() => stepHero(-1)}
            aria-hidden="true"
            tabIndex={-1}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="hero-arrow next"
            onClick={() => stepHero(1)}
            aria-hidden="true"
            tabIndex={-1}
          >
            <ChevronRight size={20} />
          </button>
        <section className="hero-spotlight" aria-label="Top picks" ref={heroRef}>
          {heroPicks.map((r, i) => (
            <article
              key={r.id}
              className={`hero-card${i === 0 ? ' big' : ''}`}
              style={{ animationDelay: `${i * 70}ms` }}
              onClick={() => setSelected(r)}
            >
              <div
                className="hero-bg"
                style={
                  r.poster
                    ? { backgroundImage: `url(${r.poster})` }
                    : { background: coverGradient(r.title) }
                }
              />
              {i === 0 ? (
                <div className="hero-big-inner">
                  <img className="hero-poster" src={r.poster!} alt={r.title} />
                  <div className="hero-text">
                    <span className="hero-toplabel">
                      <Star size={12} fill="currentColor" /> #1 pick · {weekTitle(week)}
                    </span>
                    <h3>{r.title}</h3>
                    <p className="hero-overview">{r.overview}</p>
                    <div className="hero-chips">
                      {r.rating > 0 && (
                        <span className="hero-chip gold">★ {r.rating.toFixed(1)}</span>
                      )}
                      <span className="hero-chip">{r.languageLabel}</span>
                      <span className="hero-chip">{formatDate(r.releaseDate)}</span>
                      {r.platforms?.[0] && (
                        <span className={`hero-chip pf ${platformClass(r.platforms[0])}`}>
                          {r.platforms[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <img className="hero-fill" src={r.poster!} alt={r.title} loading="lazy" />
                  <span className="hero-tag">{heroTag}</span>
                  <div className="hero-overlay">
                    <h4>{r.title}</h4>
                    <span>
                      {r.rating > 0 ? `★ ${r.rating.toFixed(1)} · ` : ''}
                      {r.platforms?.[0] ?? r.languageLabel}
                    </span>
                  </div>
                </>
              )}
            </article>
          ))}
        </section>
        </div>
      )}

      <div className="toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search films, languages, stories…"
          />
        </div>
        {windowTab === 'upcoming' && (
          <div className="genre-row">
            {(
              [
                ['theatres', 'In Theatres'],
                ['ott', 'On OTT'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${upcomingSource === value ? ' active' : ''}`}
                onClick={() => setUpcomingSource(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {(windowTab === 'ott' || (windowTab === 'upcoming' && upcomingSource === 'ott')) && (
          <div className="genre-row">
            {(
              [
                ['all', 'All'],
                ['movie', 'Movies'],
                ['series', 'Web Series'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${ottType === value ? ' active' : ''}`}
                onClick={() => setOttType(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="toolbar" style={{ paddingTop: 0 }}>
        <div className="genre-row">
          <button
            className={`genre-chip${language === 'all' ? ' active' : ''}`}
            onClick={() => setLanguage('all')}
          >
            All languages
          </button>
          <button
            className={`genre-chip${language === 'pan' ? ' active' : ''}`}
            onClick={() => setLanguage('pan')}
            title="Films released in several languages at once"
          >
            Pan-India
          </button>
          {chipLanguages.map((l) => (
            <button
              key={l.code}
              className={`genre-chip${language === l.code ? ' active' : ''}`}
              onClick={() => setLanguage(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="lang-sections" aria-hidden>
          {[0, 1].map((s) => (
            <section key={s} className="lang-section">
              <div className="lang-head">
                <div className="sk sk-line" style={{ width: 120 }} />
              </div>
              <div className="lang-row">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="sk sk-poster" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : releases.length === 0 ? (
        <div className="empty-state">
          <Film size={54} />
          <h3>Nothing on the reel</h3>
          <p>
            {isWeekView
              ? `No releases found for ${weekTitle(week).toLowerCase()}${
                  language !== 'all' ? ' in this language' : ''
                }. Try another week or language.`
              : 'No upcoming films match. Try another language or clear your search.'}
          </p>
        </div>
      ) : showRows ? (
        // Language-segregated rows
        <div className="lang-sections">
          {sections.map((section, si) => (
            <Fragment key={section.code}>
              <section className="lang-section">
                <div className="lang-head">
                  <h2>{section.label}</h2>
                  <span className="count">
                    {section.items.length} film{section.items.length === 1 ? '' : 's'}
                  </span>
                  <button className="lang-viewall" onClick={() => setLanguage(section.code)}>
                    View all →
                  </button>
                </div>
                <div className="lang-row">
                  {section.items.map((r, i) => (
                    <ReleaseCard
                      key={r.id}
                      release={r}
                      index={i}
                      onOpen={setSelected}
                      contextLanguage={section.code}
                    />
                  ))}
                </div>
              </section>
              {/* After the first row, where the reader has just shown which
                  language they care about — and named back to them */}
              {si === 0 && <NotifyCard language={section.code} label={section.label} />}
            </Fragment>
          ))}
        </div>
      ) : (
        // Filtered view: grid
        <>
          <div className="section-head">
            <h2>
              {language !== 'all'
                ? languages.find((l) => l.code === language)?.label ?? 'Films'
                : 'Results'}
            </h2>
            <span className="count">
              {releases.length} film{releases.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="release-grid">
            {releases.map((r, i) => (
              <ReleaseCard
                key={r.id}
                release={r}
                index={i}
                onOpen={setSelected}
                // In the filtered grid the chosen language is the context; under
                // "Pan-India" or a search there is none, so the original stands
                contextLanguage={language !== 'all' && language !== 'pan' ? language : undefined}
              />
            ))}
          </div>
        </>
      )}

      {selected && <ReleaseModal release={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
