import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Feather,
  Film,
  Trophy,
  Search,
  Send,
  X,
  PenLine,
  CalendarDays,
  Tag,
  Star,
} from 'lucide-react'
import { api, fetchPosts, fetchMyPosts, fetchRatings, ratePost, createPost } from '../api'
import { authEnabled, refreshUser, signInWithGoogle, signOut, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import { matchFlags } from '../flags'
import { usePageMeta } from '../seo'
import { BlogPost, BlogTag, RatingSummary, Release, CricketMatch } from '../types'

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Tiny letter tiles drifting down behind the page — pure decoration
const RAIN_GLYPHS = 'సినిమాక్రికెట్వారంఅడ్డాCINEMAOTTCRICKETBLOG★🎬🏏'

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

function Composer({
  open,
  onClose,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  onPublished: (post: BlogPost) => void
}) {
  const [kind, setKind] = useState<'movie' | 'match'>('movie')
  const [tag, setTag] = useState<BlogTag | null>(null)
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
    if (!tag) return setError(`Please tag the ${kind === 'movie' ? 'movie' : 'match'} you are writing about`)
    if (!title.trim()) return setError('Give your blog a title')
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
    createPost({ author: author.trim(), title: title.trim(), body: body.trim(), tag }, token)
      .then((post) => {
        onPublished(post)
        onClose()
        setTag(null)
        setTagSearch('')
        setTitle('')
        setBody('')
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes('sign in')) signOut()
        setError(err.message || 'Could not publish right now — please try again')
      })
      .finally(() => setSending(false))
  }

  if (!open) return null

  return (
    <section className="blog-composer">
      <div className="blog-composer-head">
        <h2>
          <Feather size={17} /> Your take
        </h2>
        <button className="share-close" onClick={onClose} aria-label="Close composer">
          <X size={16} />
        </button>
      </div>

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

      {tag ? (
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
              placeholder={kind === 'movie' ? 'Search the movie or series you watched…' : 'Search the match or series…'}
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
            {suggestions.length === 0 && <p className="blog-tag-empty">Nothing found — try another name.</p>}
          </div>
        </div>
      )}

      <input
        className="blog-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Blog title — e.g. “This one deserves a second week in theatres”"
      />
      <textarea
        className="blog-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        rows={6}
        placeholder="What did you feel about it? The moments that worked, the ones that didn't…"
      />
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
        <span className="blog-count">{body.length}/5000</span>
        {needsSignIn ? (
          <GoogleButton onError={setError} />
        ) : (
          <button className="share-wa sm" onClick={publish} disabled={sending}>
            <Send size={14} /> {sending ? 'Publishing…' : 'Publish'}
          </button>
        )}
      </div>
      {needsSignIn && (
        <p className="blog-signin-hint">
          Sign in with Google to publish — only used to keep the blog spam-free; your post shows
          the display name you choose.
        </p>
      )}
      {error && <p className="blog-error">{error}</p>}
    </section>
  )
}

/**
 * 5-star rating row on a post. Reading is free; the first click from a
 * signed-out visitor opens the Google popup, then their rating applies.
 * Authors can see their post's average but can't rate it themselves.
 */
function StarRow({
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

/** Full take in a modal — same pattern as movie cards, no grid reflow. */
function PostModal({
  post,
  rating,
  own,
  onRated,
  onClose,
}: {
  post: BlogPost
  rating?: RatingSummary
  own: boolean
  onRated: (postId: string, summary: RatingSummary) => void
  onClose: () => void
}) {
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
            <span className="blog-card-tag">
              <Tag size={12} /> {post.tag.label}
              {post.tag.sub && <em> · {post.tag.sub}</em>}
            </span>
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
          <span className="blog-card-tag">
            <Tag size={12} /> {post.tag.label}
            {post.tag.sub && <em> · {post.tag.sub}</em>}
          </span>
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

export default function Blog() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'movie' | 'match' | 'mine'>('all')
  // The signed-in visitor's own contributions ("My takes")
  const user = useGoogleUser()
  const [myPosts, setMyPosts] = useState<BlogPost[] | null>(null)
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({})
  const [selected, setSelected] = useState<BlogPost | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)

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
      setFilter((f) => (f === 'mine' ? 'all' : f))
      return
    }
    fetchMyPosts(fresh.token)
      .then((r) => setMyPosts(r.posts))
      .catch(() => setMyPosts([]))
  }, [user])

  const mineIds = useMemo(() => new Set((myPosts ?? []).map((p) => p.id)), [myPosts])

  usePageMeta(
    'WeekAdda Blog — Audience Takes on Movies & Cricket',
    'Real audience blogs about this week’s movies, OTT releases and cricket matches — written by WeekAdda visitors, tagged to the title or match they talk about.'
  )

  useEffect(() => {
    fetchPosts()
      .then((r) => setPosts(r.posts))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const visible =
    filter === 'all'
      ? posts
      : filter === 'mine'
        ? (myPosts ?? [])
        : posts.filter((p) => p.tag.kind === filter)

  return (
    <main className="blog-page">
      <LetterRain />
      <section className="community-hero">
        <div className="community-hero-text">
          <h1 className="sr-only">The WeekAdda Blog</h1>
          <span className="hero-eyebrow">
            <Feather size={13} /> From the audience
          </span>
          <p>
            Real takes from real viewers — what the week's movies and matches actually felt
            like. Every post is tagged to the title or match it talks about.
          </p>
        </div>
        {!composerOpen && (
          <button className="community-cta" onClick={() => setComposerOpen(true)}>
            <PenLine size={18} /> Write your take
          </button>
        )}
      </section>

      <div className="blog-wrap">
        <Composer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onPublished={(post) => {
            setPosts((p) => [post, ...p])
            if (user) setMyPosts((mine) => [post, ...(mine ?? [])])
          }}
        />

        <div className="genre-row blog-filter">
          {(
            [
              ['all', 'All posts'],
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
          {user && myPosts !== null && (
            <button
              className={`genre-chip mine${filter === 'mine' ? ' active' : ''}`}
              onClick={() => setFilter('mine')}
            >
              My takes{myPosts.length > 0 && <span className="mine-count">{myPosts.length}</span>}
            </button>
          )}
        </div>

        {filter === 'mine' && myPosts !== null && myPosts.length > 0 && (
          <p className="mine-summary">
            You&apos;ve contributed {myPosts.length} take{myPosts.length === 1 ? '' : 's'} to the
            WeekAdda blog — thanks for writing!
          </p>
        )}

        {loading ? (
          <div className="blog-feed" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk blog-card-sk" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <Feather size={54} />
            {filter === 'mine' ? (
              <>
                <h3>No takes from you yet</h3>
                <p>
                  Write your first — hit “Write your take” above and it will show up here under
                  your name.
                </p>
              </>
            ) : (
              <>
                <h3>No posts yet</h3>
                <p>Be the first — hit “Write your take” and tell everyone about something you watched.</p>
              </>
            )}
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
      {selected && (
        <PostModal
          post={selected}
          rating={ratings[selected.id]}
          own={mineIds.has(selected.id)}
          onRated={(postId, summary) => setRatings((r) => ({ ...r, [postId]: summary }))}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  )
}
