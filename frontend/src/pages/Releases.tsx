import { useEffect, useMemo, useState } from 'react'
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
import { api } from '../api'
import { usePageMeta } from '../seo'
import { Release, ReleaseMeta, LanguageInfo, WeekInfo } from '../types'
import ReleaseCard from '../components/ReleaseCard'
import ReleaseModal from '../components/ReleaseModal'

type Window = 'released' | 'ott' | 'upcoming'

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
  const [windowTab, setWindowTab] = useState<Window>('released')
  const [ottType, setOttType] = useState<'all' | 'movie' | 'series'>('all')
  const [upcomingSource, setUpcomingSource] = useState<'theatres' | 'ott'>('theatres')
  const [week, setWeek] = useState(0)
  const [weekInfo, setWeekInfo] = useState<WeekInfo | null>(null)
  const [releases, setReleases] = useState<Release[]>([])
  const [meta, setMeta] = useState<ReleaseMeta | null>(null)
  const [languages, setLanguages] = useState<LanguageInfo[]>([])
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('all')
  const [selected, setSelected] = useState<Release | null>(null)
  const [loading, setLoading] = useState(true)

  usePageMeta(
    windowTab === 'ott'
      ? 'New OTT Releases India This Week — Netflix, Prime Video, JioHotstar, ZEE5 | WeekAdda'
      : windowTab === 'upcoming'
        ? upcomingSource === 'ott'
          ? 'Upcoming OTT Releases India — Digital Premiere Dates | WeekAdda'
          : 'Upcoming Movies in India — Theatre Release Dates | WeekAdda'
        : week === 0
          ? 'New Movie Releases This Week by Language — Hindi, Telugu, Tamil & More | WeekAdda'
          : `Movie Releases ${weekTitle(week)} by Language | WeekAdda`,
    windowTab === 'ott'
      ? 'Movies and web series that just arrived on Netflix, Amazon Prime Video, JioHotstar, Sony LIV, ZEE5 and Aha in India — updated daily, browsable week by week.'
      : windowTab === 'upcoming'
        ? 'Upcoming movie and OTT release dates in India across every language — updated daily by the WeekAdda agent.'
        : 'This week\'s new movie releases in Hindi, Telugu, Tamil, Malayalam, Kannada, English and more — with ratings, posters and 13 weeks of history.'
  )

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

  // Group by language; Telugu always leads, then largest sections first
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; items: Release[] }>()
    for (const r of releases) {
      if (!map.has(r.language)) map.set(r.language, { label: r.languageLabel, items: [] })
      map.get(r.language)!.items.push(r)
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
          <h1>
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
              {meta
                ? meta.source === 'tmdb'
                  ? `Agent synced ${timeAgo(meta.fetchedAt)} · ${meta.total} films · daily at 6 AM`
                  : 'Sample data · add a free TMDB key for live daily releases'
                : 'Agent status…'}
            </span>
          </div>
        </div>
      </section>

      <div className="opp-tabs">
        <button
          className={windowTab === 'released' ? 'active' : ''}
          onClick={() => {
            setWindowTab('released')
            setWeek(0)
          }}
        >
          <Sparkles size={15} /> In Theatres
        </button>
        <button
          className={windowTab === 'ott' ? 'active' : ''}
          onClick={() => {
            setWindowTab('ott')
            setWeek(0)
          }}
        >
          <MonitorPlay size={15} /> OTT India
        </button>
        <button
          className={windowTab === 'upcoming' ? 'active' : ''}
          onClick={() => setWindowTab('upcoming')}
        >
          <CalendarClock size={15} /> Coming Soon
        </button>
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

      {!loading && releases.length === 0 ? (
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
          {sections.map((section) => (
            <section key={section.code} className="lang-section">
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
                  <ReleaseCard key={r.id} release={r} index={i} onOpen={setSelected} />
                ))}
              </div>
            </section>
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
              <ReleaseCard key={r.id} release={r} index={i} onOpen={setSelected} />
            ))}
          </div>
        </>
      )}

      {selected && <ReleaseModal release={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
