import { Star, Play, Ticket, MessageCircle } from 'lucide-react'
import { Release } from '../types'
import { watchUrl, bookingUrls } from '../watchLinks'
import { trackClick } from '../api'
import { platformClass, shareRelease } from '../share'

// Deterministic gradient for films without poster art
export function coverGradient(title: string) {
  let hash = 0
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 40 + (Math.abs(hash >> 8) % 60)) % 360
  return `linear-gradient(160deg, hsl(${h1}, 45%, 16%), hsl(${h2}, 55%, 32%))`
}

export function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function daysUntil(iso: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86_400_000)
}

interface Props {
  release: Release
  index: number
  onOpen: (release: Release) => void
}

export default function ReleaseCard({ release, index, onOpen }: Props) {
  const days = daysUntil(release.releaseDate)
  const isOtt = Boolean(release.platforms?.length)
  const isUpcoming = days > 0
  const isNew = !isOtt && days <= 0 && days >= -10

  return (
    <article
      className="release-card"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={() => onOpen(release)}
    >
      <div className="release-poster" style={!release.poster ? { background: coverGradient(release.title) } : undefined}>
        {release.poster ? (
          <img src={release.poster} alt={release.title} loading="lazy" />
        ) : (
          <span className="release-poster-title">{release.title}</span>
        )}
        {isNew && <span className="release-flag new">New</span>}
        {isUpcoming && (
          <span className={`release-flag soon${isOtt ? ' right' : ''}`}>
            {days === 1 ? 'Tomorrow' : `In ${days} days`}
          </span>
        )}
        {isOtt && (
          <span className={`release-flag ott ${platformClass(release.platforms![0])}`}>
            {release.platforms![0]}
            {release.platforms!.length > 1 && ` +${release.platforms!.length - 1}`}
          </span>
        )}
        {release.contentType === 'series' && <span className="release-kind">Series</span>}
        {isOtt && days <= 0 && (
          <a
            className="card-watch"
            href={watchUrl(release.platforms![0], release.title)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Watch ${release.title} on ${release.platforms![0]}`}
            onClick={(e) => {
              e.stopPropagation()
              trackClick({
                kind: 'watch',
                platform: release.platforms![0],
                titleId: release.id,
                title: release.title,
                language: release.languageLabel,
              })
            }}
          >
            <Play size={14} fill="currentColor" /> Watch
          </a>
        )}
        {!isOtt && days <= 0 && (
          <a
            className="card-watch"
            href={bookingUrls(release.title)[0].url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Book tickets for ${release.title} on BookMyShow`}
            onClick={(e) => {
              e.stopPropagation()
              trackClick({
                kind: 'book',
                platform: 'BookMyShow',
                titleId: release.id,
                title: release.title,
                language: release.languageLabel,
              })
            }}
          >
            <Ticket size={14} /> Book
          </a>
        )}
        {release.rating > 0 && (
          <span className="release-rating">
            <Star size={12} fill="currentColor" /> {release.rating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="release-info">
        <h4>{release.title}</h4>
        <p>
          <span className="date-cal" title={formatDate(release.releaseDate)}>
            <span className="date-cal-month">
              {new Date(release.releaseDate + 'T00:00:00').toLocaleDateString('en-IN', {
                month: 'short',
              })}
            </span>
            <span className="date-cal-day">
              {new Date(release.releaseDate + 'T00:00:00').getDate()}
            </span>
          </span>
          <span className="release-lang">{release.languageLabel}</span>
          <button
            className="card-share"
            title={`Share ${release.title} on WhatsApp`}
            onClick={(e) => {
              e.stopPropagation()
              shareRelease(release)
            }}
          >
            <MessageCircle size={13} />
          </button>
        </p>
      </div>
    </article>
  )
}
