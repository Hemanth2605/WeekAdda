import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ChevronDown, Film, Globe, Home, Lock, MapPin, Pencil, PenLine, Search, Star, Ticket, Trash2, Trophy } from 'lucide-react'
import { deleteLog, fetchLogs, fetchMyPosts, fetchRatings } from '../api'
import WatchLogForm from '../components/WatchLogForm'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import { matchSubtitle, timeAgo } from '../components/ReviewBits'
import { ArticleCardsSkeleton } from '../components/Skeletons'
import { matchFlags } from '../flags'
import { reviewPath, usePageMeta } from '../seo'
import { BlogPost, RatingSummary, WatchLog } from '../types'

type Sort = 'new' | 'old' | 'rated'
type Kind = 'all' | 'movie' | 'match'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Everything the signed-in visitor has reviewed, on a page of its own — the
 * counterpart to /my-articles.
 *
 * It replaces a "My reviews" chip that filtered the feed in place. That works
 * while you have written three and stops working at a hundred: no sorting, no
 * searching, and the same weekly ordering as everyone else's reviews.
 *
 * Personal rather than private: it only ever shows what the asking account
 * wrote, but there is nothing here for a crawler, so the Worker serves it
 * noindex and it stays out of the sitemap.
 */
export default function MyReviews() {
  const user = useGoogleUser()
  const [posts, setPosts] = useState<BlogPost[] | null>(null)
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({})
  const [sort, setSort] = useState<Sort>('new')
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  // Public reviews and the private log are two different things in two
  // different stores, so they get two tabs rather than one list with a badge.
  // The tab lives in the URL — /my-reviews?tab=private is where "See my log"
  // lands, and it means the back button unwinds a tab switch like any other
  // navigation rather than silently doing nothing.
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const setTab = (next: 'public' | 'private') => {
    const q = new URLSearchParams(params)
    // Always written, never inferred from absence: the default below depends on
    // what has been written, so "no param" has to keep meaning "not chosen"
    q.set('tab', next)
    setParams(q, { replace: true })
  }
  const [logs, setLogs] = useState<WatchLog[] | null>(null)

  /**
   * Which tab to show when the URL has not said.
   *
   * Someone who has only ever kept the private log landed on an empty Public
   * tab telling them they had published nothing — true, and useless, with their
   * actual work one unnoticed click away. So the page opens on whichever tab
   * has something in it. Only when both have loaded: switching under someone
   * mid-read is worse than a moment on the wrong tab.
   */
  const loaded = posts !== null && logs !== null
  const tab: 'public' | 'private' =
    asked === 'private'
      ? 'private'
      : asked === 'public'
        ? 'public'
        : loaded && posts.length === 0 && logs.length > 0
          ? 'private'
          : 'public'

  /**
   * This page including its tab — what every link away from here hands over as
   * its way back. Hardcoding `/my-reviews` sent you to the public tab however
   * you had left, which reads as the cancel having done something more than
   * cancel.
   */
  const backHere = `/my-reviews?tab=${tab}`
  // The entry being changed. Edited in place on its own row rather than in a
  // modal — the row is where you found the mistake, and it is the only context
  // that tells you which of six PVR trips this one was.
  const [editingLog, setEditingLog] = useState<WatchLog | null>(null)

  usePageMeta('Your reviews | WeekAdda', 'Everything you have reviewed on WeekAdda.')

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) return setLogs(null)
    fetchLogs(fresh.token)
      .then((r) => setLogs(r.logs))
      .catch(() => setLogs([]))
  }, [user])

  /** This calendar year — the one a log with no history opens on. */
  const year = new Date().getFullYear()

  /** Which years the log actually covers, newest first. */
  const years = useMemo(() => {
    const set = new Set((logs ?? []).map((l) => l.watchedOn.slice(0, 4)))
    return [...set].sort().reverse()
  }, [logs])
  const [openYear, setOpenYear] = useState<string | null>(null)
  const shownYear = openYear ?? years[0] ?? String(year)

  /**
   * The counts for the year on show — not for this year.
   *
   * A log is kept to be looked back at, and a tally that could only ever say
   * *2026* answered that for eleven months and then reset. So the banner counts
   * whatever year is selected, and the same `shownYear` drives the timeline
   * below it: one year is chosen on the page, never two.
   *
   * Counted from every entry rather than the searched ones — a summary that
   * moved while you typed would be reporting the search, not the year.
   */
  const stats = useMemo(() => {
    const inYear = (logs ?? []).filter((l) => l.watchedOn.startsWith(shownYear))
    const venues = new Set<string>()
    for (const l of inYear) if (l.where === 'out' && l.venue) venues.add(l.venue)
    return {
      watched: inYear.length,
      films: inYear.filter((l) => l.kind === 'movie').length,
      matches: inYear.filter((l) => l.kind === 'match').length,
      out: inYear.filter((l) => l.where === 'out').length,
      home: inYear.filter((l) => l.where === 'home').length,
      venues: venues.size,
    }
  }, [logs, shownYear])

  const shownLogs = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return logs ?? []
    return (logs ?? []).filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.venue ?? '').toLowerCase().includes(q) ||
        (l.city ?? '').toLowerCase().includes(q)
    )
  }, [logs, query])

  /** The twelve months of the shown year, each with its own entries. */
  const months = useMemo(() => {
    const inYear = shownLogs.filter((l) => l.watchedOn.startsWith(shownYear))
    return MONTHS.map((name, i) => ({
      name,
      index: i,
      entries: inYear
        .filter((l) => Number(l.watchedOn.slice(5, 7)) === i + 1)
        // Within a month, earliest first — a month reads forwards
        .sort((a, b) => a.watchedOn.localeCompare(b.watchedOn)),
    }))
  }, [shownLogs, shownYear])

  // Opens on the month with the most recent entry, so the first thing seen is
  // the last thing done rather than an empty January
  const [openMonth, setOpenMonth] = useState<number | null>(null)
  useEffect(() => {
    if (openMonth !== null) return
    const last = [...months].reverse().find((m) => m.entries.length > 0)
    if (last) setOpenMonth(last.index)
  }, [months, openMonth])

  /**
   * Switch years. One place calls it — the banner dropdown.
   *
   * The open month is cleared with it: December is where last year ended, and
   * holding that month into a year that has nothing in it shows an empty
   * accordion where the effect would otherwise have opened the right one.
   */
  const pickYear = (y: string) => {
    setOpenYear(y)
    setOpenMonth(null)
  }
  /**
   * Every year the dropdown offers: this one down to the earliest you have
   * logged, with the gaps kept in.
   *
   * The gaps matter — a list that skipped the years you happened not to log
   * would read as those years not existing. And the range is drawn from the
   * log rather than from a fixed start, because backdating is allowed: log an
   * evening in 2013 and 2013 is in the list, along with everything since.
   */
  const yearOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of logs ?? []) {
      const y = l.watchedOn.slice(0, 4)
      counts.set(y, (counts.get(y) ?? 0) + 1)
    }
    const oldest = Math.min(year, ...[...counts.keys()].map(Number))
    const list: { year: string; count: number }[] = []
    for (let y = year; y >= oldest; y--) {
      list.push({ year: String(y), count: counts.get(String(y)) ?? 0 })
    }
    return list
  }, [logs, year])

  /** The year dropdown's open state, and closing it the two usual ways. */
  const [yearOpen, setYearOpen] = useState(false)
  const yearRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!yearOpen) return
    const away = (e: PointerEvent) => {
      if (!yearRef.current?.contains(e.target as Node)) setYearOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setYearOpen(false)
    // Pointerdown rather than click: a menu that closes only on a completed
    // click stays open under whatever you pressed next
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [yearOpen])

  /**
   * The entry the bin has been pressed on, waiting for a second press.
   *
   * Asked for, not assumed: an entry is a record of an evening that cannot be
   * looked up again anywhere, so a mis-tap on a row is not recoverable. The
   * confirm is the row's own — a dialog would cover the very line you are
   * checking you have the right one.
   */
  const [confirmLog, setConfirmLog] = useState<string | null>(null)

  const removeLog = (id: string) => {
    const token = refreshUser()?.token
    if (!token) return
    setConfirmLog(null)
    // Gone from the list first: waiting on a round trip to remove a row you
    // just deleted reads as the button not having worked
    setLogs((prev) => (prev ?? []).filter((l) => l.id !== id))
    deleteLog(id, token).catch(() => {})
  }

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) return setPosts(null)
    fetchMyPosts(fresh.token)
      .then((r) => setPosts(r.posts))
      .catch(() => setPosts([]))
    fetchRatings(fresh.token)
      .then((r) => setRatings(r.ratings))
      .catch(() => {})
  }, [user])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (posts ?? [])
      .filter((p) => kind === 'all' || p.tag?.kind === kind)
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          (p.tag?.label ?? '').toLowerCase().includes(q)
      )
    return [...list].sort((a, b) => {
      if (sort === 'rated') {
        const diff = (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0)
        // Ties fall back to newest, so the order is never arbitrary
        if (diff !== 0) return diff
        return a.ts < b.ts ? 1 : -1
      }
      return sort === 'old' ? (a.ts > b.ts ? 1 : -1) : a.ts < b.ts ? 1 : -1
    })
  }, [posts, kind, query, sort, ratings])

  if (authEnabled && !user) {
    return (
      <main className="article-page">
        <div className="empty-state">
          <PenLine size={54} />
          <h3>Sign in to see your reviews</h3>
          <p>
            Your reviews are tied to your Google account, which is the only way we can tell which of
            them are yours.
          </p>
          <GoogleButton onError={() => {}} />
          <Link className="empty-onward" to="/reviews">
            Back to reviews and articles
          </Link>
        </div>
      </main>
    )
  }

  const total = posts?.length ?? 0

  return (
    <main className="article-page my-articles">
      <Link className="movie-back" to="/reviews">
        <ArrowLeft size={15} /> Reviews and articles
      </Link>

      <header className="my-articles-head">
        <div>
          <h1>Your reviews</h1>
          {posts === null ? (
            <div className="sk sk-line" style={{ width: 150, marginTop: 8 }} aria-hidden="true" />
          ) : (
            <p>
              {total === 0
                ? 'Nothing published yet.'
                : `${total} published${shown.length !== total ? ` · ${shown.length} shown` : ''}`}
            </p>
          )}
        </div>
        <Link
          className="community-cta"
          to="/reviews?compose=review"
          state={{ from: backHere }}
        >
          <PenLine size={18} /> Write a review
        </Link>
      </header>

      {/* The year, in one line. It is the reason the log exists — a count you
          can see is what makes the next entry worth adding. */}
      {(logs?.length ?? 0) > 0 && (
        <div className="log-summary">
          {/* The year is a control, not a label — pick one and both the counts
              beside it and the timeline below follow. Drawn rather than a
              native <select> for the reason the sort chips are: the browser's
              own dropdown never matches the page it sits in. */}
          <div className="log-year-pick" ref={yearRef}>
            <button
              className={`log-year-btn${yearOpen ? ' open' : ''}`}
              onClick={() => setYearOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={yearOpen}
              aria-label={`Year: ${shownYear}. Choose another`}
            >
              <span className="log-year-cap">Year</span>
              <b>{shownYear}</b>
              <ChevronDown size={15} />
            </button>
            {yearOpen && (
              <ul className="log-year-menu" role="listbox" aria-label="Year">
                {yearOptions.map((o) => (
                  <li key={o.year}>
                    <button
                      className={o.year === shownYear ? 'active' : ''}
                      role="option"
                      aria-selected={o.year === shownYear}
                      onClick={() => {
                        pickYear(o.year)
                        setYearOpen(false)
                      }}
                    >
                      <span>{o.year}</span>
                      {/* The count is what you came to the menu for — which
                          year has anything in it, before choosing it */}
                      <em>{o.count > 0 ? `${o.count} logged` : 'nothing yet'}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Films and matches counted apart, then where they were watched.
              Each part appears only when there is one — a log of nothing but
              films should not carry "0 matches" all year. */}
          {/* The same marks the log form uses, in the same colours: 🍿 and 🏏
              for what was watched, the amber ticket and teal home for where,
              and the blue pin for a venue. The summary is a count of the very
              things those toggles set, so it should not invent a second set of
              symbols for them. */}
          {stats.films > 0 && (
            <span>
              <span className="log-emoji">🍿</span> {stats.films}{' '}
              {stats.films === 1 ? 'film' : 'films'}
            </span>
          )}
          {stats.matches > 0 && (
            <span>
              <span className="log-emoji">🏏</span> {stats.matches}{' '}
              {stats.matches === 1 ? 'match' : 'matches'}
            </span>
          )}
          {stats.out > 0 && (
            <span className="stat-out">
              <Ticket size={13} /> {stats.out} out
            </span>
          )}
          {stats.home > 0 && (
            <span className="stat-home">
              <Home size={13} /> {stats.home} at home
            </span>
          )}
          {stats.venues > 0 && (
            <span className="stat-venue">
              <MapPin size={13} /> {stats.venues} {stats.venues === 1 ? 'venue' : 'venues'}
            </span>
          )}
        </div>
      )}

      <div className="log-tabs" role="tablist">
        {/* The composer's own two marks, and its two palettes: the globe that
            says "anyone can read this" and the padlock that says nobody can.
            Same tiles as the section icons — glass until the tab is the one
            you are on, then the full gradient. */}
        <button
          role="tab"
          aria-selected={tab === 'public'}
          className={`log-tab${tab === 'public' ? ' active' : ''}`}
          onClick={() => setTab('public')}
        >
          <span className="log-ico ico-theatre">
            <Globe size={14} />
          </span>
          Public <span className="mine-count">{total}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'private'}
          className={`log-tab${tab === 'private' ? ' active' : ''}`}
          onClick={() => setTab('private')}
        >
          <span className="log-ico ico-soon">
            <Lock size={14} />
          </span>
          Private log <span className="mine-count">{logs?.length ?? 0}</span>
        </button>
      </div>

      {tab === 'private' ? (
        <>
          <div className="my-articles-tools">
            <div className="search-wrap">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your log — film, theatre, city…"
              />
            </div>
          </div>
          {logs === null ? (
            <ArticleCardsSkeleton label="Loading your log" />
          ) : shownLogs.length === 0 ? (
            <div className="empty-state">
              <Ticket size={54} />
              <h3>{logs.length === 0 ? 'Your log is empty' : 'Nothing matches that'}</h3>
              <p>
                {logs.length === 0
                  ? 'Every film you watch, where you watched it and when — kept for you alone. Nobody else ever sees this, not even us in the public feed.'
                  : 'Try a different film, theatre or city.'}
              </p>
              {logs.length === 0 && (
                <Link
                  className="empty-onward"
                  to="/reviews?compose=review"
                  state={{ from: backHere }}
                >
                  Log the first one
                </Link>
              )}
            </div>
          ) : (
            <div className="log-year">
              {/* Years across the top, months down the side, entries on a line.
                  A flat list answers "what did I watch"; a year answers "what
                  did my year look like", which is the question a log is kept
                  for. */}
              {/* The same tile a release card wears, widened for four digits.
                  A date on this site looks like this, and a year is a date.
                  A heading now, not a row of choices: the year is chosen once,
                  in the banner. Two controls for one year could only ever
                  agree — and would still have to be found twice. */}
              <div className="log-years">
                <span className="date-cal year-cal active">
                  <span className="date-cal-month">Year</span>
                  <span className="date-cal-day">{shownYear}</span>
                </span>
                {stats.watched === 0 && (
                  <span className="log-year-none">
                    Nothing logged in {shownYear} — pick another year above.
                  </span>
                )}
              </div>

              <ol className="log-months">
                {months.map((m) => {
                  const open = openMonth === m.index
                  const empty = m.entries.length === 0
                  return (
                    <li
                      key={m.name}
                      className={`log-month${open ? ' open' : ''}${empty ? ' empty' : ''}`}
                    >
                      {/* A month with nothing in it has nothing to open, so it
                          says so rather than opening onto emptiness */}
                      <button
                        className="log-month-head"
                        onClick={() => setOpenMonth(open ? null : m.index)}
                        aria-expanded={open}
                        disabled={empty}
                      >
                        <span className="log-month-name">{m.name}</span>
                        <span className="log-month-count">{empty ? '—' : m.entries.length}</span>
                      </button>

                      {open && !empty && (
                        <ol className="log-line">
                          {m.entries.map((l) =>
                            editingLog?.id === l.id ? (
                              // Edited in place, so you change it where you
                              // found it. Keyed by id, or opening a different
                              // entry would reuse the last one's fields.
                              <li key={l.id} className="log-dot editing">
                                <WatchLogForm
                                  key={l.id}
                                  kind={l.kind}
                                  editing={l}
                                  onCancel={() => setEditingLog(null)}
                                  onSaved={(updated) => {
                                    setLogs((prev) =>
                                      (prev ?? []).map((x) => (x.id === updated.id ? updated : x))
                                    )
                                    setEditingLog(null)
                                  }}
                                />
                              </li>
                            ) : (
                              <li key={l.id} className="log-dot">
                                {/* The dot is the day, and carries its number —
                                    so the line reads as a month at a glance
                                    rather than as a list that happens to be
                                    in order */}
                                <span className={`log-dot-mark ${l.where}`}>
                                  {Number(l.watchedOn.slice(8, 10))}
                                </span>
                                <Link
                                  className="log-dot-line"
                                  to={`/log/${l.id}`}
                                  state={{ from: '/my-reviews?tab=private' }}
                                >
                                  <b>{l.title}</b>
                                  <small>
                                    {/* The same two marks as the banner above
                                        and the form that set them */}
                                    <span className="log-emoji">
                                      {l.kind === 'match' ? '🏏' : '🍿'}
                                    </span>
                                    {l.venue || (l.where === 'out' ? 'Out' : 'At home')}
                                    {l.city && ` · ${l.city}`}
                                    {l.note && <span className="log-dot-has-note">note</span>}
                                  </small>
                                </Link>
                                {confirmLog === l.id ? (
                                  // Words rather than a second bin: the whole
                                  // point of the step is that the second press
                                  // must not look like the first
                                  <span className="log-confirm">
                                    <button
                                      className="log-confirm-yes"
                                      onClick={() => removeLog(l.id)}
                                    >
                                      Remove
                                    </button>
                                    <button
                                      className="log-confirm-no"
                                      onClick={() => setConfirmLog(null)}
                                    >
                                      Keep
                                    </button>
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      className="log-entry-edit"
                                      onClick={() => setEditingLog(l)}
                                      aria-label={`Edit ${l.title}`}
                                      title="Edit this entry"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      className="log-entry-del"
                                      onClick={() => setConfirmLog(l.id)}
                                      aria-label={`Remove ${l.title}`}
                                      title="Remove from your log"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </li>
                            )
                          )}
                        </ol>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </>
      ) : (
      <>
      {total > 0 && (
        <div className="my-articles-tools">
          <div className="search-wrap">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your reviews…"
            />
          </div>
          <div className="genre-row">
            {(
              [
                ['all', 'All'],
                ['movie', 'Movies'],
                ['match', 'Cricket'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${kind === value ? ' active' : ''}`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="genre-row my-articles-sort">
            <span className="my-articles-sort-label">Sort</span>
            {(
              [
                ['new', 'Newest'],
                ['old', 'Oldest'],
                ['rated', 'Best rated'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${sort === value ? ' active' : ''}`}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {posts === null ? (
        <ArticleCardsSkeleton label="Loading your reviews" />
      ) : total === 0 ? (
        <div className="empty-state">
          <PenLine size={54} />
          <h3>You haven’t reviewed anything yet</h3>
          <p>
            Pick something you watched this week, say what you actually thought, and someone
            deciding tonight will read it.
          </p>
          <Link
          className="empty-onward"
          to="/reviews?compose=review"
          state={{ from: backHere }}
        >
            Write your first one
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="my-articles-none">Nothing matches that. Try a different search or filter.</p>
      ) : (
        <div className="my-articles-grid">
          {shown.map((p) => {
            const flags = matchFlags(p.tag)
            const rating = ratings[p.id]
            return (
              <article key={p.id} className="my-article-card">
                {p.tag?.poster ? (
                  <img className="my-article-thumb" src={p.tag.poster} alt="" loading="lazy" />
                ) : flags.length > 0 ? (
                  <span className="my-article-thumb fallback flags">
                    {flags.map((l, i) => (
                      <img key={i} src={l} alt="" loading="lazy" />
                    ))}
                  </span>
                ) : (
                  <span className={`my-article-thumb fallback ${p.tag?.kind ?? 'movie'}`}>
                    {p.tag?.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
                  </span>
                )}
                <div className="my-article-body">
                  <span className="my-article-meta">
                    {p.tag?.kind === 'movie' ? <Film size={11} /> : <Trophy size={11} />}{' '}
                    {p.tag?.label}
                    {matchSubtitle(p.tag) && ` · ${matchSubtitle(p.tag)}`} ·{' '}
                    <CalendarDays size={11} /> {timeAgo(p.ts)}
                    {rating && rating.count > 0 && (
                      <em className="my-article-rating">
                        {' '}
                        · <Star size={10} fill="currentColor" /> {rating.avg.toFixed(1)}
                      </em>
                    )}
                  </span>
                  <Link
                    className="my-article-title"
                    to={reviewPath(p)}
                    state={{ from: '/my-reviews', fromLabel: 'Your reviews' }}
                  >
                    {p.title}
                  </Link>
                  <p className="my-article-excerpt">{p.body.replace(/\s+/g, ' ').slice(0, 160)}…</p>
                </div>
              </article>
            )
          })}
        </div>
      )}
      </>
      )}
    </main>
  )
}
