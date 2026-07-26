import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Languages,
  Play,
  Share2,
  Star,
  Ticket,
  Users,
} from 'lucide-react'
import { BlogPost, Release } from '../types'
import { api, fetchPosts, trackClick } from '../api'
import { usePageMeta, titlePath } from '../seo'
import ReleaseCard, { coverGradient, formatDate, daysUntil } from '../components/ReleaseCard'
import { watchUrl, bookingUrls } from '../watchLinks'
import { platformClass, shareRelease } from '../share'

type TitleStatus = 'streaming' | 'upcoming-ott' | 'in-theatres' | 'upcoming-theatre'

interface TitleResponse {
  release: Release
  status: TitleStatus
  related: Release[]
}

export default function MovieDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<TitleResponse | null>(null)
  const [missing, setMissing] = useState(false)
  const [reviews, setReviews] = useState<BlogPost[]>([])

  useEffect(() => {
    setData(null)
    setMissing(false)
    api<TitleResponse>(`/title/${encodeURIComponent(id ?? '')}`)
      .then(setData)
      .catch(() => setMissing(true))
  }, [id])

  // The pre-rendered version of this page carries any reviews of the title,
  // along with Review schema. React clears that block on mount, so without
  // this the page a person sees would be missing what the crawler was shown —
  // which strands anyone arriving from a "<title> review" search, and leaves
  // the markup unsupported by visible content.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetchPosts()
      .then(({ posts }) => {
        if (!cancelled) setReviews(posts.filter((p) => p.tag?.kind === 'movie' && p.tag?.id === id))
      })
      .catch(() => setReviews([]))
    return () => {
      cancelled = true
    }
  }, [id])

  const r = data?.release
  const isOttTitle = data?.status === 'streaming' || data?.status === 'upcoming-ott'
  const metaText = r
    ? `${r.title} (${r.languageLabel}) — release date ${formatDate(r.releaseDate)}${
        r.platforms?.length ? `, streaming on ${r.platforms.join(', ')}` : ''
      }. ${r.overview}`
    : ''
  usePageMeta(
    r
      ? `${
          r.title.length > 45 ? `${r.title.slice(0, 42).replace(/\s+\S*$/, '')}…` : r.title
        } ${r.languageLabel} ${
          isOttTitle ? 'OTT Release Date & Platform' : 'Movie Release Date'
        } | WeekAdda`
      : 'WeekAdda — OTT Releases This Week India, New Movies & Cricket',
    r
      ? metaText.length <= 160
        ? metaText
        : `${metaText.slice(0, 157).replace(/\s+\S*$/, '')}…`
      : 'OTT releases this week in India, new movie releases by language, and cricket updates.'
  )

  if (missing) {
    return (
      <main className="movie-page">
        <div className="movie-page-missing">
          <h1>Title not found</h1>
          <p>This release is no longer in WeekAdda's 13-week window.</p>
          <Link className="movie-back" to="/movies">
            <ArrowLeft size={15} /> Browse this week's releases
          </Link>
        </div>
      </main>
    )
  }

  if (!r) {
    return (
      <main className="movie-page">
        <div className="movie-page-missing">
          <p>Loading…</p>
        </div>
      </main>
    )
  }

  const days = daysUntil(r.releaseDate)
  const kindLabel = r.contentType === 'series' ? 'Web series' : 'Movie'

  return (
    <main className="movie-page">
      <Link className="movie-back" to="/movies">
        <ArrowLeft size={15} /> All releases
      </Link>
      <div className="release-detail-grid movie-page-card">
        <div
          className="release-detail-poster"
          style={!r.poster ? { background: coverGradient(r.title) } : undefined}
        >
          {r.poster ? (
            <img src={r.poster} alt={`${r.title} poster`} />
          ) : (
            <span className="release-poster-title big">{r.title}</span>
          )}
        </div>
        <div className="release-detail-body">
          <span className="hero-eyebrow">
            {r.platforms?.length
              ? `${kindLabel} · ${days > 0 ? 'Coming to' : 'Streaming on'} ${r.platforms.join(', ')}`
              : isOttTitle
                ? `${kindLabel} · Coming to OTT India`
                : days > 0
                  ? `${kindLabel} · Coming to theatres`
                  : `${kindLabel} · In theatres`}
          </span>
          <h1>{r.title}</h1>
          {r.originalTitle !== r.title && <p className="release-original">({r.originalTitle})</p>}
          <div className="modal-meta">
            <span>
              <CalendarDays size={15} /> {formatDate(r.releaseDate)}
              {days > 0 && ` · in ${days} day${days === 1 ? '' : 's'}`}
            </span>
            <span>
              <Languages size={15} /> {r.languageLabel}
            </span>
            {r.rating > 0 && (
              <span className="rating">
                <Star size={15} fill="currentColor" /> {r.rating.toFixed(1)} / 10
              </span>
            )}
            {r.votes > 0 && (
              <span>
                <Users size={15} /> {new Intl.NumberFormat('en-IN').format(r.votes)} ratings
              </span>
            )}
          </div>
          {!isOttTitle && (
            <div className="platform-list">
              {bookingUrls(r.title).map((b) => (
                <a
                  key={b.label}
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={
                    days > 0
                      ? `${b.label} — advance booking when available`
                      : `Book tickets for ${r.title} on ${b.label}`
                  }
                  onClick={() =>
                    trackClick({
                      kind: 'book',
                      platform: b.label,
                      titleId: r.id,
                      title: r.title,
                      language: r.languageLabel,
                    })
                  }
                >
                  <Ticket size={13} />
                  Book on {b.label}
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          )}
          {r.platforms && r.platforms.length > 0 && (
            <div className="platform-list">
              {r.platforms.map((p) => (
                <a
                  key={p}
                  href={watchUrl(p, r.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={days > 0 ? `${p} — releases ${formatDate(r.releaseDate)}` : `Watch ${r.title} on ${p}`}
                  onClick={() =>
                    trackClick({
                      kind: 'watch',
                      platform: p,
                      titleId: r.id,
                      title: r.title,
                      language: r.languageLabel,
                    })
                  }
                >
                  <span className={`pf-dot ${platformClass(p)}`} />
                  <Play size={13} fill="currentColor" />
                  {days > 0 ? p : `Watch on ${p}`}
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          )}
          <p className="modal-synopsis">{r.overview}</p>
          <button className="share-wa" onClick={() => shareRelease(r)}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </div>

      {reviews.length > 0 && (
        <>
          <div className="section-head movie-related-head">
            <h2>
              {r.title} review — what viewers said
            </h2>
            <span className="count">
              {reviews.length} review{reviews.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="movie-reviews">
            {reviews.map((p) => (
              <article key={p.id} className="movie-review">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
                <span className="movie-review-by">— {p.author}</span>
              </article>
            ))}
            <Link to="/reviews" className="movie-review-all">
              All reviews on WeekAdda →
            </Link>
          </div>
        </>
      )}

      {data.related.length > 0 && (
        <>
          <div className="section-head movie-related-head">
            <h2>More {r.languageLabel} releases</h2>
          </div>
          <div className="release-grid">
            {data.related.map((rel, i) => (
              <ReleaseCard key={rel.id} release={rel} index={i} onOpen={(t) => navigate(titlePath(t))} />
            ))}
          </div>
        </>
      )}
    </main>
  )
}
