import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Film, Heart, PenLine, Search, Trophy } from 'lucide-react'
import { fetchArticleLikes, fetchMyArticles } from '../api'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import OfficialStamp from '../components/OfficialStamp'
import { timeAgo } from '../components/ReviewBits'
import { ArticleCardsSkeleton } from '../components/Skeletons'
import { articlePath, usePageMeta } from '../seo'
import { Article, LikeSummary } from '../types'

type Sort = 'new' | 'old' | 'liked'
type Topic = 'all' | 'movie' | 'match'

/**
 * Everything the signed-in writer has published, on a page of its own.
 *
 * It used to be a filter inside the rail beside the reviews feed, which works
 * for three articles and collapses at a hundred: no sorting, no searching, and
 * a column too narrow to tell one title from another. A body of work deserves
 * somewhere to stand.
 *
 * Personal rather than private — it only ever shows what the asking account
 * wrote — but there is nothing here for a crawler, so the Worker serves it
 * noindex and it stays out of the sitemap.
 */
export default function MyArticles() {
  const user = useGoogleUser()
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [likes, setLikes] = useState<Record<string, LikeSummary>>({})
  const [sort, setSort] = useState<Sort>('new')
  const [topic, setTopic] = useState<Topic>('all')
  const [query, setQuery] = useState('')

  usePageMeta('Your articles | WeekAdda', 'Everything you have published on WeekAdda.')

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) return setArticles(null)
    fetchMyArticles(fresh.token)
      .then((r) => setArticles(r.articles))
      .catch(() => setArticles([]))
    fetchArticleLikes(fresh.token)
      .then((r) => setLikes(r.likes))
      .catch(() => {})
  }, [user])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (articles ?? [])
      .filter((a) => topic === 'all' || a.topic === topic)
      .filter((a) => !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q))
    return [...list].sort((a, b) => {
      if (sort === 'liked') {
        const diff = (likes[b.id]?.count ?? 0) - (likes[a.id]?.count ?? 0)
        // Ties fall back to newest, so the order is never arbitrary
        if (diff !== 0) return diff
        return a.ts < b.ts ? 1 : -1
      }
      return sort === 'old' ? (a.ts > b.ts ? 1 : -1) : a.ts < b.ts ? 1 : -1
    })
  }, [articles, topic, query, sort, likes])

  if (authEnabled && !user) {
    return (
      <main className="article-page">
        <div className="empty-state">
          <PenLine size={54} />
          <h3>Sign in to see your articles</h3>
          <p>
            Your articles are tied to your Google account, which is the only way we can tell which
            of them are yours.
          </p>
          <GoogleButton onError={() => {}} />
          <Link className="empty-onward" to="/reviews">
            Back to reviews and articles
          </Link>
        </div>
      </main>
    )
  }

  const total = articles?.length ?? 0

  return (
    <main className="article-page my-articles">
      <Link className="movie-back" to="/reviews">
        <ArrowLeft size={15} /> Reviews and articles
      </Link>

      <header className="my-articles-head">
        <div>
          <h1>Your articles</h1>
          {articles === null ? (
            <div className="sk sk-line" style={{ width: 150, marginTop: 8 }} aria-hidden="true" />
          ) : (
          <p>
            {total === 0
                ? 'Nothing published yet.'
                : `${total} published${shown.length !== total ? ` · ${shown.length} shown` : ''}`}
          </p>
          )}
        </div>
        <Link className="community-cta" to="/reviews?compose=article">
          <PenLine size={18} /> Write an article
        </Link>
      </header>

      {total > 0 && (
        <div className="my-articles-tools">
          <div className="search-wrap">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your articles…"
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
                className={`genre-chip${topic === value ? ' active' : ''}`}
                onClick={() => setTopic(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Chips, not a native <select> — the browser draws that one and it
              never matches the page around it. Same control the filters use. */}
          <div className="genre-row my-articles-sort">
            <span className="my-articles-sort-label">Sort</span>
            {(
              [
                ['new', 'Newest'],
                ['old', 'Oldest'],
                ['liked', 'Most liked'],
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

      {articles === null ? (
        <ArticleCardsSkeleton />
      ) : total === 0 ? (
        <div className="empty-state">
          <PenLine size={54} />
          <h3>You haven’t written an article yet</h3>
          <p>
            The 1983 final, a top ten, an old film worth another look — anything that isn’t tied to
            this week’s releases.
          </p>
          <Link className="empty-onward" to="/reviews?compose=article">
            Write your first one
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="my-articles-none">Nothing matches that. Try a different search or filter.</p>
      ) : (
        <div className="my-articles-grid">
          {shown.map((a) => (
            <article key={a.id} className="my-article-card">
              {a.image ? (
                <img
                  className="my-article-thumb"
                  src={a.image}
                  alt=""
                  loading="lazy"
                  style={{
                    objectFit: a.imageFit ?? 'cover',
                    objectPosition: a.imagePosition ?? '50% 50%',
                  }}
                />
              ) : (
                <span className="my-article-thumb fallback">
                  {a.topic === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
                </span>
              )}
              <div className="my-article-body">
                <span className="my-article-meta">
                  {a.topic === 'movie' ? <Film size={11} /> : <Trophy size={11} />}{' '}
                  {a.topic === 'movie' ? 'Movies' : 'Cricket'} · <CalendarDays size={11} />{' '}
                  {timeAgo(a.ts)}
                  {(likes[a.id]?.count ?? 0) > 0 && (
                    <em className="blog-index-likes">
                      {' '}
                      · <Heart size={10} fill="currentColor" /> {likes[a.id].count}
                    </em>
                  )}
                  {a.official && <OfficialStamp compact />}
                </span>
                {/* Carries where it was opened from, so the article's own back
                    link returns here rather than dumping you on /reviews */}
                <Link
                  className="my-article-title"
                  to={articlePath(a)}
                  state={{ from: '/my-articles', fromLabel: 'Your articles' }}
                >
                  {a.title}
                </Link>
                {/* No edit or delete here on purpose: this is a list to read
                    and find things in, and a destructive control on every row
                    is a mis-tap waiting to happen. Both live on the article
                    itself, where you can see what you are about to change. */}
                <p className="my-article-excerpt">{a.body.replace(/\s+/g, ' ').slice(0, 160)}…</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
