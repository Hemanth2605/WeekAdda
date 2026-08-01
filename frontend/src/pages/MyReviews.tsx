import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Film, PenLine, Search, Star, Trophy } from 'lucide-react'
import { fetchMyPosts, fetchRatings } from '../api'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import { matchSubtitle, timeAgo } from '../components/ReviewBits'
import { ArticleCardsSkeleton } from '../components/Skeletons'
import { matchFlags } from '../flags'
import { reviewPath, usePageMeta } from '../seo'
import { BlogPost, RatingSummary } from '../types'

type Sort = 'new' | 'old' | 'rated'
type Kind = 'all' | 'movie' | 'match'

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

  usePageMeta('Your reviews | WeekAdda', 'Everything you have reviewed on WeekAdda.')

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
        <Link className="community-cta" to="/reviews?compose=review">
          <PenLine size={18} /> Write a review
        </Link>
      </header>

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
          <Link className="empty-onward" to="/reviews?compose=review">
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
    </main>
  )
}
