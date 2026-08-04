import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Film,
  Pencil,
  Trash2,
  Trophy,
} from 'lucide-react'
import {
  fetchPost,
  fetchMyPosts,
  fetchRatings,
  fetchArticles,
  fetchArticleLikes,
  deletePost,
} from '../api'
import { refreshUser, useGoogleUser } from '../auth'
import { matchFlags } from '../flags'
import { usePageMeta, titlePath, reviewPath } from '../seo'
import { Article, BlogPost, LikeSummary, RatingSummary } from '../types'
import Breadcrumbs from '../components/Breadcrumbs'
import ArticleIndex from '../components/ArticleIndex'
import { ArticlePageSkeleton } from '../components/Skeletons'
import { StarRow, TagLine, timeAgo } from '../components/ReviewBits'
import OfficialStamp from '../components/OfficialStamp'

/**
 * One review, in full, on its own URL — what the index panel on /reviews links
 * into and what a shared link lands on. The Worker pre-renders the same text
 * (buildReviewPage in backend/src/seo.ts), so whatever a crawler is shown here
 * has to render for a reader too.
 */
export default function ReviewDetail() {
  const { id } = useParams()
  const user = useGoogleUser()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [related, setRelated] = useState<BlogPost[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [articleLikes, setArticleLikes] = useState<Record<string, LikeSummary>>({})
  const [missing, setMissing] = useState(false)
  const [rating, setRating] = useState<RatingSummary | undefined>()
  const [mine, setMine] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  // Where this was opened from, when the link said so; a shared link or a
  // direct visit has no history to honour and falls back to the feed
  const origin = useLocation().state as { from?: string; fromLabel?: string } | null
  const backTo = origin?.from ?? '/reviews'
  const backLabel = origin?.fromLabel ?? 'All reviews'

  const remove = async () => {
    const fresh = refreshUser()
    if (!fresh || !id || busy) return
    setBusy(true)
    setError('')
    try {
      await deletePost(id, fresh.token)
      navigate(backTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete — please try again')
      setBusy(false)
    }
  }

  useEffect(() => {
    setPost(null)
    setRelated([])
    setMissing(false)
    fetchPost(id ?? '')
      .then((r) => {
        setPost(r.post)
        setRelated(r.related)
      })
      .catch(() => setMissing(true))
  }, [id])

  // The rail is its own fetch, and a separate store — failing to load the
  // articles must not take the review down with it
  useEffect(() => {
    fetchArticles((r) => setArticles(r.articles))
      .then((r) => setArticles(r.articles))
      .catch(() => setArticles([]))
    // Counts for the rail; the token only adds whether this reader liked each
    fetchArticleLikes(user ? refreshUser()?.token : undefined, (r) => setArticleLikes(r.likes))
      .then((r) => setArticleLikes(r.likes))
      .catch(() => {})
  }, [user])

  useEffect(() => {
    const apply = (r: { ratings: Record<string, import('../types').RatingSummary> }) =>
      setRating(id ? r.ratings[id] : undefined)
    fetchRatings(user ? refreshUser()?.token : undefined, apply)
      .then(apply)
      .catch(() => {})
  }, [id, user])

  // Authors can read their own average but never rate it — the same rule the
  // feed applies, decided here because this page loads one post, not the list.
  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) {
      setMine(false)
      return
    }
    fetchMyPosts(fresh.token)
      .then((r) => setMine(r.posts.some((p) => p.id === id)))
      .catch(() => setMine(false))
  }, [id, user])

  const excerpt = post ? post.body.replace(/\s+/g, ' ').trim().slice(0, 157) : ''
  usePageMeta(
    post
      ? `${post.title.length > 60 ? `${post.title.slice(0, 57).replace(/\s+\S*$/, '')}…` : post.title} — ${post.tag.label} Review | WeekAdda`
      : 'Movie & Cricket Reviews by Real Viewers | WeekAdda',
    post
      ? `${post.author} on ${post.tag.label}: ${excerpt}${post.body.length > 157 ? '…' : ''}`
      : 'Honest reviews of this week’s movies, OTT releases and cricket matches — written and rated out of five by the people who actually watched them.'
  )

  if (missing) {
    return (
      <main className="movie-page">
        <div className="movie-page-missing">
          <h1>Review not found</h1>
          <p>This review is no longer on WeekAdda.</p>
          <Link className="movie-back" to="/reviews">
            <ArrowLeft size={15} /> Read what people are saying
          </Link>
        </div>
      </main>
    )
  }

  if (!post) {
    // A review carries no cover, so the skeleton does not promise one
    return (
      <main className="article-page review-page">
        <div className="blog-layout">
          <div className="blog-main">
            <ArticlePageSkeleton cover={false} />
          </div>
        </div>
      </main>
    )
  }

  const flags = matchFlags(post.tag)
  const linkedTitle = post.tag.kind === 'movie' && post.tag.id

  return (
    <main className="article-page review-page">
      <Link className="movie-back" to={backTo}>
        <ArrowLeft size={15} /> {backLabel}
      </Link>
      <Breadcrumbs
        trail={[
          { name: 'WeekAdda', href: '/' },
          { name: 'Reviews', href: '/reviews' },
          ...(linkedTitle
            ? [{ name: post.tag.label, href: titlePath({ id: post.tag.id, title: post.tag.label }) }]
            : []),
          { name: post.title },
        ]}
      />
      <div className="blog-layout">
        <div className="blog-main">
      <article className="review-article">
        <header className="review-article-head">
          {post.tag.poster ? (
            <img className="blog-card-poster" src={post.tag.poster} alt="" />
          ) : flags.length > 0 ? (
            <span className="blog-card-poster flags">
              {flags.map((l, i) => (
                <img key={i} src={l} alt="" />
              ))}
            </span>
          ) : (
            <span className={`blog-card-poster fallback ${post.tag.kind}`}>
              {post.tag.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
            </span>
          )}
          <div className="blog-card-meta">
            <TagLine tag={post.tag} />
            <h1>{post.title}</h1>
            <span className="blog-card-byline">
              {post.official ? <OfficialStamp /> : post.author}{' '}
              {mine && <span className="blog-you">You</span>} ·{' '}
              <CalendarDays size={12} /> {timeAgo(post.ts)}
            </span>
          </div>
        </header>
        <div className="review-article-body">
          {post.body
            .split(/\n+/)
            .filter((p) => p.trim())
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
        <StarRow
          post={post}
          summary={rating}
          own={mine}
          onRated={(_postId, summary) => setRating(summary)}
        />
        {/* Only on your own review; the server checks the verified email again
            when either one is actually used */}
        {mine && (
          <div className="article-owner-tools">
            <Link
              className="article-owner-btn edit"
              to={`/reviews?editReview=${encodeURIComponent(post.id)}`}
            >
              <Pencil size={14} /> Edit
            </Link>
            {confirming ? (
              <>
                <button className="article-owner-btn danger" onClick={remove} disabled={busy}>
                  <Trash2 size={14} /> {busy ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <button className="article-owner-btn" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button className="article-owner-btn del" onClick={() => setConfirming(true)}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            {error && <span className="blog-error">{error}</span>}
          </div>
        )}
      </article>
      {/* Two ways onward, so the end of one review is never the end of the
          visit: the film it is about, and everyone else's takes. */}
      <div className="review-article-onward">
        {linkedTitle && (
          <Link to={titlePath({ id: post.tag.id, title: post.tag.label })}>
            Everything about {post.tag.label} <ArrowRight size={14} />
          </Link>
        )}
        <Link to="/reviews">
          More reviews on WeekAdda <ArrowRight size={14} />
        </Link>
      </div>

          {/* Other takes on the same film or match first — a second opinion on
              the same title is the most useful thing to read next */}
          {related.length > 0 && (
            <section className="review-related">
              <h2>More reviews</h2>
              <div className="review-related-grid">
                {related.map((p) => (
                  <Link key={p.id} className="review-related-card" to={reviewPath(p)}>
                    {p.tag?.poster ? (
                      <img src={p.tag.poster} alt="" loading="lazy" />
                    ) : (
                      <span className="review-related-icon">
                        {p.tag?.kind === 'movie' ? <Film size={15} /> : <Trophy size={15} />}
                      </span>
                    )}
                    <span className="review-related-text">
                      <b>{p.title}</b>
                      <small>
                        {p.tag?.label} ·{' '}
                        {p.official ? <OfficialStamp compact /> : p.author}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
        <ArticleIndex articles={articles} likes={articleLikes} />
      </div>
    </main>
  )
}
