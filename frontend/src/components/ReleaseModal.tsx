import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Star, CalendarDays, Languages, Users, Play, ExternalLink, Ticket, Share2 } from 'lucide-react'
import { Release } from '../types'
import { titlePath } from '../seo'
import { coverGradient, formatDate, daysUntil } from './ReleaseCard'
import { watchUrl, bookingUrls } from '../watchLinks'
import LogInvite from './LogInvite'
import { trackClick } from '../api'
import { platformClass, shareRelease } from '../share'
import { alsoInLabel, languageLabel, releaseLanguagesOf } from '../languages'

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
  const alsoIn = alsoInLabel(release.languages, release.language)
  // A pan-India film plays in several languages at once and the sites list each
  // separately, so the booking link has to be told which one. Defaults to the
  // language it was shot in; single-language films never see the picker.
  const bookLanguages = releaseLanguagesOf(release)
  const [bookLanguage, setBookLanguage] = useState(release.language)
  const bookLabel = languageLabel(bookLanguage)

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
                  ? `${release.contentType === 'series' ? 'Web series' : 'Movie'} · ${
                      days > 0 ? 'Coming to OTT India' : 'On OTT in India — platform to be announced'
                    }`
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
                {alsoIn && ` · also in ${alsoIn}`}
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
              <>
                {bookLanguages.length > 1 && (
                  <div className="book-lang-row">
                    <span className="book-lang-label">Book in</span>
                    {bookLanguages.map((code) => (
                      <button
                        key={code}
                        className={`genre-chip${bookLanguage === code ? ' active' : ''}`}
                        onClick={() => setBookLanguage(code)}
                      >
                        {languageLabel(code)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="platform-list">
                  {bookingUrls(
                    release.title,
                    bookLanguages.length > 1 ? bookLabel : undefined
                  ).map((b) => (
                    <a
                      key={b.label}
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={
                        days > 0
                          ? `${b.label} — advance booking when available`
                          : `Book ${bookLabel} tickets for ${release.title} on ${b.label}`
                      }
                      onClick={() =>
                        trackClick({
                          kind: 'book',
                          platform: b.label,
                          titleId: release.id,
                          title: release.title,
                          language: bookLabel,
                        })
                      }
                    >
                      <Ticket size={13} />
                      Book on {b.label}
                      <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </>
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
            <div className="modal-actions">
              <button className="share-wa" onClick={() => shareRelease(release)}>
                <Share2 size={16} /> Share
              </button>
              <Link className="modal-page-link" to={titlePath(release)} onClick={onClose}>
                Full page <ExternalLink size={13} />
              </Link>
            </div>
            {/* Here as much as on the title page, and here matters more: a card
                opens this, and most readers never go further than it */}
            <LogInvite release={release} onNavigate={onClose} />
          </div>
        </div>
      </div>
    </div>
  )
}
