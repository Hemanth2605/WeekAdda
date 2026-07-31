import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  ExternalLink,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  api,
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
} from '../types'
import PipShow from '../components/PipShow'
import ArticleIndex from '../components/ArticleIndex'
import FilmWatchPicker from '../components/FilmWatchPicker'
import ArticleImagePicker, { DEFAULT_POSITION } from '../components/ArticleImagePicker'
import Prose from '../components/Prose'
import { StarRow, TagLine, timeAgo } from '../components/ReviewBits'

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

  // "Write an article" must open the article side of the switch. Keyed on the
  // mode itself, not just on `open`, so it cannot re-apply and yank someone
  // back after they have switched by hand.
  useEffect(() => {
    if (open && startMode) setMode(startMode)
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

  const publish = () => {
    if (sending) return
    if (mode === 'review' && !tag)
      return setError(`Please tag the ${kind === 'movie' ? 'movie' : 'match'} you are writing about`)
    if (!title.trim()) return setError(`Give your ${mode} a title`)
    if (body.trim().length < 20) return setError('Write a little more — at least a few sentences')
    let token: string | undefined
    if (authEnabled) {
      const fresh = refreshUser()
      if (!fresh) return setError('Please sign in with Google to publish')
      token = fresh.token
    }
    setError('')
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
    <section className="blog-composer">
      <div className="blog-composer-head">
        <h2>
          <Feather size={17} />{' '}
          {editingPost
            ? 'Edit your review'
            : editing
              ? 'Edit your article'
              : mode === 'article'
                ? 'Your article'
                : 'Your take'}
        </h2>
        <button className="share-close" onClick={onClose} aria-label="Close composer">
          <X size={16} />
        </button>
      </div>

      {/* Hidden while editing: an article and a review are different stores, so
          switching sides mid-edit would have nowhere to save */}
      <div
        className="blog-mode"
        role="tablist"
        aria-label="What are you writing?"
        hidden={Boolean(editing || editingPost)}
      >
        <button
          role="tab"
          aria-selected={mode === 'review'}
          className={`blog-mode-btn${mode === 'review' ? ' active' : ''}`}
          onClick={() => setMode('review')}
        >
          <Star size={14} /> Review
          <em>Something out this week</em>
        </button>
        <button
          role="tab"
          aria-selected={mode === 'article'}
          className={`blog-mode-btn${mode === 'article' ? ' active' : ''}`}
          onClick={() => setMode('article')}
        >
          <Newspaper size={14} /> Article
          <em>Anything else — the 1983 final, a top ten, an old favourite</em>
        </button>
      </div>

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

      {mode === 'article' ? null : (
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

      {mode === 'article' ? null : tag ? (
        <div className="blog-tag-picked">
          {tag.poster ? (
            <img src={tag.poster} alt="" />
          ) : matchFlags(tag).length > 0 ? (
            <span className="blog-tag-flags">
              {matchFlags(tag).map((l, i) => (
                <img key={i} src={l} alt="" />
              ))}
            </span>
          ) : (
            <span className="blog-tag-icon">{tag.kind === 'movie' ? <Film size={16} /> : <Trophy size={16} />}</span>
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
        <div className="blog-tag-picker">
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
              <button key={o.id} className="blog-tag-option" onClick={() => setTag(o)}>
                {o.poster ? (
                  <img src={o.poster} alt="" loading="lazy" />
                ) : matchFlags(o).length > 0 ? (
                  <span className="blog-tag-flags">
                    {matchFlags(o).map((l, i) => (
                      <img key={i} src={l} alt="" loading="lazy" />
                    ))}
                  </span>
                ) : (
                  <span className="blog-tag-icon">{o.kind === 'movie' ? <Film size={15} /> : <Trophy size={15} />}</span>
                )}
                <span className="blog-tag-text">
                  <b>{o.label}</b>
                  <small>{o.sub}</small>
                </span>
              </button>
            ))}
            {suggestions.length === 0 && (
              <p className="blog-tag-empty">
                {kind === 'movie'
                  ? 'No film found — try another name, or a shorter one.'
                  : 'No match found — try a team name, like “India”.'}
              </p>
            )}
          </div>
        </div>
      )}

      <input
        className="blog-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
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
        className="blog-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        // An article has room to be an essay; a review is about one thing
        maxLength={mode === 'article' ? 20000 : 5000}
        rows={mode === 'article' ? 12 : 6}
        placeholder={
          mode === 'article'
            ? 'Take your time — no release date, no word limit worth worrying about.'
            : "What did you feel about it? The moments that worked, the ones that didn't…"
        }
      />
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
      {needsSignIn && (
        <p className="blog-signin-hint">
          Sign in with Google to publish — only used to keep reviews spam-free; your review shows
          the display name you choose.
        </p>
      )}
      {error && <p className="blog-error">{error}</p>}
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
            <span className="blog-card-poster fallback">
              {post.tag.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
            </span>
          )}
          <div className="blog-card-meta">
            <TagLine tag={post.tag} />
            <h2>{post.title}</h2>
            <span className="blog-card-byline">
              {post.author} {own && <span className="blog-you">You</span>} ·{' '}
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
            <button className="article-owner-btn" onClick={() => onEdit(post)}>
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
              <button className="article-owner-btn" onClick={() => setConfirming(true)}>
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
          <span className="blog-card-poster fallback">{post.tag.kind === 'movie' ? <Film size={20} /> : <Trophy size={20} />}</span>
        )}
        <div className="blog-card-meta">
          <TagLine tag={post.tag} />
          <h2>{post.title}</h2>
          <span className="blog-card-byline">
            {post.author} {mine && <span className="blog-you">You</span>} ·{' '}
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
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({})
  const [selected, setSelected] = useState<BlogPost | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
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

  // Arriving from "Write an article" opens the composer already on the article
  // side, then drops the key — so a refresh is a plain visit to /reviews rather
  // than a form reopening itself forever.
  useEffect(() => {
    if (wantedCompose !== 'article' && wantedCompose !== 'review') return
    setComposeMode(wantedCompose)
    setComposerOpen(true)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('compose')
        return next
      },
      { replace: true }
    )
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
      return
    }
    fetchMyPosts(fresh.token)
      .then((r) => setMyPosts(r.posts))
      .catch(() => setMyPosts([]))
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
          }}
          onPublished={(post) => {
            setPosts((p) => [post, ...p])
            if (user) setMyPosts((mine) => [post, ...(mine ?? [])])
          }}
          onArticlePublished={(article) => {
            setArticles((a) => [article, ...a])
            // Marked as yours straight away, rather than only after a reload
            if (user) setMyArticles((mine) => [article, ...(mine ?? [])])
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
              and searching, which a shared feed cannot give them */}
          {user && myPosts !== null && myPosts.length > 0 && (
            <Link className="genre-chip mine" to="/my-reviews">
              My reviews<span className="mine-count">{myPosts.length}</span>
            </Link>
          )}
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
            empty="Nothing here yet — the 1983 final, a top ten, an old favourite. Write one from “Write a review”."
          />
        </div>
      </div>
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
