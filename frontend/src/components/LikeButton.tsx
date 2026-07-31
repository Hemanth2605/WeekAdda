import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { likeArticle } from '../api'
import { authEnabled, refreshUser, signInWithGoogle } from '../auth'
import { LikeSummary } from '../types'

/**
 * The heart on an article. One per account, tap again to take it back.
 *
 * A like rather than the review's five stars: an article is liked or it is
 * not, and a single count can never be misread as a verdict on the film or
 * match it discusses. Reading the count never needs an account; adding to it
 * does — the first tap from a signed-out reader opens the Google popup, which
 * is why this only ever fires from a click.
 */
export default function LikeButton({
  articleId,
  summary,
  own,
  onChange,
}: {
  articleId: string
  summary?: LikeSummary
  /** Your own article — the count still shows, the heart is not yours to give. */
  own?: boolean
  onChange: (summary: LikeSummary) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  // Bumped to replay the burst; the timer only clears the caption under it
  const [burst, setBurst] = useState(0)
  const [celebrating, setCelebrating] = useState(false)
  const count = summary?.count ?? 0
  const liked = Boolean(summary?.mine)

  // A timer that outlives the component would set state on nothing
  useEffect(() => {
    if (!celebrating) return
    const timer = setTimeout(() => setCelebrating(false), 2600)
    return () => clearTimeout(timer)
  }, [celebrating])

  const toggle = async () => {
    if (own || busy || !authEnabled) return
    setBusy(true)
    setNote('')
    try {
      const token = refreshUser()?.token ?? (await signInWithGoogle()).token
      const fresh = await likeArticle(articleId, token)
      // Only the one that takes it from nothing to something — a burst on
      // every like would be noise, and on an unlike it would be a lie
      if (fresh.count === 1 && fresh.mine) {
        setBurst((n) => n + 1)
        setCelebrating(true)
      }
      onChange(fresh)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message !== 'popup_closed' && message !== 'popup_closed_by_user') {
        setNote(message || 'Could not save that — please try again')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="like-row">
      <span className="like-wrap">
        {/* Keyed on the counter so a later first-like replays it rather than
            being ignored as an unchanged element */}
        {burst > 0 && (
          <span key={burst} className="like-burst" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} style={{ ['--a' as string]: `${i * 36}deg` }} />
            ))}
          </span>
        )}
      <button
        className={`like-btn${liked ? ' liked' : ''}${own ? ' own' : ''}${
          celebrating ? ' pop' : ''
        }`}
        onClick={toggle}
        disabled={busy || own}
        aria-pressed={liked}
        title={
          own
            ? 'Your article — others give the hearts'
            : liked
              ? 'You liked this — tap to undo'
              : 'Like this article'
        }
      >
        <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
        <span>{count}</span>
      </button>
      </span>
      <span className={`like-meta${celebrating ? ' cheering' : ''}`}>
        {celebrating
          ? 'First like — you got it off the mark!'
          : own
            ? count === 0
              ? 'your article — no likes yet'
              : `${count} ${count === 1 ? 'person likes' : 'people like'} this`
            : liked
              ? 'You liked this'
              : count === 0
                ? 'Be the first to like it'
                : `${count} ${count === 1 ? 'like' : 'likes'}`}
      </span>
      {note && <span className="post-rating-note">{note}</span>}
    </div>
  )
}
