import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Home, MapPin, Pencil, Ticket, Trash2 } from 'lucide-react'
import { deleteLog, fetchLogs, signLogImage } from '../api'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import WatchLogForm from '../components/WatchLogForm'
import { usePageMeta } from '../seo'
import { WatchLog } from '../types'

/**
 * One entry from the private log, in full — the only place the note is shown
 * whole rather than clipped.
 *
 * Fetched by loading the account's own log and finding the id, rather than
 * through a by-id endpoint. That is deliberate: a `/api/logs/:id` GET would be
 * a route that takes an id from a stranger and looks it up, and the only thing
 * stopping it returning someone else's entry would be a filter written
 * correctly every time. There is no such route, so there is nothing to get
 * wrong — an id you do not own is simply not in what you are given.
 */
export default function LogEntry() {
  const { id } = useParams<{ id: string }>()
  const user = useGoogleUser()
  const navigate = useNavigate()
  const location = useLocation()
  const [entry, setEntry] = useState<WatchLog | null | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  // A signed URL for the photo, good for an hour. Fetched per view rather than
  // stored, because a stored one would outlive its signature.
  const [photo, setPhoto] = useState<string | null>(null)

  usePageMeta('Your log | WeekAdda', 'One entry from your private watch log.')

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh || !id) return setEntry(undefined)
    fetchLogs(fresh.token)
      .then((r) => setEntry(r.logs.find((l) => l.id === id) ?? null))
      .catch(() => setEntry(null))
  }, [id, user])

  useEffect(() => {
    let cancelled = false
    const stored = entry && typeof entry === 'object' ? entry.image : undefined
    const token = refreshUser()?.token
    if (!stored || !token) return setPhoto(null)
    signLogImage(stored, token)
      .then((url) => !cancelled && setPhoto(url))
      .catch(() => !cancelled && setPhoto(null))
    return () => {
      cancelled = true
    }
  }, [entry])

  /** Where the back link goes: whatever opened this, or the log itself. */
  const from = (location.state as { from?: string } | null)?.from ?? '/my-reviews?tab=private'

  if (authEnabled && !user) {
    return (
      <main className="article-page">
        <div className="empty-state">
          <Ticket size={54} />
          <h3>Sign in to see this entry</h3>
          <p>Your log is private and tied to your Google account.</p>
          <GoogleButton onError={() => {}} />
        </div>
      </main>
    )
  }

  if (entry === null) {
    return (
      <main className="article-page">
        <div className="empty-state">
          <Ticket size={54} />
          <h3>Not in your log</h3>
          <p>This entry has been removed, or it was never yours.</p>
          <Link className="empty-onward" to="/my-reviews?tab=private">
            Back to your log
          </Link>
        </div>
      </main>
    )
  }

  if (!entry) {
    return (
      <main className="article-page">
        <div className="sk sk-line" style={{ width: 220, height: 26 }} aria-hidden="true" />
      </main>
    )
  }

  const remove = () => {
    const token = refreshUser()?.token
    if (!token) return
    deleteLog(entry.id, token).catch(() => {})
    navigate(from)
  }

  const day = new Date(entry.watchedOn + 'T00:00:00')

  return (
    <main className="article-page log-page">
      <Link className="movie-back" to={from}>
        <ArrowLeft size={15} /> Your log
      </Link>

      {editing ? (
        // In place of the ticket, so the change happens where the entry is.
        // Keyed by id for the usual reason: a fresh form rather than one
        // holding another entry's fields.
        <div className="log-edit-panel">
          <span className="log-page-label">Editing this entry</span>
          <WatchLogForm
            key={entry.id}
            kind={entry.kind}
            editing={entry}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setEntry(updated)
              setEditing(false)
            }}
          />
        </div>
      ) : (
      <>
      {/* A ticket stub, because that is what the entry is a record of — the
          top half carries the where, the stub below carries the rest, and the
          perforation between them is the only decoration that had to be here.
          A plain heading and two paragraphs said all the same things and was
          worth looking at exactly once. */}
      <article className={`log-ticket ${entry.where}`}>
        <div className="log-ticket-top">
          <span className="log-ticket-kind">
            <span className="log-emoji">{entry.kind === 'match' ? '🏏' : '🍿'}</span>
            {entry.kind === 'match' ? 'Match' : 'Film'}
            {' · '}
            {entry.where === 'out' ? 'Watched out' : 'Watched at home'}
          </span>
          <h1>{entry.title}</h1>
          <span className={`log-ticket-venue ${entry.where}`}>
            {entry.where === 'out' ? <Ticket size={14} /> : <Home size={14} />}
            {entry.venue || (entry.where === 'out' ? 'Somewhere out' : 'At home')}
            {entry.city && (
              <>
                <span className="log-ticket-sep">·</span>
                <MapPin size={13} className="log-ticket-pin" /> {entry.city}
              </>
            )}
          </span>
        </div>

        {/* The tear: two notches and a dashed rule, drawn rather than imaged */}
        <div className="log-ticket-tear" aria-hidden="true">
          <span />
          <span />
        </div>

        <div className="log-ticket-stub">
          {/* The date set as a date rather than squeezed into a tile: the day
              large in the display serif, the rest stacked beside it behind a
              hairline. A 12px calendar icon in a page this size was a stamp
              where the stub had room for the real thing. */}
          <div className="log-ticket-when">
            <b>{String(day.getDate()).padStart(2, '0')}</b>
            <span className="log-ticket-when-rest">
              <em>{day.toLocaleDateString('en-IN', { weekday: 'long' })}</em>
              <small>
                {day.toLocaleDateString('en-IN', { month: 'long' })} {day.getFullYear()}
              </small>
            </span>
          </div>

          {/* The reason this page exists: a line in the log can only ever show
              an opening, and the note is usually the whole point of the entry.
              Set as a pull quote — it is the only writing on the page. */}
          {/* Signed on the way in and only for its owner — the bucket is
              private, so there is no URL that works without this */}
          {photo && (
            <img
              className="log-ticket-photo"
              src={photo}
              alt=""
              // Framed exactly as it was in the composer — the point of storing
              // the pair rather than cropping the file
              style={{
                objectFit: entry.imageFit ?? 'cover',
                objectPosition: entry.imagePosition ?? '50% 50%',
              }}
            />
          )}

          {entry.note ? (
            <blockquote className="log-ticket-note">{entry.note}</blockquote>
          ) : (
            !entry.image && <p className="log-ticket-empty">No note on this one.</p>
          )}
        </div>
      </article>

      <div className="article-owner-tools">
        {/* Opens the form here rather than sending you back to the list to
            find this entry again. It was a Link handing state to a page that
            never read it, so it simply navigated away — the one thing an edit
            button must not do. */}
        <button className="article-owner-btn edit" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit this entry
        </button>
        {confirming ? (
          <>
            <button className="article-owner-btn danger" onClick={remove}>
              <Trash2 size={14} /> Yes, remove it
            </button>
            <button className="article-owner-btn" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="article-owner-btn del" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
      </>
      )}
    </main>
  )
}
