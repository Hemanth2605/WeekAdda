import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  Bot,
  Trophy,
  CalendarClock,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  ExternalLink,
} from 'lucide-react'
import { api, trackClick } from '../api'
import { usePageMeta } from '../seo'
import { CricketMatch, CricketMeta, WeekInfo } from '../types'

type Window = 'recent' | 'upcoming'

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function shortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function matchDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function weekTitle(index: number) {
  if (index === 0) return 'This Week'
  if (index === 1) return 'Last Week'
  return `${index} Weeks Ago`
}

function resultLine(m: CricketMatch): string {
  const winner = m.teams.find((t) => t.winner)
  if (winner) return `${winner.name} won`
  return m.statusDetail || 'Completed'
}

export default function Cricket() {
  const [windowTab, setWindowTab] = useState<Window>('recent')
  const [matchType, setMatchType] = useState<'international' | 'league' | 'all'>('international')
  const [week, setWeek] = useState(0)
  const [weekInfo, setWeekInfo] = useState<WeekInfo | null>(null)
  const [matches, setMatches] = useState<CricketMatch[]>([])
  const [meta, setMeta] = useState<CricketMeta | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  usePageMeta(
    windowTab === 'recent'
      ? `Cricket Results ${weekTitle(week)} — All Series & Leagues | WeekAdda`
      : 'Upcoming Cricket Matches — Fixtures & Schedules | WeekAdda',
    'Cricket match results week by week and upcoming fixtures across international series and leagues — updated daily by the WeekAdda agent.'
  )

  function load() {
    const params = new URLSearchParams({ window: windowTab, type: matchType })
    if (windowTab === 'recent') params.set('week', String(week))
    if (search.trim()) params.set('search', search.trim())
    return api<{ matches: CricketMatch[]; week: WeekInfo | null; meta: CricketMeta }>(
      `/cricket?${params}`
    )
      .then((res) => {
        setMatches(res.matches)
        setWeekInfo(res.week)
        setMeta(res.meta)
      })
      .catch(console.error)
  }

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => load().finally(() => setLoading(false)), 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowTab, week, search, matchType])

  // Group matches by series; series featuring India always come first
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; items: CricketMatch[] }>()
    for (const m of matches) {
      if (!map.has(m.seriesId)) map.set(m.seriesId, { label: m.series, items: [] })
      map.get(m.seriesId)!.items.push(m)
    }
    const hasIndia = (items: CricketMatch[]) =>
      items.some((m) => m.teams.some((t) => t.name.toLowerCase().startsWith('india')))
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort(
        (a, b) =>
          Number(hasIndia(b.items)) - Number(hasIndia(a.items)) ||
          b.items.length - a.items.length
      )
  }, [matches])

  const maxWeeks = weekInfo?.maxWeeks ?? 13

  return (
    <main>
      <section className="opp-header">
        <div>
          <span className="hero-eyebrow">
            <Trophy size={13} /> From the pitch
          </span>
          <h1>{windowTab === 'recent' ? `Cricket · ${weekTitle(week)}` : 'Upcoming Matches'}</h1>
          <p>
            Match results week by week and upcoming fixtures across every active series and
            league — swept daily by the WeekAdda agent, grouped series by series.
          </p>
        </div>
        <div className="agent-panel">
          <div className={`agent-chip${meta?.source === 'sample' ? ' sample' : ''}`}>
            <Bot size={15} />
            <span>
              {meta
                ? meta.source === 'espn'
                  ? `Agent synced ${timeAgo(meta.fetchedAt)} · ${meta.total} matches · daily at 6 AM`
                  : 'Sample data · agent will sync matches shortly'
                : 'Agent status…'}
            </span>
          </div>
        </div>
      </section>

      <div className="opp-tabs">
        <button
          className={windowTab === 'recent' ? 'active' : ''}
          onClick={() => {
            setWindowTab('recent')
            setWeek(0)
          }}
        >
          <Sparkles size={15} /> Results
        </button>
        <button
          className={windowTab === 'upcoming' ? 'active' : ''}
          onClick={() => setWindowTab('upcoming')}
        >
          <CalendarClock size={15} /> Upcoming
        </button>
      </div>

      {windowTab === 'recent' && (
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
            placeholder="Search teams, series, venues…"
          />
        </div>
        <div className="genre-row">
          {(
            [
              ['international', 'International'],
              ['league', 'Leagues & Domestic'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`genre-chip${matchType === value ? ' active' : ''}`}
              onClick={() => setMatchType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!loading && matches.length === 0 ? (
        <div className="empty-state">
          <Trophy size={54} />
          <h3>No matches here</h3>
          <p>
            {windowTab === 'recent'
              ? `No completed matches found for ${weekTitle(week).toLowerCase()}. Try another week — history builds up as the agent sweeps daily.`
              : 'No upcoming fixtures found right now — check back after the next agent sweep.'}
          </p>
        </div>
      ) : (
        <div className="lang-sections">
          {sections.map((section) => (
            <section key={section.id} className="lang-section">
              <div className="lang-head">
                <h2>{section.label}</h2>
                <span className="count">
                  {section.items.length} match{section.items.length === 1 ? '' : 'es'}
                </span>
              </div>
              <div className="lang-row">
                {section.items.map((m, i) => (
                  <a
                    key={m.id}
                    className={`match-card${m.url ? ' clickable' : ''}`}
                    style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}
                    href={m.url ?? undefined}
                    target={m.url ? '_blank' : undefined}
                    rel={m.url ? 'noopener noreferrer' : undefined}
                    title={m.url ? `Scorecard: ${m.name}` : undefined}
                    onClick={() =>
                      m.url &&
                      trackClick({
                        kind: 'score',
                        platform: 'ESPN',
                        titleId: m.id,
                        title: m.name,
                        language: m.series,
                      })
                    }
                  >
                    {m.url && (
                      <span className="match-go" aria-hidden>
                        <ExternalLink size={14} />
                      </span>
                    )}
                    {m.label && <span className="match-tag">{m.label}</span>}
                    <div className="match-teams">
                      {m.teams.map((t, ti) => (
                        <div key={ti} className={`match-team${t.winner ? ' winner' : ''}`}>
                          {t.logo ? (
                            <img src={t.logo} alt="" loading="lazy" />
                          ) : (
                            <span className="team-dot" />
                          )}
                          <span className="team-name">{t.name}</span>
                          <span className="team-score">{t.score || '—'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="match-footer">
                      <span className="match-result">
                        {m.state === 'pre' ? matchDateTime(m.date) : resultLine(m)}
                        {m.url && (
                          <span className="match-open">
                            {m.state === 'pre' ? 'Match page' : 'Scorecard'}
                            <ExternalLink size={10} />
                          </span>
                        )}
                      </span>
                      {m.venue && (
                        <span className="match-venue">
                          <MapPin size={11} /> {m.venue}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
