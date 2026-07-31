import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Film,
  Pencil,
  Play,
  Trash2,
  Trophy,
} from 'lucide-react'
import {
  deleteArticle,
  fetchArticle,
  fetchArticleLikes,
  fetchMyArticles,
  trackClick,
} from '../api'
import { refreshUser, useGoogleUser } from '../auth'
import { usePageMeta, titlePath } from '../seo'
import { findFilmMentions, watchHref } from '../filmLinks'
import { platformClass } from '../share'
import { Article, LikeSummary } from '../types'
import Breadcrumbs from '../components/Breadcrumbs'
import ArticleIndex from '../components/ArticleIndex'
import Prose from '../components/Prose'
import OfficialStamp from '../components/OfficialStamp'
import LikeButton from '../components/LikeButton'
import { ArticlePageSkeleton } from '../components/Skeletons'
import { timeAgo } from '../components/ReviewBits'

const TOPIC_LABEL: Record<Article['topic'], string> = { movie: 'Movies', match: 'Cricket' }

/**
 * One article, in full, with the related rail alongside — the same panel that
 * sits beside the reviews feed, so reading one article always leaves another
 * within reach. The Worker pre-renders both (buildArticlePage in seo.ts), and
 * those related links are the only crawlable path from one article to the next.
 */
export default function ArticleDetail() {
  const { id } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [related, setRelated] = useState<Article[]>([])
  const [missing, setMissing] = useState(false)
  // Whether this is the reader's own article. Asked by id: the server matches
  // the verified email, and the answer is only ever "which are yours".
  const [mine, setMine] = useState(false)
  // Where this was opened from, when the link said. Falls back to the reviews
  // page for a shared link or a direct visit, which has no history to honour.
  const origin = useLocation().state as { from?: string; fromLabel?: string } | null
  const backTo = origin?.from ?? '/reviews'
  const backLabel = origin?.fromLabel ?? 'Reviews and articles'
  // The whole map, not just this article's: the rail beside it shows counts
  // too, and fetching the same endpoint twice for that would be daft
  const [likes, setLikes] = useState<Record<string, LikeSummary>>({})
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const user = useGoogleUser()
  const navigate = useNavigate()

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh || !id) return setMine(false)
    fetchMyArticles(fresh.token)
      .then((r) => setMine(r.articles.some((a) => a.id === id)))
      .catch(() => setMine(false))
  }, [id, user])

  // Refetched on sign-in/out so "you liked this" stays true for whoever is
  // actually reading; the count itself never needs an account
  useEffect(() => {
    if (!id) return
    fetchArticleLikes(user ? refreshUser()?.token : undefined)
      .then((r) => setLikes(r.likes))
      .catch(() => {})
  }, [id, user])

  const remove = async () => {
    const fresh = refreshUser()
    if (!fresh || !id || busy) return
    setBusy(true)
    setError('')
    try {
      await deleteArticle(id, fresh.token)
      // Back where it was opened from — after deleting your own article from
      // your list, /reviews is not where you were
      navigate(backTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete — please try again')
      setBusy(false)
    }
  }

  useEffect(() => {
    setArticle(null)
    setRelated([])
    setMissing(false)
    fetchArticle(id ?? '')
      .then((r) => {
        setArticle(r.article)
        setRelated(r.related)
      })
      .catch(() => setMissing(true))
  }, [id])

  // Which films the prose names, worked out the same way Prose does it — so the
  // block below can carry only what the badges did not already cover
  const unnamedFilms = useMemo(() => {
    const films = article?.films ?? []
    if (!article || films.length === 0) return []
    const used = new Set<string>()
    for (const p of article.body.split(/\n+/)) {
      if (p.trim()) findFilmMentions(p.trim(), films, used)
    }
    return films.filter((f) => !used.has(f.title))
  }, [article])

  const flat = article ? article.body.replace(/\s+/g, ' ').trim() : ''
  usePageMeta(
    article
      ? `${article.title.length > 60 ? `${article.title.slice(0, 57).replace(/\s+\S*$/, '')}…` : article.title} | WeekAdda`
      : 'Movie & Cricket Reviews by Real Viewers | WeekAdda',
    article
      ? `${article.author} on ${TOPIC_LABEL[article.topic]}: ${flat.slice(0, 157)}${flat.length > 157 ? '…' : ''}`
      : 'Honest reviews of this week’s movies, OTT releases and cricket matches — written by the people who actually watched them.'
  )

  if (missing) {
    return (
      <main className="movie-page">
        <div className="movie-page-missing">
          <h1>Article not found</h1>
          <p>This article is no longer on WeekAdda.</p>
          <Link className="movie-back" to="/reviews">
            <ArrowLeft size={15} /> Reviews and articles
          </Link>
        </div>
      </main>
    )
  }

  if (!article) {
    // Shaped like the article that is coming, so nothing jumps when it lands
    return (
      <main className="article-page">
        <div className="blog-layout">
          <div className="blog-main">
            <ArticlePageSkeleton />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="article-page">
      <Link className="movie-back" to={backTo}>
        <ArrowLeft size={15} /> {backLabel}
      </Link>
      <Breadcrumbs
        trail={[
          { name: 'WeekAdda', href: '/' },
          { name: 'Reviews', href: '/reviews' },
          { name: article.title },
        ]}
      />
      <div className="blog-layout">
        <div className="blog-main">
          <article className="review-article">
            <header className="article-article-head">
              <span className="blog-card-tag">
                {article.topic === 'movie' ? <Film size={12} /> : <Trophy size={12} />}{' '}
                {TOPIC_LABEL[article.topic]}
              </span>
              <h1>{article.title}</h1>
              <span className="blog-card-byline">
                {/* Site pieces carry the stamp alone; everyone else is named */}
                {article.official ? <OfficialStamp /> : article.author} ·{' '}
                <CalendarDays size={12} /> {timeAgo(article.ts)}
              </span>
            </header>
            {article.image && (
              <img
                className="article-cover"
                src={article.image}
                alt=""
                loading="lazy"
                // Framing chosen by the writer after upload — the stored bytes
                // are untouched, so this is the only place the crop exists
                style={{
                  objectFit: article.imageFit ?? 'cover',
                  objectPosition: article.imagePosition ?? '50% 50%',
                }}
              />
            )}
            <Prose
              className="review-article-body"
              text={article.body}
              films={article.films ?? []}
              onWatch={(film, platform) =>
                trackClick({
                  kind: 'watch',
                  platform,
                  titleId: film.id ?? '',
                  title: film.title,
                  language: '',
                })
              }
            />
            {/* Only what the prose never named — a film already badged beside
                its own mention does not need saying twice */}
            {unnamedFilms.length > 0 && (
              <section className="article-watch">
                <h2>Where to watch</h2>
                {unnamedFilms.map((f, i) => (
                  <div key={`${f.title}-${i}`} className="article-watch-film">
                    {f.id ? (
                      <Link className="article-watch-title" to={titlePath({ id: f.id, title: f.title })}>
                        {f.title}
                      </Link>
                    ) : (
                      <span className="article-watch-title plain">{f.title}</span>
                    )}
                    {f.platforms.length > 0 && (
                      <div className="platform-list">
                        {f.platforms.map((p) => (
                          <a
                            key={p.name}
                            href={watchHref(p, f.title)}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            title={`Watch ${f.title} on ${p.name}`}
                            onClick={() =>
                              trackClick({
                                kind: 'watch',
                                platform: p.name,
                                titleId: f.id ?? '',
                                title: f.title,
                                language: '',
                              })
                            }
                          >
                            <span className={`pf-dot ${platformClass(p.name)}`} />
                            <Play size={13} fill="currentColor" />
                            Watch on {p.name}
                            <ExternalLink size={11} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
            <LikeButton
              articleId={article.id}
              summary={likes[article.id]}
              own={mine}
              onChange={(fresh) => setLikes((all) => ({ ...all, [article.id]: fresh }))}
            />
            {/* Only on your own piece, and only ever your own — the server
                checks the verified email again when either one is used */}
            {mine && (
              <div className="article-owner-tools">
                <Link className="article-owner-btn" to={`/reviews?edit=${encodeURIComponent(article.id)}`}>
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
                  <button className="article-owner-btn" onClick={() => setConfirming(true)}>
                    <Trash2 size={14} /> Delete
                  </button>
                )}
                {error && <span className="blog-error">{error}</span>}
              </div>
            )}
            <div className="review-article-onward">
              <Link to="/reviews">
                Reviews and articles on WeekAdda <ArrowRight size={14} />
              </Link>
            </div>
          </article>
        </div>
        <ArticleIndex
          articles={related}
          heading="More articles"
          currentId={article.id}
          likes={likes}
          write
        />
      </div>
    </main>
  )
}
