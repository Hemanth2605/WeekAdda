import { useEffect } from 'react'
import { X, Star, CalendarDays, Languages, Users, Play, ExternalLink, Ticket, MessageCircle } from 'lucide-react'
import { Release } from '../types'
import { coverGradient, formatDate, daysUntil } from './ReleaseCard'
import { watchUrl, bookingUrls } from '../watchLinks'
import { trackClick } from '../api'
import { platformClass, shareRelease } from '../share'

interface Props {
  release: Release
  onClose: () => void
}

export default function ReleaseModal({ release, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const days = daysUntil(release.releaseDate)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal release-detail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="release-detail-grid">
          <div
            className="release-detail-poster"
            style={!release.poster ? { background: coverGradient(release.title) } : undefined}
          >
            {release.poster ? (
              <img src={release.poster} alt={release.title} />
            ) : (
              <span className="release-poster-title big">{release.title}</span>
            )}
          </div>
          <div className="release-detail-body">
            <span className="hero-eyebrow">
              {release.platforms?.length
                ? `${release.contentType === 'series' ? 'Web series' : 'Movie'} · ${
                    days > 0 ? 'Coming to' : 'Streaming on'
                  } ${release.platforms.join(', ')}`
                : release.contentType
                  ? `${release.contentType === 'series' ? 'Web series' : 'Movie'} · Coming to OTT India`
                  : days > 0
                    ? 'Coming soon'
                    : 'In theatres'}
            </span>
            <h2>{release.title}</h2>
            {release.originalTitle !== release.title && (
              <p className="release-original">({release.originalTitle})</p>
            )}
            <div className="modal-meta">
              <span>
                <CalendarDays size={15} /> {formatDate(release.releaseDate)}
                {days > 0 && ` · in ${days} day${days === 1 ? '' : 's'}`}
              </span>
              <span>
                <Languages size={15} /> {release.languageLabel}
              </span>
              {release.rating > 0 && (
                <span className="rating">
                  <Star size={15} fill="currentColor" /> {release.rating.toFixed(1)} / 10
                </span>
              )}
              {release.votes > 0 && (
                <span>
                  <Users size={15} /> {new Intl.NumberFormat('en-IN').format(release.votes)} ratings
                </span>
              )}
            </div>
            {!release.platforms?.length && !release.contentType && (
              <div className="platform-list">
                {bookingUrls(release.title).map((b) => (
                  <a
                    key={b.label}
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      days > 0
                        ? `${b.label} — advance booking when available`
                        : `Book tickets for ${release.title} on ${b.label}`
                    }
                    onClick={() =>
                      trackClick({
                        kind: 'book',
                        platform: b.label,
                        titleId: release.id,
                        title: release.title,
                        language: release.languageLabel,
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
            {release.platforms && release.platforms.length > 0 && (
              <div className="platform-list">
                {release.platforms.map((p) => (
                  <a
                    key={p}
                    href={watchUrl(p, release.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={days > 0 ? `${p} — releases ${formatDate(release.releaseDate)}` : `Watch ${release.title} on ${p}`}
                    onClick={() =>
                      trackClick({
                        kind: 'watch',
                        platform: p,
                        titleId: release.id,
                        title: release.title,
                        language: release.languageLabel,
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
            <p className="modal-synopsis">{release.overview}</p>
            <button className="share-wa" onClick={() => shareRelease(release)}>
              <MessageCircle size={16} /> Share on WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
