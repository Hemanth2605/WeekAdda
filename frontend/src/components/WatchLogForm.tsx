import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Film, Home, MapPin, Plus, Search, Ticket, Trophy } from 'lucide-react'
import { api, createLog, updateLog } from '../api'
import { authEnabled, refreshUser, useGoogleUser } from '../auth'
import { OTT_PLATFORMS } from '../platforms'
import { platformClass } from '../share'
import DayPicker from './DayPicker'
import LogPhoto from './LogPhoto'
import { DEFAULT_POSITION } from './ArticleImagePicker'
import GoogleButton from './GoogleButton'
import { CricketMatch, Release, WatchLog } from '../types'

/**
 * "Just for me" — the private half of the composer.
 *
 * Deliberately not a review form with a switch on it. A log is kept or it is
 * not, and the thing that stops one being kept is being asked for a headline
 * and three sentences about a Tuesday show. So: what, where, when, and a note
 * only if you feel like leaving one.
 *
 * The film can be picked from the release cache — which fills the title in and
 * remembers its id — or simply typed, because most of what anyone watches is
 * older than thirteen weeks.
 */
export default function WatchLogForm({
  kind,
  editing,
  starter,
  onSaved,
  onCancel,
}: {
  /**
   * A film or a match. Owned by the composer rather than by this form, because
   * its toggle sits beside the composer's own heading — everything here still
   * reads from it: what the search looks through, what "out" is called, and
   * what the venue field asks for.
   */
  kind: 'movie' | 'match'
  /** An existing entry to change. Absent means this is a new one. */
  editing?: WatchLog
  /**
   * A film already decided on, from somewhere that knew it — the "save it to
   * your log" line on a title page hands over the film whose page it was on.
   * Only seeds a *new* entry; editing carries its own title and must win.
   */
  starter?: { title: string; titleId?: string }
  onSaved: (log: WatchLog) => void
  /** Shown only while editing — creating has no state worth abandoning. */
  onCancel?: () => void
}) {
  const [where, setWhere] = useState<'out' | 'home'>(editing?.where ?? 'out')
  const [title, setTitle] = useState(editing?.title ?? starter?.title ?? '')
  const [titleId, setTitleId] = useState<string | undefined>(editing?.titleId ?? starter?.titleId)
  /**
   * Whether the typed name is settled — either picked from the list or
   * confirmed as free text. Until it is, the options stay open; once it is, a
   * list under the field would be asking a question that has been answered.
   */
  const [accepted, setAccepted] = useState(Boolean(editing || starter))

  const [venue, setVenue] = useState(editing?.venue ?? '')
  const [city, setCity] = useState(editing?.city ?? '')
  const [watchedOn, setWatchedOn] = useState(
    () => editing?.watchedOn ?? new Date().toISOString().slice(0, 10)
  )
  const [note, setNote] = useState(editing?.note ?? '')
  const [image, setImage] = useState<string | undefined>(editing?.image)
  const [imagePosition, setImagePosition] = useState(editing?.imagePosition ?? DEFAULT_POSITION)
  const [imageFit, setImageFit] = useState<'cover' | 'contain'>(editing?.imageFit ?? 'cover')
  // Candidates to pick from: this window's releases, or the recent fixtures.
  // Both are searched by name; anything older is simply typed.
  const [pool, setPool] = useState<Array<{ id: string; title: string; sub: string; poster: string | null }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState<'title' | null>(null)
  // The entry just added, held only to confirm it. Cleared by "Log another",
  // which is what returns the form.
  const [saved, setSaved] = useState<WatchLog | null>(null)
  const user = useGoogleUser()
  const needsSignIn = authEnabled && !user

  /**
   * A title picked from one list means nothing in the other, so a switch
   * upstream clears it here rather than leaving a fixture named as a film.
   *
   * Guarded on the *value* rather than on "is this the first run". A
   * first-run flag looks equivalent and is not: StrictMode invokes every effect
   * twice in development, so the flag was already spent on the second pass and
   * the clearing ran — wiping the title of the entry the form had just been
   * opened to edit. Comparing the previous kind is true however many times the
   * effect fires.
   */
  const prevKind = useRef(kind)
  useEffect(() => {
    if (prevKind.current === kind) return
    prevKind.current = kind
    setTitle('')
    setTitleId(undefined)
    setAccepted(false)
  }, [kind])

  // Refetched when the kind changes: a film search through fixtures would find
  // nothing, and the two lists have nothing in common
  useEffect(() => {
    let cancelled = false
    type Pick = { id: string; title: string; sub: string; poster: string | null }
    const sources =
      kind === 'movie'
        ? ['released', 'ott', 'upcoming'].map((w) =>
            api<{ releases: Release[] }>(`/releases?window=${w}`).then(
              (r): Pick[] =>
                r.releases.map((x) => ({
                  id: x.id,
                  title: x.title,
                  sub: x.languageLabel,
                  poster: x.poster,
                })),
              (): Pick[] => []
            )
          )
        : ['recent&week=0', 'recent&week=1', 'upcoming'].map((q) =>
            api<{ matches: CricketMatch[] }>(`/cricket?window=${q}&type=all`).then(
              (r): Pick[] =>
                r.matches.map((m) => ({ id: m.id, title: m.name, sub: m.series, poster: null })),
              (): Pick[] => []
            )
          )
    Promise.all(sources).then((lists) => {
      if (cancelled) return
      const seen = new Set<string>()
      const all: Pick[] = []
      for (const list of lists) {
        for (const r of list) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          all.push(r)
        }
      }
      setPool(all)
    })
    return () => {
      cancelled = true
    }
  }, [kind])

  const suggestions = useMemo(() => {
    const q = title.trim().toLowerCase()
    if (!q) return []
    return pool.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 5)
  }, [pool, title])

  /** A typed name that is already in the list needs no "use it anyway" row. */
  const exact = suggestions.some((r) => r.title.toLowerCase() === title.trim().toLowerCase())

  /** Back to a blank form. Everything goes, including the theatre and the
   *  date: two entries in a row are usually two different evenings, and a
   *  field left filled from the last one is the kind of wrong that gets
   *  noticed only after it is saved. */
  const reset = () => {
    setSaved(null)
    setTitle('')
    setTitleId(undefined)
    setAccepted(false)
    setVenue('')
    setCity('')
    setWatchedOn(new Date().toISOString().slice(0, 10))
    setNote('')
    setImage(undefined)
    setImagePosition(DEFAULT_POSITION)
    setImageFit('cover')
    setWhere('out')
    setError('')
    setInvalid(null)
  }

  const save = () => {
    if (busy) return
    if (!title.trim()) {
      setInvalid('title')
      return setError(kind === 'match' ? 'Which match did you watch?' : 'Which film did you watch?')
    }
    const token = refreshUser()?.token
    if (!token) return setError('Please sign in with Google — your log is tied to your account')
    setBusy(true)
    setError('')
    // Empty strings rather than undefined when editing: `undefined` means "not
    // editing this field", so a cleared note would otherwise keep its old value
    const payload = {
      kind,
      where,
      title: title.trim(),
      titleId: titleId ?? (editing ? '' : undefined),
      venue: editing ? venue.trim() : venue.trim() || undefined,
      city: where === 'out' ? (editing ? city.trim() : city.trim() || undefined) : '',
      watchedOn,
      note: editing ? note.trim() : note.trim() || undefined,
      // Cleared as an empty string when editing, or the removal does nothing
      image: image ?? (editing ? '' : undefined),
      // Framing only travels with a picture to frame
      ...(image ? { imagePosition, imageFit } : {}),
    }
    ;(editing ? updateLog(editing.id, payload, token) : createLog(payload, token))
      // On a new entry the modal covers the form, so the fields are left alone
      // here and cleared by "Log another" — clearing them now would mean the
      // confirmation and the emptied form appear in the same frame, and
      // dismissing the modal would look like the entry had been lost.
      // An edit has somewhere to return to, so it just closes.
      .then((entry) => {
        onSaved(entry)
        if (!editing) setSaved(entry)
      })
      .catch((err: Error) => setError(err.message || 'Could not save that'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="log-form">
      {/* The film/match toggle lives in the composer's heading row — see
          LOG_KINDS in Reviews.tsx. A picked title belongs to one list or the
          other, so switching there clears it here. */}
      <div className="log-where">
        {(
          [
            ['out', kind === 'match' ? 'At the stadium' : 'In a cinema', Ticket, 'ico-adda'],
            ['home', 'At home', Home, 'ico-soon'],
          ] as const
        ).map(([value, label, Icon, palette]) => (
          <button
            key={value}
            className={`log-where-btn ${palette}${where === value ? ' active' : ''}`}
            onClick={() => setWhere(value)}
            aria-pressed={where === value}
          >
            <span className={`log-ico ${palette}`}>
              <Icon size={15} />
            </span>
            {label}
          </button>
        ))}
      </div>

      <label className="log-field">
        <span>{kind === 'match' ? 'Match' : 'Film'}</span>
        <div className="search-wrap">
          <Search size={16} />
          <input
            className={invalid === 'title' ? 'invalid' : ''}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              // Typing again reopens the question: whatever was picked or
              // confirmed is no longer what the field says
              setTitleId(undefined)
              setAccepted(false)
              if (invalid) setInvalid(null)
            }}
            placeholder={
              kind === 'match'
                ? 'Anything — this week’s fixture or the 1983 final'
                : 'Anything — this week’s release or a film from 1983'
            }
          />
        </div>
        {title.trim().length >= 2 && !accepted && (
          <div className="blog-tag-options log-suggest">
            {suggestions.map((r) => (
              <button
                key={r.id}
                className="blog-tag-option"
                onClick={() => {
                  setTitle(r.title)
                  setTitleId(r.id)
                  setAccepted(true)
                }}
              >
                {r.poster ? (
                  <img src={r.poster} alt="" loading="lazy" />
                ) : (
                  <span className={`blog-tag-icon ${kind}`}>
                    {kind === 'match' ? <Trophy size={15} /> : <Film size={15} />}
                  </span>
                )}
                <span className="blog-tag-text">
                  <b>{r.title}</b>
                  <small>{r.sub}</small>
                </span>
              </button>
            ))}
            {/* The pool is thirteen weeks of releases and the recent fixtures,
                and a log is mostly older than that. The field always took free
                text — this says so, which is the part that was missing. */}
            {!exact && (
              <button className="blog-tag-option add-own" onClick={() => setAccepted(true)}>
                <span className="blog-tag-icon">
                  <Plus size={15} />
                </span>
                <span className="blog-tag-text">
                  <b>Use “{title.trim()}”</b>
                  <small>
                    {kind === 'match'
                      ? 'Not one of the recent matches — log it anyway'
                      : 'Not one of this week’s releases — log it anyway'}
                  </small>
                </span>
              </button>
            )}
          </div>
        )}
      </label>

      {where === 'out' ? (
        <div className="log-row">
          <label className="log-field">
            <span>{kind === 'match' ? 'Stadium' : 'Theatre'}</span>
            <input
              className="blog-input"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              maxLength={120}
              placeholder={
                kind === 'match'
                  ? 'Rajiv Gandhi Stadium, Chinnaswamy…'
                  : 'PVR Forum, AMB Cinemas…'
              }
            />
          </label>
          <label className="log-field">
            <span>
              <MapPin size={12} className="log-pin" /> City
            </span>
            <input
              className="blog-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
              placeholder="Hyderabad"
            />
          </label>
        </div>
      ) : (
        <label className="log-field">
          <span>Where you watched it</span>
          {/* The same brand badges the film picker uses, so a platform looks
              the same everywhere. Typing is still allowed underneath — plenty
              is watched on services we do not list. */}
          <div className="genre-row film-platforms">
            {OTT_PLATFORMS.map((p) => (
              <button
                key={p.slug}
                className={`platform-chip ${platformClass(p.name)}${
                  venue === p.name ? ' picked' : ''
                }`}
                onClick={() => setVenue(venue === p.name ? '' : p.name)}
                aria-pressed={venue === p.name}
              >
                {venue === p.name && <Check size={13} />}
                {p.short ?? p.name}
              </button>
            ))}
          </div>
          <input
            className="blog-input log-other"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            maxLength={120}
            placeholder="…or type it — a DVD, a flight, anywhere"
          />
        </label>
      )}

      <div className="log-field">
        <span>When</span>
        {/* Almost every entry is today or yesterday, so those are one tap and
            the calendar is for the rest. A native date input is the only thing
            that gets locales, keyboards and screen readers right — but on its
            own it made the common case the slowest one. */}
        <div className="log-when">
          {(
            [
              ['Today', 0],
              ['Yesterday', 1],
            ] as const
          ).map(([label, back]) => {
            const day = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
            return (
              <button
                key={label}
                className={`log-day${watchedOn === day ? ' active' : ''}`}
                onClick={() => setWatchedOn(day)}
                aria-pressed={watchedOn === day}
              >
                {label}
              </button>
            )
          })}
          {/* Logs run late, but never early: you cannot have watched it
              tomorrow, and a stray future date would sit at the top for ever */}
          <DayPicker
            value={watchedOn}
            max={new Date().toISOString().slice(0, 10)}
            onChange={setWatchedOn}
          />
        </div>
      </div>

      <LogPhoto
        path={image}
        position={imagePosition}
        fit={imageFit}
        onChange={setImage}
        onPositionChange={setImagePosition}
        onFitChange={setImageFit}
      />

      <label className="log-field">
        <span>Note — optional, only you see it</span>
        <textarea
          className="blog-textarea log-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Who you went with, what you thought, why you will remember it…"
        />
      </label>

      {/* Says why the sign-in button is there, rather than leaving it to be
          guessed at. Only the reason — the button above already says what to do */}
      {needsSignIn && (
        <p className="blog-signin-hint">
          Your log is private and tied to your Google account — that is the only way it can be
          yours and nobody else&apos;s.
        </p>
      )}
      {error && <p className="blog-error">{error}</p>}

      {/* Only the one button. Saving clears the film and note but leaves the
          form open, so a weekend's three films are three taps rather than three
          openings — which is why this does not double as "finished". The way
          out is the composer's own X above, the same close control every other
          form on the site uses; a second one here was a second door to one
          room. */}
      <div className="blog-composer-foot">
        {/* The sign-in button in place of the save button, not an error after
            pressing it. A log is tied to an account by definition, so being
            signed out is a missing precondition rather than a mistake — and
            telling someone off for not having done a thing you never offered
            is the wrong way round. Same shape the review composer uses. */}
        {needsSignIn ? (
          <GoogleButton onError={setError} />
        ) : (
          <button className="share-wa" onClick={save} disabled={busy}>
            <Check size={15} />{' '}
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add to my log'}
          </button>
        )}
        {/* Only while editing: a new entry has nothing worth abandoning, and
            the composer's own X already closes that */}
        {editing && onCancel && (
          <button className="article-owner-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {/* The answer to "where did that go", as its own moment. A panel further
          down the page can be missed on a phone, where the form itself fills
          the screen; this cannot. It names what landed, says where, and offers
          the only two things anyone wants next. */}
      {saved && (
        <div className="logdone" role="dialog" aria-label="Added to your log">
          <div className="logdone-card">
            {/* Drawn, not dropped in — the ring closes and then the mark is
                struck through it, which reads as "this completed" */}
            <svg className="cheer-tick" viewBox="0 0 52 52" aria-hidden="true">
              <circle className="cheer-tick-ring" cx="26" cy="26" r="23" />
              <path className="cheer-tick-mark" d="M15 26.5 l7.5 7.5 l15 -16" />
            </svg>
            <strong>Added to your log</strong>
            <span className="logdone-what">
              <span className={`log-entry-ico ${saved.where}`}>
                {saved.where === 'out' ? <Ticket size={14} /> : <Home size={14} />}
              </span>
              <b>{saved.title}</b>
              <small>
                {new Date(saved.watchedOn + 'T00:00:00').toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {saved.venue && ` · ${saved.venue}`}
                {saved.city && ` · ${saved.city}`}
              </small>
            </span>
            <div className="logdone-actions">
              {/* Staying is the default action, because whoever logs one film
                  from a weekend usually has a second */}
              <button className="share-wa sm" onClick={reset}>
                <Plus size={14} /> Log another
              </button>
              <Link
                className="article-owner-btn"
                to="/my-reviews?tab=private"
                state={{ from: '/reviews' }}
              >
                See my log <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
