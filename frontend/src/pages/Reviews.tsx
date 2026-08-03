import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Feather,
  Film,
  Trophy,
  Search,
  Send,
  X,
  PenLine,
  CalendarDays,
  ArrowRight,
  Star,
  Newspaper,
  Globe,
  Lock,
  ExternalLink,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  api,
  fetchLogs,
  fetchPosts,
  fetchMyPosts,
  fetchRatings,
  fetchPost,
  fetchArticles,
  fetchArticle,
  fetchArticleLikes,
  fetchMyArticles,
  updateArticle,
  createPost,
  updatePost,
  deletePost,
  createArticle,
} from '../api'
import { authEnabled, refreshUser, signOut, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import { matchFlags } from '../flags'
import { usePageMeta, reviewPath } from '../seo'
import {
  Article,
  ArticleFilm,
  BlogPost,
  BlogTag,
  LikeSummary,
  RatingSummary,
  Release,
  CricketMatch,
  WatchLog,
} from '../types'
import PipShow from '../components/PipShow'
import ArticleIndex from '../components/ArticleIndex'
import FirstCheer, {
  alreadyCheered,
  markCheered,
  type Kind as CheerKind,
} from '../components/FirstCheer'
import FilmWatchPicker from '../components/FilmWatchPicker'
import WatchLogForm from '../components/WatchLogForm'
import ArticleImagePicker, { DEFAULT_POSITION } from '../components/ArticleImagePicker'
import Prose from '../components/Prose'
import { StarRow, TagLine, timeAgo } from '../components/ReviewBits'
import OfficialStamp from '../components/OfficialStamp'

// Tiny letter tiles drifting down behind the page — pure decoration
const RAIN_GLYPHS = 'సినిమాక్రికెట్వారంఅడ్డాCINEMAOTTCRICKETREVIEW★🎬🏏'

function LetterRain() {
  // Greet, then get out of the way: fully visible at the top of the page,
  // faded out by the time the reader scrolls into the feed
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const fade = Math.max(0, 1 - window.scrollY / 480)
      el.style.opacity = String(fade)
      el.style.visibility = fade === 0 ? 'hidden' : ''
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const tiles = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: (i + Math.random()) * (100 / 26),
        size: 13 + Math.random() * 11,
        duration: 14 + Math.random() * 16,
        delay: -Math.random() * 30,
        spin: (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 40),
        char: [...RAIN_GLYPHS][Math.floor(Math.random() * [...RAIN_GLYPHS].length)],
      })),
    []
  )
  return (
    <div ref={wrapRef} className="letter-rain" aria-hidden>
      {tiles.map((t, i) => (
        <span
          key={i}
          className="rain-tile"
          style={{
            left: `${t.left}%`,
            fontSize: t.size,
            animationDuration: `${t.duration}s`,
            animationDelay: `${t.delay}s`,
            ['--spin' as string]: `${t.spin}deg`,
          }}
        >
          {t.char}
        </span>
      ))}
    </div>
  )
}

/** Candidate movies/matches the writer can tag, loaded once per kind. */
function useTagOptions(kind: 'movie' | 'match', open: boolean) {
  const [options, setOptions] = useState<BlogTag[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    if (kind === 'movie') {
      // Recently released first (theatres, then OTT, then upcoming), with
      // Telugu titles leading each group — newest release on top
      Promise.all(
        ['released', 'ott', 'upcoming'].map((w) =>
          api<{ releases: Release[] }>(`/releases?window=${w}`).then((r) => r.releases, () => [] as Release[])
        )
      ).then((lists) => {
        if (cancelled) return
        const seen = new Set<string>()
        const items: Array<{ r: Release; group: number }> = []
        for (const [group, list] of lists.entries()) {
          for (const r of list) {
            if (seen.has(r.id)) continue
            seen.add(r.id)
            items.push({ r, group })
          }
        }
        items.sort((a, b) => {
          if (a.group !== b.group) return a.group - b.group
          const telugu = Number(b.r.languageLabel === 'Telugu') - Number(a.r.languageLabel === 'Telugu')
          if (telugu !== 0) return telugu
          // released/OTT: newest first; upcoming: soonest first
          return a.group === 2
            ? a.r.releaseDate.localeCompare(b.r.releaseDate)
            : b.r.releaseDate.localeCompare(a.r.releaseDate)
        })
        setOptions(
          items.map(({ r }) => ({
            kind: 'movie',
            id: r.id,
            label: r.title,
            sub: r.platforms?.length ? `${r.languageLabel} · ${r.platforms[0]}` : r.languageLabel,
            poster: r.poster,
          }))
        )
      })
    } else {
      // Recently played matches first (India's games leading), then upcoming
      Promise.all([
        api<{ matches: CricketMatch[] }>('/cricket?window=recent&week=0&type=all').then((r) => r.matches, () => [] as CricketMatch[]),
        api<{ matches: CricketMatch[] }>('/cricket?window=recent&week=1&type=all').then((r) => r.matches, () => [] as CricketMatch[]),
        api<{ matches: CricketMatch[] }>('/cricket?window=upcoming&type=all').then((r) => r.matches, () => [] as CricketMatch[]),
      ]).then((lists) => {
        if (cancelled) return
        const seen = new Set<string>()
        const items: Array<{ m: CricketMatch; upcoming: boolean }> = []
        for (const [i, list] of lists.entries()) {
          for (const m of list) {
            if (seen.has(m.id)) continue
            seen.add(m.id)
            items.push({ m, upcoming: i === 2 })
          }
        }
        const india = (m: CricketMatch) =>
          m.teams.some((t) => t.name.toLowerCase().startsWith('india'))
        items.sort((a, b) => {
          if (a.upcoming !== b.upcoming) return Number(a.upcoming) - Number(b.upcoming)
          const ind = Number(india(b.m)) - Number(india(a.m))
          if (ind !== 0) return ind
          // played: latest first; upcoming: soonest first
          return a.upcoming ? a.m.date.localeCompare(b.m.date) : b.m.date.localeCompare(a.m.date)
        })
        setOptions(
          items.map(({ m }) => ({
            kind: 'match',
            id: m.id,
            label: m.name,
            sub: `${m.series} · ${new Date(m.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
            poster: null,
            logos: m.teams.map((t) => t.logo).filter((l): l is string => Boolean(l)).slice(0, 2),
          }))
        )
      })
    }
    return () => {
      cancelled = true
    }
  }, [kind, open])

  return options
}

/** Which composer field the current error belongs to, if any. */
type Invalid = 'tag' | 'title' | 'body' | null

/**
 * The starters shown when the feed is empty.
 *
 * "Write a review" asks someone to face a blank page and think of a film.
 * These name films that are actually out this week and open the composer
 * already tagged to the one they pick, which turns the ask into a question
 * they can answer: did you watch this, was it worth it.
 */
function ReviewStarters({ onPick }: { onPick: (tag: BlogTag) => void }) {
  const [picks, setPicks] = useState<BlogTag[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      ['ott', 'released'].map((w) =>
        api<{ releases: Release[] }>(`/releases?window=${w}`).then(
          (r) => r.releases,
          () => [] as Release[]
        )
      )
    ).then((lists) => {
      if (cancelled) return
      // The week's most-watched, which is the likeliest thing a visitor has
      // actually seen — a film nobody watched is a starter nobody can use
      const seen = new Set<string>()
      const pool = lists
        .flat()
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 4)
      setPicks(
        pool.map((r) => ({
          kind: 'movie' as const,
          id: r.id,
          label: r.title,
          sub: r.platforms?.length ? `${r.languageLabel} · ${r.platforms[0]}` : r.languageLabel,
          poster: r.poster,
        }))
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (picks.length === 0) return null

  return (
    <div className="starters">
      <span className="starters-label">Watched any of these? Start there</span>
      <div className="starters-row">
        {picks.map((t) => (
          <button key={t.id} className="starter" onClick={() => onPick(t)}>
            {t.poster ? (
              <img src={t.poster} alt="" loading="lazy" />
            ) : (
              <span className="starter-fallback">
                <Film size={18} />
              </span>
            )}
            <span className="starter-text">
              <strong>{t.label}</strong>
              <small>{t.sub}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The tagged film, as a link to its own page.
 *
 * Two jobs. A reader who wants the film gets there in one tap; and the page
 * that ranks for "<film> review" — the title page, which carries these same
 * reviews — finally gets an internal link from every review written about it.
 * Matches have no page of their own, so they stay plain text.
 */
function Composer({
  open,
  onClose,
  onPublished,
  onArticlePublished,
  onLogged,
  preset,
  startMode,
  canPublishAsSite,
  editing,
  onEdited,
  editingPost,
  onPostEdited,
}: {
  open: boolean
  onClose: () => void
  onPublished: (post: BlogPost) => void
  onArticlePublished: (article: Article) => void
  /** A private log entry was saved — the page keeps its own copy. */
  onLogged: (log: WatchLog) => void
  /** Opened from a starter — the film is already chosen. */
  preset?: BlogTag | null
  /** Which side of the switch to open on, when the way in already said. */
  startMode?: 'review' | 'article'
  /** Owner account: may publish under the WeekAdda byline, or decline it. */
  canPublishAsSite?: boolean
  /** Set when the composer is editing an existing article rather than writing. */
  editing?: Article | null
  onEdited?: (article: Article) => void
  /** Set when the composer is editing an existing review rather than writing. */
  editingPost?: BlogPost | null
  onPostEdited?: (post: BlogPost) => void
}) {
  // Two things can be written here, and they are not variants of each other: a
  // review is pinned to something this week's caches hold, an article is not.
  // The switch is first because it changes every field below it.
  const [mode, setMode] = useState<'review' | 'article'>('review')
  // null until the public/private question is answered; 'public' is the review
  // form, 'private' hands over to WatchLogForm entirely
  const [privacy, setPrivacy] = useState<'public' | 'private' | null>(null)
  // Film or match for the log, held here because its toggle sits in the
  // heading row beside the title rather than inside the form
  const [logKind, setLogKind] = useState<'movie' | 'match'>('movie')
  // Editing an existing review is always public — it already is
  const reviewFields = mode !== 'article' && (privacy === 'public' || Boolean(editingPost))
  const [kind, setKind] = useState<'movie' | 'match'>('movie')
  const [tag, setTag] = useState<BlogTag | null>(null)
  const [topic, setTopic] = useState<Article['topic']>('movie')
  const [films, setFilms] = useState<ArticleFilm[]>([])
  const [image, setImage] = useState<string | undefined>()
  const [imagePosition, setImagePosition] = useState(DEFAULT_POSITION)
  const [imageFit, setImageFit] = useState<'cover' | 'contain'>('cover')
  // Owner only. Defaults on, so the site's own pieces keep the byline they
  // have always had; unticking it publishes under the writer's own name.
  const [asSite, setAsSite] = useState(true)
  // The form's own shell, so opening it can bring it into view — see below
  const shellRef = useRef<HTMLElement>(null)

  /**
   * A fresh open starts blank.
   *
   * Publishing already clears these on the way out, but relying on that makes
   * an empty form a consequence of the last composition having ended tidily —
   * and it does not always: a publish that fails, a close mid-write, or a
   * navigation in between all leave the fields sitting there, so the next
   * "Write a review" opens on somebody's last draft. Clearing on the way *in*
   * needs nothing to have gone right beforehand.
   *
   * Editing is exempt: those two effects below fill the fields deliberately,
   * and they run after this one.
   */
  useEffect(() => {
    if (!open || editing || editingPost) return
    setTag(null)
    setTagSearch('')
    setTitle('')
    setBody('')
    setFilms([])
    setImage(undefined)
    setImagePosition(DEFAULT_POSITION)
    setImageFit('cover')
    setError('')
    setInvalid(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // "Write an article" must open the article side of the switch. Keyed on the
  // mode itself, not just on `open`, so it cannot re-apply and yank someone
  // back after they have switched by hand.
  useEffect(() => {
    if (open && startMode) setMode(startMode)
    // Asked again on every fresh open: it is a decision about this piece, not
    // a preference to remember
    if (open) setPrivacy(editingPost ? 'public' : null)
  }, [open, startMode])

  /**
   * Opening the composer must put it in front of the writer.
   *
   * The form renders at the top of the page, above the filter row and the whole
   * feed — but below 900px the article rail stacks *under* that feed, so "Write
   * an article" down there opened a form a screenful or more above the viewport
   * and read as a dead link. Nothing else corrects for it: the rail links to
   * /reviews?compose=article, which on /reviews changes only the search params,
   * and App's ScrollToTop is keyed on pathname.
   *
   * Keyed on `startMode` as well as `open`, so asking for the article side while
   * the review side is already open scrolls too. That prop moves only when a way
   * *in* names a side — flipping the switch by hand sets `mode`, not this — so
   * the effect cannot fire at someone mid-compose.
   *
   * Only when it is not already sitting there: opening from the hero's "Write a
   * review", which on a desktop is directly above the form, must not jolt a page
   * showing the very thing it would scroll to.
   */
  useEffect(() => {
    const el = shellRef.current
    if (!open || !el) return
    const { top } = el.getBoundingClientRect()
    // Clear of the sticky navbar (the same 80px the rail sticks at) and inside
    // the viewport: the writer can already see where to start typing.
    if (top >= 80 && top < window.innerHeight) return
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [open, startMode])

  // Load an article being edited into the fields. Keyed on its id, so typing
  // does not get overwritten by this effect re-running.
  useEffect(() => {
    if (!editing) return
    setMode('article')
    setTopic(editing.topic)
    setTitle(editing.title)
    setBody(editing.body)
    setFilms(editing.films ?? [])
    setImage(editing.image)
    setImagePosition(editing.imagePosition ?? DEFAULT_POSITION)
    setImageFit(editing.imageFit ?? 'cover')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id])

  // Same for a review: keyed on its id so typing is not overwritten
  useEffect(() => {
    if (!editingPost) return
    setMode('review')
    setKind(editingPost.tag.kind)
    setTag(editingPost.tag)
    setTitle(editingPost.title)
    setBody(editingPost.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPost?.id])

  // Adopt the starter's film when the composer opens on one, and only then —
  // it must never overwrite a tag the writer has since picked themselves
  useEffect(() => {
    if (open && preset) {
      setMode('review')
      setKind(preset.kind)
      setTag(preset)
    }
  }, [open, preset])

  const [tagSearch, setTagSearch] = useState('')
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem('weekadda-author') ?? ''
    } catch {
      return ''
    }
  })
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState<Invalid>(null)
  // Publishing needs Google sign-in (when configured); reading never does.
  // The state is app-wide: signing in from the navbar covers the composer too.
  const user = useGoogleUser()
  const needsSignIn = authEnabled && !user

  useEffect(() => {
    if (user) setAuthor((prev) => prev || user.name.slice(0, 40))
  }, [user])

  const options = useTagOptions(kind, open)

  const suggestions = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    const pool = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q))
      : options
    return pool.slice(0, 8)
  }, [options, tagSearch])

  // Which field the error is about, so the message and the field agree. Named
  // rather than boolean: "something is wrong" at the foot of a five-field form
  // still leaves you hunting.
  const fail = (field: Invalid, message: string) => {
    setInvalid(field)
    setError(message)
  }

  const publish = () => {
    if (sending) return
    if (mode === 'review' && !tag)
      return fail(
        'tag',
        `Please tag the ${kind === 'movie' ? 'movie' : 'match'} you are writing about`
      )
    if (!title.trim()) return fail('title', `Give your ${mode} a title`)
    if (body.trim().length < 20)
      return fail('body', 'Write a little more — at least a few sentences')
    let token: string | undefined
    if (authEnabled) {
      const fresh = refreshUser()
      if (!fresh) return fail(null, 'Please sign in with Google to publish')
      token = fresh.token
    }
    setError('')
    setInvalid(null)
    setSending(true)
    try {
      localStorage.setItem('weekadda-author', author.trim())
    } catch {
      // remembering the name is best-effort
    }
    const done = () => {
      onClose()
      setTag(null)
      setTagSearch('')
      setTitle('')
      setBody('')
      setFilms([])
      setImage(undefined)
      setImagePosition(DEFAULT_POSITION)
      setImageFit('cover')
    }
    const failed = (err: Error) => {
      if (err.message.toLowerCase().includes('sign in')) signOut()
      setError(err.message || 'Could not publish right now — please try again')
    }
    const payload = { author: author.trim(), title: title.trim(), body: body.trim() }
    const framing = {
      topic,
      films,
      image,
      // Framing only travels with a picture to frame
      ...(image ? { imagePosition, imageFit } : {}),
    }
    const sent =
      editingPost && token
        ? updatePost(editingPost.id, { ...payload, tag: tag! }, token).then((p) =>
            onPostEdited?.(p)
          )
        : editing && token
        ? updateArticle(editing.id, { ...payload, ...framing }, token).then((a) => onEdited?.(a))
        : mode === 'article'
          ? createArticle(
              {
                ...payload,
                ...framing,
                // Only ever sent to decline the byline; the server grants it
                ...(canPublishAsSite && !asSite ? { official: false } : {}),
              },
              token
            ).then(onArticlePublished)
          : createPost({ ...payload, tag: tag! }, token).then(onPublished)
    sent.then(done).catch(failed).finally(() => setSending(false))
  }

  if (!open) return null

  return (
    <section className="blog-composer" ref={shellRef}>
      <div className="blog-composer-head">
        <h2>
          {/* Same tile as the Reviews icon in the navbar, lit — the form and the
              section it writes into are the same thing, so they wear the same
              mark rather than a bare glyph that happens to be the same shape */}
          <span className="compose-ico ico-theatre">
            <Feather size={17} />
          </span>{' '}
          {editingPost
            ? 'Edit your review'
            : editing
              ? 'Edit your article'
              : mode === 'article'
                ? 'Your article'
                : privacy === 'private'
                  ? 'Your log'
                  : privacy === 'public'
                    ? 'Your take'
                    : 'What are you writing?'}
        </h2>
        {/* Beside the heading rather than inside the form: it is the first
            thing that has to be true — everything below reads from it — and a
            heading row is where a page says what it is about. */}
        {privacy === 'private' && !editingPost && (
          <div className="log-kind-head">
            {(
              [
                ['movie', 'A film', 'ico-movies'],
                ['match', 'A match', 'ico-results'],
              ] as const
            ).map(([value, label, palette]) => (
              <button
                key={value}
                className={`log-where-btn ${palette}${logKind === value ? ' active' : ''}`}
                onClick={() => setLogKind(value)}
                aria-pressed={logKind === value}
              >
                <span className={`log-ico ${palette}`}>
                  {/* The Adda's own pair: 🍿 is what its "Company for a movie"
                      starter uses, and 🏏 is the bat-and-ball from the reviews
                      letter-rain. Emoji rather than lucide because lucide has
                      no cricket bat — and one of each would have been worse
                      than two of the same. */}
                  <span className="log-emoji">{value === 'movie' ? '🍿' : '🏏'}</span>
                </span>
                {label}
              </button>
            ))}
          </div>
        )}
        <button className="share-close" onClick={onClose} aria-label="Close composer">
          <X size={16} />
        </button>
      </div>

      {/* Reviews ask one question first: is this for everyone, or for you?
          A step rather than a toggle — it is answered once and then gone, and
          the two answers lead to genuinely different forms rather than to the
          same form with a flag on it. Articles skip it: an article is a piece
          of published writing by definition, and a private one would be a
          document with nowhere to go. */}
      {mode !== 'article' && !editingPost && !privacy && (
        <div className="privacy-choice">
          <button className="privacy-btn public" onClick={() => setPrivacy('public')}>
            <span className="privacy-ico ico-theatre">
              <Globe size={17} />
            </span>
            <b>Share it publicly</b>
            <em>A review anyone can read, tagged to the film or match</em>
          </button>
          <button className="privacy-btn private" onClick={() => setPrivacy('private')}>
            <span className="privacy-ico ico-soon">
              <Lock size={17} />
            </span>
            <b>Just for me</b>
            <em>A private log — what you watched, where, and when. Nobody else sees it.</em>
          </button>
        </div>
      )}

      {/* What you are writing is decided by how you got here — "Write a review"
          opens a review, the rail's "Write an article" opens an article — so the
          form shows one set of fields and no switch (owner, Aug 2026). The
          toggle that used to sit here made every opening a two-step: choose the
          kind you had already chosen, then write. It also had to be hidden
          while editing, since an article and a review are different stores and
          switching sides mid-edit had nowhere to save. The way out is the other
          entry point, not a control inside the form.
          `mode` is still the branch below; only the manual switch is gone.

          Above the form in all three cases, private included: the line says
          what you are filling in, and a caption underneath the thing it
          captions has already been read too late. */}
      {(mode === 'article' || privacy) && (
      <span
        className={`blog-mode-note ${
          mode === 'article' ? 'ico-article' : privacy === 'private' ? 'ico-soon' : 'ico-review'
        }`}
      >
        {mode === 'article' ? (
          <>
            <Newspaper size={13} /> An article — anything not tied to a release date
          </>
        ) : privacy === 'private' ? (
          <>
            <Lock size={13} /> Your day out — where you watched it, and when. Only you ever see it.
          </>
        ) : (
          <>
            <Star size={13} /> A review — something out this week
          </>
        )}
      </span>
      )}

      {mode !== 'article' && privacy === 'private' && !editingPost && (
        <WatchLogForm kind={logKind} onSaved={onLogged} />
      )}

      {mode === 'article' ? (
        <div className="blog-kind">
          <button
            className={`genre-chip${topic === 'movie' ? ' active' : ''}`}
            onClick={() => setTopic('movie')}
          >
            <Film size={14} /> Movies
          </button>
          <button
            className={`genre-chip${topic === 'match' ? ' active' : ''}`}
            onClick={() => setTopic('match')}
          >
            <Trophy size={14} /> Cricket
          </button>
        </div>
      ) : null}

      {/* Owner only. Owning the site permits the byline; it should not force
          every personal piece to go out as the masthead. */}
      {/* Not offered while editing: the byline was settled at publish time and
          an edit changes what the piece says, never who published it */}
      {mode === 'article' && canPublishAsSite && !editing && (
        <label className="compose-as-site">
          <input type="checkbox" checked={asSite} onChange={(e) => setAsSite(e.target.checked)} />
          <span>
            Publish as <b>WeekAdda</b>
            <em>{asSite ? 'Carries the site stamp' : `Goes out under “${author || 'your name'}”`}</em>
          </span>
        </label>
      )}

      {/* Articles only — a review would only ever be borrowing a poster */}
      {mode === 'article' && (
        <ArticleImagePicker
          image={image}
          position={imagePosition}
          fit={imageFit}
          onChange={setImage}
          onPositionChange={setImagePosition}
          onFitChange={setImageFit}
        />
      )}

      {/* Offered on both topics: a piece about the 1983 final is filed under
          cricket and still wants to point at the film of it */}
      {mode === 'article' && <FilmWatchPicker films={films} onChange={setFilms} />}

      {!reviewFields ? null : (
      <div className="blog-kind">
        <button
          className={`genre-chip${kind === 'movie' ? ' active' : ''}`}
          onClick={() => {
            setKind('movie')
            setTag(null)
          }}
        >
          <Film size={14} /> About a movie
        </button>
        <button
          className={`genre-chip${kind === 'match' ? ' active' : ''}`}
          onClick={() => {
            setKind('match')
            setTag(null)
          }}
        >
          <Trophy size={14} /> About a match
        </button>
      </div>
      )}

      {!reviewFields ? null : tag ? (
        <div className="blog-tag-picked">
          {tag.poster ? (
            <img src={tag.poster} alt="" />
          ) : matchFlags(tag).length > 0 ? (
            <span className="blog-tag-flags">
              {matchFlags(tag).map((l, i) => (
                <img key={i} src={l} alt="" onError={(e) => e.currentTarget.classList.add('gone')} />
              ))}
            </span>
          ) : (
            <span className={`blog-tag-icon ${tag.kind}`}>
              {tag.kind === 'movie' ? <Film size={16} /> : <Trophy size={16} />}
            </span>
          )}
          <span className="blog-tag-text">
            <b>{tag.label}</b>
            <small>{tag.sub}</small>
          </span>
          <button className="share-close" onClick={() => setTag(null)} aria-label="Remove tag">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className={invalid === 'tag' ? 'blog-tag-picker invalid' : 'blog-tag-picker'}>
          <div className="search-wrap">
            <Search size={16} />
            <input
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              // Both used to start "Search the … or series", which read as
              // unchanged when the toggle was flipped. Each now leads with the
              // word that differs.
              placeholder={
                kind === 'movie'
                  ? 'Search a movie or web series you watched…'
                  : 'Search a cricket match or series…'
              }
            />
          </div>
          <div className="blog-tag-options">
            {suggestions.map((o) => (
              <button
                key={o.id}
                className="blog-tag-option"
                onClick={() => {
                  setTag(o)
                  if (invalid === 'tag') setInvalid(null)
                }}
              >
                {o.poster ? (
                  <img src={o.poster} alt="" loading="lazy" />
                ) : matchFlags(o).length > 0 ? (
                  <span className="blog-tag-flags">
                    {matchFlags(o).map((l, i) => (
                      <img
                        key={i}
                        src={l}
                        alt=""
                        loading="lazy"
                        onError={(e) => e.currentTarget.classList.add('gone')}
                      />
                    ))}
                  </span>
                ) : (
                  <span className={`blog-tag-icon ${o.kind}`}>
                    {o.kind === 'movie' ? <Film size={15} /> : <Trophy size={15} />}
                  </span>
                )}
                <span className="blog-tag-text">
                  <b>{o.label}</b>
                  <small>{o.sub}</small>
                </span>
              </button>
            ))}
            {/* Whatever was typed, as the tag. The picker only knows thirteen
                weeks of releases and the recent fixtures, so a film from last
                year — or one we simply never listed — had no way through here
                at all, and the review could not be published. Same escape hatch
                the article composer's film picker already offers.
                The tag carries no id, which is exactly what an unlisted title
                is: `TagLine` renders it as plain text rather than a link to a
                title page that does not exist, and `relatedReviews` groups on
                id, so it never pretends to be another review's subject. */}
            {tagSearch.trim().length >= 2 &&
              !suggestions.some(
                (o) => o.label.toLowerCase() === tagSearch.trim().toLowerCase()
              ) && (
                <button
                  className="blog-tag-option add-own"
                  onClick={() => {
                    setTag({
                      kind,
                      id: '',
                      label: tagSearch.trim(),
                      sub: kind === 'movie' ? 'Not in this week’s list' : 'Not in the recent list',
                      poster: null,
                    })
                    if (invalid === 'tag') setInvalid(null)
                  }}
                >
                  <span className={`blog-tag-icon ${kind}`}>
                    {kind === 'movie' ? <Film size={15} /> : <Trophy size={15} />}
                  </span>
                  <span className="blog-tag-text">
                    <b>Use “{tagSearch.trim()}”</b>
                    <small>
                      {kind === 'movie'
                        ? 'Not one of this week’s releases — write about it anyway'
                        : 'Not one of the recent matches — write about it anyway'}
                    </small>
                  </span>
                </button>
              )}
            {suggestions.length === 0 && tagSearch.trim().length < 2 && (
              <p className="blog-tag-empty">
                {kind === 'movie'
                  ? 'No film found — try another name, or a shorter one.'
                  : 'No match found — try a team name, like “India”.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Title and body belong to the two writing forms only. Ungated, they sat
          under the private log's own fields asking for a headline and a review
          of something already logged. */}
      {/* Conditionally rendered, never `hidden`. The attribute only carries the
          UA rule `[hidden] { display: none }`, which any class setting `display`
          silently beats — that is how the Publish button stayed on screen under
          the private log and answered a click with a review's validation. */}
      {(mode === 'article' || reviewFields) && (
      <>
      <input
        className={invalid === 'title' ? 'blog-input invalid' : 'blog-input'}
        value={title}
        // The highlight clears as soon as they act on it — a field that stays
        // red while you are fixing it is arguing with you
        onChange={(e) => {
          setTitle(e.target.value)
          if (invalid === 'title') setInvalid(null)
        }}
        maxLength={120}
        placeholder={
          mode === 'article'
            ? topic === 'match'
              ? 'Article title — e.g. “The 1983 final still doesn’t make sense”'
              : 'Article title — e.g. “My ten favourite Telugu films of the decade”'
            : 'Review title — e.g. “This one deserves a second week in theatres”'
        }
      />
      <textarea
        className={invalid === 'body' ? 'blog-textarea invalid' : 'blog-textarea'}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          if (invalid === 'body') setInvalid(null)
        }}
        // An article has room to be an essay; a review is about one thing
        maxLength={mode === 'article' ? 20000 : 5000}
        rows={mode === 'article' ? 12 : 6}
        placeholder={
          mode === 'article'
            ? 'Take your time — no release date, no word limit worth worrying about.'
            : "What did you feel about it? The moments that worked, the ones that didn't…"
        }
      />
      </>
      )}
      {/* Links become platform buttons only when the article renders, so
          without this the writer cannot tell whether a pasted URL was
          recognised until after publishing — by which time fixing it means
          editing a live page. Same component the article page uses, so what
          is shown here is what will actually be published. */}
      {mode === 'article' && body.trim().length > 0 && (
        <div className="compose-preview">
          <span className="film-picker-label">
            <Eye size={13} /> Preview
          </span>
          <Prose className="review-article-body" text={body} films={films} />
        </div>
      )}

      {(mode === 'article' || reviewFields) && (
      <div className="blog-composer-foot">
        <input
          className="blog-input author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={40}
          placeholder={
            authEnabled ? 'Display name shown on your post' : 'Your name — blank posts as Anonymous'
          }
        />
        <span className="blog-count">
          {body.length}/{mode === 'article' ? 20000 : 5000}
        </span>
        {needsSignIn ? (
          <GoogleButton onError={setError} />
        ) : (
          <button className="share-wa sm" onClick={publish} disabled={sending}>
            <Send size={14} />{' '}
            {sending
              ? editing || editingPost
                ? 'Saving…'
                : 'Publishing…'
              : editing || editingPost
                ? 'Save changes'
                : 'Publish'}
          </button>
        )}
      </div>
      )}
      {needsSignIn && (mode === 'article' || reviewFields) && (
        <p className="blog-signin-hint">
          Sign in with Google to publish — only used to keep reviews spam-free; your review shows
          the display name you choose.
        </p>
      )}
      {error && (mode === 'article' || reviewFields) && <p className="blog-error">{error}</p>}
    </section>
  )
}

/** Full take in a modal — same pattern as movie cards, no grid reflow. */
function PostModal({
  post,
  rating,
  own,
  onRated,
  onClose,
  onEdit,
  onDeleted,
}: {
  post: BlogPost
  rating?: RatingSummary
  own: boolean
  onRated: (postId: string, summary: RatingSummary) => void
  onClose: () => void
  onEdit: (post: BlogPost) => void
  onDeleted: (postId: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async () => {
    const fresh = refreshUser()
    if (!fresh || busy) return
    setBusy(true)
    setError('')
    try {
      await deletePost(post.id, fresh.token)
      onDeleted(post.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete — please try again')
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const paragraphs = post.body.split(/\n+/).filter((p) => p.trim())

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal blog-post-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <header className="blog-card-head">
          {post.tag.poster ? (
            <img className="blog-card-poster" src={post.tag.poster} alt="" />
          ) : matchFlags(post.tag).length > 0 ? (
            <span className="blog-card-poster flags">
              {matchFlags(post.tag).map((l, i) => (
                <img key={i} src={l} alt="" />
              ))}
            </span>
          ) : (
            <span className={`blog-card-poster fallback ${post.tag.kind}`}>
              {post.tag.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
            </span>
          )}
          <div className="blog-card-meta">
            <TagLine tag={post.tag} />
            <h2>{post.title}</h2>
            <span className="blog-card-byline">
              {post.official ? <OfficialStamp compact /> : post.author}{' '}
              {own && <span className="blog-you">You</span>} ·{' '}
              <CalendarDays size={12} /> {timeAgo(post.ts)}
            </span>
          </div>
        </header>
        <div className="blog-modal-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <StarRow post={post} summary={rating} own={own} onRated={onRated} />
        {/* The review's own page — shareable, and the only in-app link to it
            now that the rail beside the feed carries articles instead. Without
            this every /review/:id page would be an orphan. */}
        <Link className="blog-modal-full" to={reviewPath(post)}>
          Full page <ExternalLink size={13} />
        </Link>
        {/* Only on your own review, and the server checks the verified email
            again when either one is actually used */}
        {own && (
          <div className="article-owner-tools">
            <button className="article-owner-btn edit" onClick={() => onEdit(post)}>
              <Pencil size={14} /> Edit
            </button>
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
              <button className="article-owner-btn del" onClick={() => setConfirming(true)}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            {error && <span className="blog-error">{error}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function PostCard({
  post,
  index,
  mine,
  rating,
  onRated,
  onOpen,
}: {
  post: BlogPost
  index: number
  mine?: boolean
  rating?: RatingSummary
  onRated: (postId: string, summary: RatingSummary) => void
  onOpen: (post: BlogPost) => void
}) {
  const [clipped, setClipped] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const paragraphs = post.body.split(/\n+/).filter((p) => p.trim())

  // Show the read-more control only when the clamped body actually overflows
  useEffect(() => {
    const el = bodyRef.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 2)
  }, [])

  return (
    <article
      id={`review-${post.id}`}
      className="blog-card"
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
      onClick={() => onOpen(post)}
    >
      <header className="blog-card-head">
        {post.tag.poster ? (
          <img className="blog-card-poster" src={post.tag.poster} alt="" loading="lazy" />
        ) : matchFlags(post.tag).length > 0 ? (
          <span className="blog-card-poster flags">
            {matchFlags(post.tag).map((l, i) => (
              <img key={i} src={l} alt="" loading="lazy" />
            ))}
          </span>
        ) : (
          <span className={`blog-card-poster fallback ${post.tag.kind}`}>
            {post.tag.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
          </span>
        )}
        <div className="blog-card-meta">
          <TagLine tag={post.tag} />
          <h2>{post.title}</h2>
          <span className="blog-card-byline">
            {post.official ? <OfficialStamp compact /> : post.author}{' '}
            {mine && <span className="blog-you">You</span>} ·{' '}
            <CalendarDays size={12} /> {timeAgo(post.ts)}
          </span>
        </div>
      </header>
      <div ref={bodyRef} className="blog-card-body clamped">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {clipped && (
        <button
          className="blog-readmore"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(post)
          }}
        >
          Read the full take →
        </button>
      )}
      <StarRow post={post} summary={rating} own={Boolean(mine)} onRated={onRated} />
    </article>
  )
}

export default function Reviews() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [myArticles, setMyArticles] = useState<Article[] | null>(null)
  // Whether this account may publish under the site's byline; decided server-
  // side from OWNER_EMAIL, which never reaches the browser
  const [isOwner, setIsOwner] = useState(false)
  const [articleLikes, setArticleLikes] = useState<Record<string, LikeSummary>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'movie' | 'match'>('all')
  // The signed-in visitor's own contributions ("My takes")
  const user = useGoogleUser()
  const [myPosts, setMyPosts] = useState<BlogPost[] | null>(null)
  // Only the size of it, and only to decide whether the link to your own page
  // is worth showing — none of the entries are wanted here, and this page is
  // public
  const [myLogCount, setMyLogCount] = useState(0)
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({})
  const [selected, setSelected] = useState<BlogPost | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  // The first-publish party, once per kind ever (see FirstCheer)
  const navigate = useNavigate()
  const location = useLocation()
  // Every publish gets an answer to "did that work?"; only the first gets a
  // party. Reviews celebrate here, where the new review is at the top of the
  // feed; an article celebrates on /articles, which is where it gets sent.
  const [cheer, setCheer] = useState<{ kind: CheerKind; first: boolean } | null>(null)
  const celebrate = (kind: CheerKind) => {
    const first = !alreadyCheered(kind)
    if (first) markCheered(kind)
    setCheer({ kind, first })
  }
  // A film chosen from the empty-state starters, handed to the composer
  const [preset, setPreset] = useState<BlogTag | null>(null)
  const [params, setParams] = useSearchParams()
  const wantedReview = params.get('review')
  // ?compose=article — set by "Write an article" in the rail on an article page
  const wantedCompose = params.get('compose')
  // ?edit=<id> — set by "Edit" on your own article page
  const wantedEdit = params.get('edit')
  // ?editReview=<id> — set by "Edit" on your own review's full page
  const wantedEditReview = params.get('editReview')
  const [editing, setEditing] = useState<Article | null>(null)
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null)
  const [composeMode, setComposeMode] = useState<'review' | 'article'>('review')

  // Arriving from "Edit" on your own article: fetch it, open the composer on
  // it, and drop the key so a refresh is a plain visit to /reviews. The server
  // decides ownership all over again when the edit is saved.
  useEffect(() => {
    if (!wantedEdit) return
    fetchArticle(wantedEdit)
      .then((r) => {
        setEditing(r.article)
        setComposerOpen(true)
      })
      .catch(() => {})
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('edit')
        return next
      },
      { replace: true }
    )
  }, [wantedEdit, setParams])

  // Arriving from "Edit" on your own review's full page. Same shape as the
  // article one above; the server decides ownership again when it is saved.
  useEffect(() => {
    if (!wantedEditReview) return
    fetchPost(wantedEditReview)
      .then((r) => {
        setEditingPost(r.post)
        setComposerOpen(true)
      })
      .catch(() => {})
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('editReview')
        return next
      },
      { replace: true }
    )
  }, [wantedEditReview, setParams])

  // Where the composer was opened from, when that was another page. Closing it
  // goes back there rather than stranding you on /reviews — clicking "Write an
  // article" on /my-articles and then changing your mind should not move you to
  // a different page than the one you were reading.
  const [composeFrom, setComposeFrom] = useState<string | null>(null)

  // Arriving from "Write an article" opens the composer already on the article
  // side, then drops the key — so a refresh is a plain visit to /reviews rather
  // than a form reopening itself forever.
  useEffect(() => {
    if (wantedCompose !== 'article' && wantedCompose !== 'review') return
    setComposeMode(wantedCompose)
    setComposerOpen(true)
    // Captured before the key is dropped, and only for a real in-app origin: a
    // pasted /reviews?compose=article has no referrer to return to
    const from = (location.state as { from?: string } | null)?.from ?? null
    setComposeFrom(from && from !== '/reviews' ? from : null)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('compose')
        return next
      },
      { replace: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedCompose, setParams])

  // Rating summaries — refetched on sign-in/out so "your rating" stays right
  useEffect(() => {
    fetchRatings(user ? refreshUser()?.token : undefined)
      .then((r) => setRatings(r.ratings))
      .catch(() => {})
  }, [user])

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) {
      setMyPosts(null)
      setMyLogCount(0)
      return
    }
    fetchMyPosts(fresh.token)
      .then((r) => setMyPosts(r.posts))
      .catch(() => setMyPosts([]))
    // Only the count is kept. A failure leaves it at zero, which at worst hides
    // a link that has another way in from the composer.
    fetchLogs(fresh.token)
      .then((r) => setMyLogCount(r.logs.length))
      .catch(() => setMyLogCount(0))
  }, [user])

  const mineIds = useMemo(() => new Set((myPosts ?? []).map((p) => p.id)), [myPosts])
  const mineArticleIds = useMemo(
    () => new Set((myArticles ?? []).map((a) => a.id)),
    [myArticles]
  )

  // ?review=<id> — arriving on one particular review (the mini player hands the
  // slide's own id over, and the URL is shareable). Open it, and put its card
  // under the reader when they close the modal. Runs again once the feed lands
  // if the link was followed before the fetch came back.
  useEffect(() => {
    if (!wantedReview) return
    const post =
      posts.find((p) => p.id === wantedReview) ?? myPosts?.find((p) => p.id === wantedReview)
    if (!post) return
    // A review the current filter hides would open over an empty feed
    if (filter !== 'all' && post.tag.kind !== filter) setFilter('all')
    setSelected(post)
    document
      .getElementById(`review-${post.id}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedReview, posts, myPosts])

  // Closing puts the URL back to the plain feed, so a refresh or a Back does
  // not reopen what was just dismissed
  const closeSelected = () => {
    setSelected(null)
    if (wantedReview) setParams({}, { replace: true })
  }

  // Must stay identical to routeMeta['/reviews'] in backend/src/seo.ts — the
  // Worker writes those tags into the HTML and this overwrites them on mount,
  // so the two disagreeing means one URL advertising two titles
  usePageMeta(
    'Movie & Cricket Reviews & Articles by Viewers | WeekAdda',
    'Honest reviews of this week’s movies, OTT releases and cricket matches — written by the people who watched them, plus articles worth going back to.'
  )

  useEffect(() => {
    fetchPosts()
      .then((r) => setPosts(r.posts))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // The rail is its own fetch: articles are a separate store, and a failure
  // to load them must not take the reviews feed down with it
  useEffect(() => {
    fetchArticles()
      .then((r) => setArticles(r.articles))
      .catch(() => setArticles([]))
  }, [])

  // Counts are public; the token only adds whether this reader liked each
  useEffect(() => {
    fetchArticleLikes(user ? refreshUser()?.token : undefined)
      .then((r) => setArticleLikes(r.likes))
      .catch(() => {})
  }, [user])

  // Which of them the signed-in visitor wrote. Asked by id rather than matched
  // on the display name, which two people can share.
  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) return setMyArticles(null)
    fetchMyArticles(fresh.token)
      .then((r) => {
        setMyArticles(r.articles)
        setIsOwner(Boolean(r.owner))
      })
      .catch(() => setMyArticles([]))
  }, [user])

  const visible = filter === 'all' ? posts : posts.filter((p) => p.tag.kind === filter)

  // Mini-player slides: one card per review — the reader rating leads as
  // "★ 4.2 / 5", then title, writer + what it's about, and the opening of
  // the take. 3s so there is time to read.
  const pipSlides = useMemo(
    () =>
      visible.slice(0, 40).map((p) => {
        const r = ratings[p.id]
        return {
          kicker:
            r && r.count > 0
              ? `★ ${r.avg.toFixed(1)} / 5 · ${r.count} rating${r.count === 1 ? '' : 's'}`
              : 'Not yet rated',
          title: p.title,
          sub: `${p.author} · ${p.tag.label}`,
          lines: [p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body],
          // Not just the page — the review that was on screen when it was clicked
          href: `/reviews?review=${encodeURIComponent(p.id)}`,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posts, myPosts, filter, ratings]
  )

  return (
    <main className="blog-page">
      <LetterRain />
      <PipShow
        slides={pipSlides}
        noun="reviews"
        rotateMs={3000}
        context={{
          tab: 'Reviews',
          detail:
            filter === 'all'
              ? 'Latest takes'
              : filter === 'movie'
                ? 'Movie reviews'
                : 'Match reviews',
        }}
      />
      <section className="community-hero">
        <div className="community-hero-text">
          <h1 className="sr-only">Movie &amp; Cricket Reviews by Real Viewers</h1>
          <span className="hero-eyebrow">
            <Feather size={13} /> From the audience
          </span>
          <p>
            Honest reviews from people who actually watched — was it worth the ticket, worth the
            data, worth staying up for? Every review is tagged to the film or match it is about,
            and rated out of five.
          </p>
        </div>
        {!composerOpen && (
          <button
            className="community-cta"
            onClick={() => {
              // This button says review, so it must open on review — whatever
              // the last visit to the composer happened to be
              setComposeMode('review')
              setComposerOpen(true)
            }}
          >
            <PenLine size={18} /> Write a review
          </button>
        )}
      </section>

      <div className="blog-wrap">
        <Composer
          open={composerOpen}
          preset={preset}
          onClose={() => {
            setComposerOpen(false)
            setPreset(null)
            setEditing(null)
            setEditingPost(null)
            // Back where the form was opened from, when that was another page.
            // Only on cancel — publishing has its own destination.
            if (composeFrom) {
              setComposeFrom(null)
              navigate(composeFrom)
            }
          }}
          onPublished={(post) => {
            setPosts((p) => [post, ...p])
            if (user) setMyPosts((mine) => [post, ...(mine ?? [])])
            celebrate('review')
          }}
          // Kept in page state so /my-reviews shows it without a round trip if
          // the visitor goes straight there
          onLogged={() => {}}
          onArticlePublished={(article) => {
            setArticles((a) => [article, ...a])
            // Marked as yours straight away, rather than only after a reload
            if (user) setMyArticles((mine) => [article, ...(mine ?? [])])
            // Straight to the list it just joined, filtered to yours. Publishing
            // an article from /reviews otherwise left you on the reviews feed,
            // where the thing you just wrote is not even shown — the rail links
            // it, twenty entries deep. The celebration travels with the
            // navigation rather than being cut short by it.
            const first = !alreadyCheered('article')
            if (first) markCheered('article')
            navigate('/articles?mine=1', { state: { cheer: { kind: 'article', first } } })
          }}
          startMode={composeMode}
          canPublishAsSite={isOwner}
          editing={editing}
          onEdited={(article) => {
            setArticles((a) => a.map((x) => (x.id === article.id ? article : x)))
            setMyArticles((mine) => (mine ?? []).map((x) => (x.id === article.id ? article : x)))
          }}
          editingPost={editingPost}
          onPostEdited={(post) => {
            setPosts((all) => all.map((p) => (p.id === post.id ? post : p)))
            setMyPosts((mine) => (mine ?? []).map((p) => (p.id === post.id ? post : p)))
          }}
        />

        <div className="genre-row blog-filter">
          {(
            [
              ['all', 'All reviews'],
              ['movie', 'Movies'],
              ['match', 'Cricket'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`genre-chip${filter === value ? ' active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          {/* A link out, not a filter in place: your own reviews want sorting
              and searching, which a shared feed cannot give them.
              Shown for a private log too — gating it on public posts alone left
              anyone who only keeps the log with no way to reach it from here at
              all, which is the one page their work is on. The count stays the
              number of *reviews*: a log entry is not a review, and adding them
              together would make the chip lie to save a word. */}
          {user && (myPosts?.length || myLogCount > 0) ? (
            <Link className="genre-chip mine" to="/my-reviews">
              My reviews
              {(myPosts?.length ?? 0) > 0 && (
                <span className="mine-count">{myPosts?.length}</span>
              )}
            </Link>
          ) : null}
        </div>

        <div className="blog-layout">
          <div className="blog-main">
            {loading ? (
              <div className="blog-feed" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="sk blog-card-sk" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="empty-state">
                <Feather size={54} />
                {/* An empty page should say what belongs here and why it is worth
                    adding, rather than only reporting that nothing is here */}
                {filter === 'movie' ? (
                  <>
                    <h3>No film reviews yet</h3>
                    <p>
                      Seen something on OTT or in a theatre this week? Tell everyone whether it was
                      worth it — a couple of lines and a rating is plenty.
                    </p>
                  </>
                ) : filter === 'match' ? (
                  <>
                    <h3>No match reviews yet</h3>
                    <p>
                      Watched a game worth talking about? Say what turned it — a couple of lines and
                      a rating is plenty.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Nobody has reviewed anything yet</h3>
                    <p>
                      Yours would be the first. Someone deciding what to watch tonight will read it
                      — that is the whole point of this page.
                    </p>
                  </>
                )}
                {/* Two ways out, so an empty page is never a dead end: name
                    something they may have watched, or send them to the films. */}
                {filter !== 'match' && (
                  <ReviewStarters
                    onPick={(tag) => {
                      setPreset(tag)
                      setComposeMode('review')
                      setComposerOpen(true)
                    }}
                  />
                )}
                <Link className="empty-onward" to="/movies">
                  See what released this week <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="blog-feed">
                {visible.map((post, i) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    index={i}
                    mine={mineIds.has(post.id)}
                    rating={ratings[post.id]}
                    onRated={(postId, summary) =>
                      setRatings((r) => ({ ...r, [postId]: summary }))
                    }
                    onOpen={setSelected}
                  />
                ))}
              </div>
            )}
          </div>
          {/* Articles, never reviews: the feed to the left already is the
              reviews, and an article has no release to date it. */}
          <ArticleIndex
            articles={articles}
            mineIds={mineArticleIds}
            likes={articleLikes}
            // Leads with the write invitation, as the rail on an article page
            // already did. The page's own CTA says "Write a review", so without
            // this the rail is the only place that offers the other kind — and
            // it was the one place not offering it.
            // No `empty` copy: with the invitation always present the rail is
            // never blank, and the invitation's own line already says what an
            // article can be
            write
          />
        </div>
      </div>
      {cheer && (
        <FirstCheer kind={cheer.kind} first={cheer.first} onDone={() => setCheer(null)} />
      )}
      {selected && (
        <PostModal
          post={selected}
          rating={ratings[selected.id]}
          own={mineIds.has(selected.id)}
          onRated={(postId, summary) => setRatings((r) => ({ ...r, [postId]: summary }))}
          onClose={closeSelected}
          onEdit={(post) => {
            // Close the modal first — the composer is above the feed, and
            // leaving an overlay open over it would hide what was opened
            closeSelected()
            setEditingPost(post)
            setComposerOpen(true)
          }}
          onDeleted={(postId) => {
            setPosts((all) => all.filter((p) => p.id !== postId))
            setMyPosts((mine) => (mine ?? []).filter((p) => p.id !== postId))
          }}
        />
      )}
    </main>
  )
}
