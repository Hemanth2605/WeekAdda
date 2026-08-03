import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookMarked } from 'lucide-react'
import { daysUntil } from './ReleaseCard'
import { Release } from '../types'

/**
 * The one place an account is offered, and it is offered where the thought
 * already is.
 *
 * A list of what signing in gets you belongs on no landing page — nobody
 * arrives wanting features. But someone looking at a film that came out last
 * week may well have seen it, and here the film is named, in front of them, and
 * the offer takes one tap.
 *
 * Only one thing is offered, and only the private one. Reviews and ratings are
 * on every site; a record of what *you* watched is not, and it is the only one
 * that gets more valuable the longer someone keeps it.
 *
 * Lives in its own component because it appears in two places that are easy to
 * let drift: the modal, which is where most people look at a film, and the
 * title page, which is where people arriving from search land. The modal is the
 * one that matters for reach — a card opens it, and most readers never go
 * further than that.
 */
export default function LogInvite({
  release,
  /** The modal closes on the way out; the page has nothing to close. */
  onNavigate,
}: {
  release: Release
  onNavigate?: () => void
}) {
  const navigate = useNavigate()

  // Never on a film nobody could have watched yet. "Watched it?" about
  // something out next week is a question with no honest answer, and asking it
  // costs more than staying quiet.
  if (daysUntil(release.releaseDate) > 0) return null

  return (
    <button
      className="log-invite"
      onClick={() => {
        // Navigate first, close second — the same order the mini player uses,
        // for the same reason: closing hands focus back and races the move
        navigate('/reviews', {
          state: {
            logFilm: {
              kind: 'movie',
              id: release.id,
              label: release.title,
              sub: release.languageLabel,
              poster: release.poster,
            },
          },
        })
        onNavigate?.()
      }}
    >
      {/* Movies violet, not a borrowed one. It had `ico-soon` — Coming Soon's
          teal → blue — which is a section palette on something that is not that
          section, and worse, on a card only ever shown for a film already out.
          The log form's own film toggle is violet for the same reason: the tile
          takes the colour of what it names. */}
      <span className="log-invite-ico ico-movies">
        <BookMarked size={15} />
      </span>
      <span className="log-invite-text">
        <b>Watched it? Save it to your log</b>
        <small>
          A private record of what you watched, where and when — yours only, never shown
          to anyone.
        </small>
      </span>
      <ArrowRight size={15} className="log-invite-go" />
    </button>
  )
}
