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
import { usePageMeta } from '../seo'
import { Release, ReleaseMeta, LanguageInfo, WeekInfo } from '../types'
import NotifyCard from '../components/NotifyCard'
import ReleaseCard, { coverGradient, formatDate } from '../components/ReleaseCard'
import ReleaseModal from '../components/ReleaseModal'
import { platformClass } from '../share'
import { languageLabel, releaseLanguagesOf } from '../languages'

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
  const [ottType, setOttType] = useState<'all' | 'movie' | 'series'>('all')
  const [upcomingSource, setUpcomingSource] = useState<'theatres' | 'ott'>('theatres')
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

  // Group by language; Telugu always leads, then largest sections first.
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
    return [...map.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort(
        (a, b) =>
          Number(b.code === 'te') - Number(a.code === 'te') || b.items.length - a.items.length
      )
  }, [releases])

  const showRows = language === 'all' && !search.trim()
  const maxWeeks = weekInfo?.maxWeeks ?? 13
  const isWeekView = windowTab !== 'upcoming'

  // The week's biggest titles (by ratings volume) headline the page
  const heroPicks = useMemo(() => {
    if (!isWeekView || !showRows) return []
    return [...releases]
      .filter((r) => r.poster)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 4)
  }, [releases, isWeekView, showRows])

  // On phones the spotlight is a snap carousel — auto-advance it every 4s,
  // pausing for a while whenever the visitor touches it themselves
  const heroRef = useRef<HTMLElement | null>(null)
  const heroTouchedAt = useRef(0)

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
      if (!window.matchMedia('(max-width: 640px)').matches) return
      if (Date.now() - heroTouchedAt.current < 6000) return
      const first = el.children[0] as HTMLElement | undefined
      const second = el.children[1] as HTMLElement | undefined
      if (!first || !second) return
      const step = second.offsetLeft - first.offsetLeft
      const index = Math.round(el.scrollLeft / step)
      const next = index >= el.children.length - 1 ? 0 : index + 1
      el.scrollTo({ left: next * step, behavior: 'smooth' })
    }, 4000)

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
          <MonitorPlay size={15} /> OTT India
        </Link>
        <Link to={TAB_PATH.released} className={windowTab === 'released' ? 'active' : ''}>
          <Sparkles size={15} /> In Theatres
        </Link>
        <Link to={TAB_PATH.upcoming} className={windowTab === 'upcoming' ? 'active' : ''}>
          <CalendarClock size={15} /> Coming Soon
        </Link>
      </div>

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

          <div className="week-strip">
            {Array.from({ length: maxWeeks }, (_, i) => (
              <button
                key={i}
                className={`week-dot${i === week ? ' active' : ''}`}
                onClick={() => setWeek(i)}
                title={weekTitle(i)}
              />
            ))}
          </div>
          <span className="week-hint">{maxWeeks} weeks of history</span>
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
          {languages.map((l) => (
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
