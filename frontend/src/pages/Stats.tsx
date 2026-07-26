import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, Lock, RefreshCw } from 'lucide-react'
import GoogleButton from '../components/GoogleButton'
import { fetchStats } from '../api'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import type { ClickStats } from '../types'

/**
 * Private owner dashboard for outbound-click stats — deliberately unlinked
 * from the app: no navbar entry, no footer link, not in the sitemap or the
 * Worker's pre-render, and noindex'd below. Reaching the URL is not access:
 * /api/track/stats checks the Google-verified email against OWNER_EMAIL
 * server-side, so anyone else who types /stats just sees "not available".
 */

/** Keep this page out of search results for as long as it is mounted. */
function useNoIndex() {
  useEffect(() => {
    document.title = 'Stats'
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex, nofollow'
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, [])
}

const KIND_LABEL: Record<string, string> = {
  watch: 'Watch on OTT',
  book: 'Book tickets',
  score: 'Match scorecard',
  share: 'Share',
}

/** IST day keys for the last `count` days, oldest first — including empty ones. */
function recentDays(count: number, today: string): string[] {
  const end = Date.parse(`${today}T00:00:00Z`)
  const days: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    days.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10))
  }
  return days
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-value">{value.toLocaleString('en-IN')}</span>
      <span className="stat-tile-label">{label}</span>
      {hint && <span className="stat-tile-hint">{hint}</span>}
    </div>
  )
}

/** Ranked count list (platforms, languages, kinds) with a proportional bar. */
function Breakdown({
  title,
  counts,
  labels,
}: {
  title: string
  counts: Record<string, number>
  labels?: Record<string, string>
}) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] ?? 0
  return (
    <section className="stat-block">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="stat-empty">No clicks yet.</p>
      ) : (
        <ul className="stat-rows">
          {rows.map(([key, n]) => (
            <li key={key}>
              <span className="stat-row-name">{labels?.[key] ?? key}</span>
              <span className="stat-row-bar">
                <i style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
              </span>
              <span className="stat-row-count">{n.toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TitleList({ title, rows }: { title: string; rows: ClickStats['topTitles'] }) {
  return (
    <section className="stat-block">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="stat-empty">Nothing yet.</p>
      ) : (
        <ol className="stat-titles">
          {rows.map((r) => (
            <li key={r.title}>
              <span className="stat-row-name">{r.title}</span>
              <span className="stat-row-count">{r.clicks.toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default function Stats() {
  useNoIndex()
  const user = useGoogleUser()
  const [stats, setStats] = useState<ClickStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    const token = refreshUser()?.token
    if (!token) {
      setStats(null)
      return
    }
    setLoading(true)
    setError('')
    fetchStats(token)
      .then(setStats)
      .catch((err: Error) => {
        setStats(null)
        setError(err.message || 'Could not load stats')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load, user?.token])

  return (
    <main className="movie-page stats-page">
      <Link className="movie-back" to="/movies">
        <ArrowLeft size={15} /> Back to the site
      </Link>

      <header className="stats-head">
        <div>
          <span className="hero-eyebrow">
            <Lock size={13} /> Private · owner only
          </span>
          <h1>Click stats</h1>
          <p className="stats-sub">
            Every outbound click WeekAdda sends to an OTT app, a ticket page or a scorecard.
            Days are counted in IST.
          </p>
        </div>
        {stats && (
          <button className="stats-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </header>

      {!authEnabled && (
        <div className="about-card stats-gate">
          <p>
            Google sign-in isn&apos;t configured in this build, so the owner check can&apos;t run.
            Set <code>VITE_GOOGLE_CLIENT_ID</code> (frontend) and <code>GOOGLE_CLIENT_ID</code> +{' '}
            <code>OWNER_EMAIL</code> (backend) to use this page.
          </p>
        </div>
      )}

      {authEnabled && !user && (
        <div className="about-card stats-gate">
          <BarChart3 size={26} />
          <p>Sign in with the owner account to see the numbers.</p>
          <GoogleButton onError={setError} />
        </div>
      )}

      {user && error && (
        <div className="about-card stats-gate">
          <p className="stats-error">{error}</p>
          <p className="stat-empty">
            Signed in as {user.email}. Only the owner account can read this page.
          </p>
        </div>
      )}

      {user && !error && !stats && loading && <p className="stat-empty">Loading stats…</p>}

      {stats && (
        <>
          <section className="stat-block">
            <h2>Today · {dayLabel(stats.today)}</h2>
            <div className="stat-tiles">
              <Tile label="Clicks today" value={stats.todayClicks} />
              <Tile
                label="People today"
                value={stats.todayUniquePeople}
                hint="devices merged by account"
              />
              <Tile
                label="Browsers today"
                value={stats.todayUniqueVisitors}
                hint="before merging"
              />
              <Tile
                label="Signed-in members today"
                value={stats.todaySignedInVisitors}
                hint={`${stats.todaySignedInClicks.toLocaleString('en-IN')} of today's clicks`}
              />
            </div>
          </section>

          <section className="stat-block">
            <h2>All time{stats.since ? ` · since ${dayLabel(stats.since.slice(0, 10))}` : ''}</h2>
            <div className="stat-tiles">
              <Tile label="Total clicks" value={stats.totalClicks} />
              <Tile
                label="People"
                value={stats.uniquePeople}
                hint="devices merged by account"
              />
              <Tile label="Browsers" value={stats.uniqueVisitors} hint="before merging" />
              <Tile
                label="Signed-in members"
                value={stats.signedInVisitors}
                hint={`${stats.signedInClicks.toLocaleString('en-IN')} clicks signed in`}
              />
            </div>
            <p className="stat-note">
              <b>People</b> is the honest headcount: a browser that has ever signed in is
              folded into that account, so one person on a phone and a laptop counts once —
              including the clicks they made before signing in. <b>Browsers</b> is the raw
              device count, which over-counts anyone using more than one. The two overlap;
              don&apos;t add them. Someone who never signs in anywhere still counts once per
              browser — no cookieless method can do better.
            </p>
          </section>

          <section className="stat-block">
            <h2>Signed-in members</h2>
            <div className="stat-tiles">
              <Tile
                label="Members with a Google account"
                value={stats.members}
                hint="everyone who has ever signed in"
              />
              <Tile label="Active today" value={stats.membersToday} />
              <Tile label="New today" value={stats.newMembersToday} hint="first time seen" />
            </div>
            <p className="stat-note">
              WeekAdda has no sign-up — an account exists once it does something that needs
              sign-in. Counted across all of them: {stats.membersBySource.click} clicked while
              signed in, {stats.membersBySource.blog} wrote a review,{' '}
              {stats.membersBySource.rating} rated one, {stats.membersBySource.adda} used the
              Adda. One person can appear in more than one.
            </p>
          </section>

          <section className="stat-block">
            <h2>Last 14 days</h2>
            <StatsChart byDay={stats.byDay} today={stats.today} />
          </section>

          <div className="stat-grid">
            <Breakdown title="Today by action" counts={stats.todayByKind} labels={KIND_LABEL} />
            <Breakdown title="Today by platform" counts={stats.todayByPlatform} />
            <Breakdown title="All time by action" counts={stats.byKind} labels={KIND_LABEL} />
            <Breakdown title="All time by platform" counts={stats.byPlatform} />
            <Breakdown title="By language" counts={stats.byLanguage} />
            <TitleList title="Top titles today" rows={stats.todayTopTitles} />
          </div>

          <TitleList title="Top titles all time" rows={stats.topTitles} />
        </>
      )}
    </main>
  )
}

/** 14-day click history — plain CSS bars, no chart library. */
function StatsChart({ byDay, today }: { byDay: Record<string, number>; today: string }) {
  const days = recentDays(14, today)
  const max = Math.max(1, ...days.map((d) => byDay[d] ?? 0))
  return (
    <div className="stat-chart">
      {days.map((day) => {
        const n = byDay[day] ?? 0
        return (
          <div className={`stat-bar${day === today ? ' is-today' : ''}`} key={day}>
            <span className="stat-bar-count">{n}</span>
            <i style={{ height: `${(n / max) * 100}%` }} title={`${n} clicks on ${dayLabel(day)}`} />
            <span className="stat-bar-day">{dayLabel(day)}</span>
          </div>
        )
      })}
    </div>
  )
}
