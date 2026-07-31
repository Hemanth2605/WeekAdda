import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Tag } from 'lucide-react'
import { authEnabled, refreshUser, signInWithGoogle } from '../auth'
import { ratePost } from '../api'
import { titlePath } from '../seo'
import { BlogPost, BlogTag, RatingSummary } from '../types'

/**
 * The pieces a review renders with, shared by the feed at /reviews and by one
 * review's own page at /review/:id/:slug. They live here rather than in either
 * page so the two can never drift into showing the same review differently.
 */

export function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The line under a match tag, with the countries taken out.
 *
 * The label already says "India vs Zimbabwe"; the series it came from is
 * "India tour of Zimbabwe T20I Series", so the pair rendered as the same two
 * countries twice in one breath. What is actually informative is the format
 * and the date, so that is what survives.
 *
 * Done at render, not at publish, so reviews already written are fixed too —
 * their tag was stored with the full series and cannot be rewritten.
 */
export function matchSubtitle(tag: BlogTag): string {
  if (tag.kind !== 'match' || !tag.sub) return tag.sub ?? ''
  const teams = tag.label
    .split(/\s+v(?:s)?\.?\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    // Longest first, so "West Indies" goes before "India" — and \b either
    // side, so "India" is not found inside "Indies"
    .sort((a, b) => b.length - a.length)
  let out = tag.sub
  for (const team of teams) out = out.replace(new RegExp(`\\b${escapeRe(team)}\\b`, 'gi'), '')
  return (
    out
      .replace(/\btour of\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      // "India in Zimbabwe T20I Series" leaves a stranded "in" once both
      // countries are gone; the same goes for the other joining words
      .replace(/^(?:in|at|of|v|vs|and)\b\s*/i, '')
      .replace(/^[\s,·–-]+/, '')
      .replace(/\s*·\s*·\s*/g, ' · ')
      .trim()
  )
}

export function TagLine({ tag }: { tag: BlogTag }) {
  const sub = matchSubtitle(tag)
  const inner = (
    <>
      <Tag size={12} /> {tag.label}
      {sub && <em> · {sub}</em>}
    </>
  )
  if (tag.kind !== 'movie' || !tag.id) return <span className="blog-card-tag">{inner}</span>
  return (
    <Link
      className="blog-card-tag linked"
      to={titlePath({ id: tag.id, title: tag.label })}
      // The card behind this opens the review; the link must win
      onClick={(e) => e.stopPropagation()}
      title={`Everything about ${tag.label}`}
    >
      {inner}
    </Link>
  )
}

/**
 * 5-star rating row on a post. Reading is free; the first click from a
 * signed-out visitor opens the Google popup, then their rating applies.
 * Authors can see their post's average but can't rate it themselves.
 */
export function StarRow({
  post,
  summary,
  own,
  onRated,
}: {
  post: BlogPost
  summary?: RatingSummary
  own: boolean
  onRated: (postId: string, summary: RatingSummary) => void
}) {
  const [hover, setHover] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const interactive = authEnabled && !own

  const shown = hover || summary?.mine || Math.round(summary?.avg ?? 0)

  const rate = async (value: number) => {
    if (!interactive || busy) return
    setBusy(true)
    setNote('')
    try {
      let token = refreshUser()?.token
      if (!token) token = (await signInWithGoogle()).token
      const fresh = await ratePost(post.id, value, token)
      onRated(post.id, fresh)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message !== 'popup_closed' && message !== 'popup_closed_by_user') {
        setNote(message || 'Could not save your rating — please try again')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    // Rating clicks must not bubble into the card's open-modal click
    <div className="post-rating" onClick={(e) => e.stopPropagation()}>
      <span
        className={`post-stars${interactive ? ' interactive' : ''}`}
        onMouseLeave={() => setHover(0)}
        role={interactive ? 'radiogroup' : undefined}
        aria-label={interactive ? 'Rate this take' : undefined}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className={`post-star${value <= shown ? ' filled' : ''}${summary?.mine ? ' mine' : ''}`}
            disabled={!interactive || busy}
            onMouseEnter={() => interactive && setHover(value)}
            onClick={() => rate(value)}
            title={
              own
                ? 'Your take — others rate it'
                : summary?.mine
                  ? `Your rating: ${summary.mine} — click to change`
                  : `Rate ${value} star${value === 1 ? '' : 's'}`
            }
          >
            <Star size={15} fill={value <= shown ? 'currentColor' : 'none'} />
          </button>
        ))}
      </span>
      <span className="post-rating-meta">
        {summary && summary.count > 0 ? (
          <>
            {summary.avg.toFixed(1)} · {summary.count} rating{summary.count === 1 ? '' : 's'}
            {own && <em> · your take</em>}
            {summary.mine ? <em> · you rated {summary.mine}</em> : null}
          </>
        ) : own ? (
          <em>your take — no ratings yet</em>
        ) : (
          <em>be the first to rate</em>
        )}
      </span>
      {note && <span className="post-rating-note">{note}</span>}
    </div>
  )
}
