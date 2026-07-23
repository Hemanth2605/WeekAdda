import { useEffect, useMemo, useState } from 'react'
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
} from 'lucide-react'
import { api, fetchPosts, createPost } from '../api'
import { usePageMeta } from '../seo'
import { BlogPost, BlogTag, Release, CricketMatch } from '../types'

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
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

function Composer({ onPublished }: { onPublished: (post: BlogPost) => void }) {
  const [open, setOpen] = useState(false)
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
    setError('')
    setSending(true)
    try {
      localStorage.setItem('weekadda-author', author.trim())
    } catch {
      // remembering the name is best-effort
    }
    createPost({ author: author.trim(), title: title.trim(), body: body.trim(), tag })
      .then((post) => {
        onPublished(post)
        setOpen(false)
        setTag(null)
        setTagSearch('')
        setTitle('')
        setBody('')
      })
      .catch(() => setError('Could not publish right now — please try again'))
      .finally(() => setSending(false))
  }

  if (!open) {
    return (
      <button className="blog-open-composer" onClick={() => setOpen(true)}>
        <PenLine size={17} />
        <span>
          <b>Write your take</b>
          <small>Loved it? Hated it? Tag a movie or a match and tell everyone why.</small>
        </span>
      </button>
    )
  }

  return (
    <section className="blog-composer">
      <div className="blog-composer-head">
        <h2>
          <Feather size={17} /> Your take
        </h2>
        <button className="share-close" onClick={() => setOpen(false)} aria-label="Close composer">
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
          {tag.poster ? <img src={tag.poster} alt="" /> : <span className="blog-tag-icon">{tag.kind === 'movie' ? <Film size={16} /> : <Trophy size={16} />}</span>}
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
                {o.poster ? <img src={o.poster} alt="" loading="lazy" /> : <span className="blog-tag-icon">{o.kind === 'movie' ? <Film size={15} /> : <Trophy size={15} />}</span>}
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
          placeholder="Your name — blank posts as Anonymous"
        />
        <span className="blog-count">{body.length}/5000</span>
        <button className="share-wa sm" onClick={publish} disabled={sending}>
          <Send size={14} /> {sending ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      {error && <p className="blog-error">{error}</p>}
    </section>
  )
}

function PostCard({ post, index }: { post: BlogPost; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const paragraphs = post.body.split(/\n+/).filter((p) => p.trim())
  const long = post.body.length > 420
  const shown = expanded || !long ? paragraphs : [post.body.slice(0, 420) + '…']

  return (
    <article className="blog-card" style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}>
      <header className="blog-card-head">
        {post.tag.poster ? (
          <img className="blog-card-poster" src={post.tag.poster} alt="" loading="lazy" />
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
            {post.author} · <CalendarDays size={12} /> {timeAgo(post.ts)}
          </span>
        </div>
      </header>
      <div className="blog-card-body">
        {shown.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {long && (
        <button className="blog-readmore" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Read the full take →'}
        </button>
      )}
    </article>
  )
}

export default function Blog() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'movie' | 'match'>('all')

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

  const visible = filter === 'all' ? posts : posts.filter((p) => p.tag.kind === filter)

  return (
    <main>
      <section className="opp-header">
        <div>
          <span className="hero-eyebrow">
            <Feather size={13} /> From the audience
          </span>
          <h1>The WeekAdda Blog</h1>
          <p>
            Real takes from real viewers — what the week's movies and matches actually felt
            like. Every post is tagged to the title or match it talks about.
          </p>
        </div>
      </section>

      <div className="blog-wrap">
        <Composer onPublished={(post) => setPosts((p) => [post, ...p])} />

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
        </div>

        {loading ? (
          <div className="blog-feed" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk blog-card-sk" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <Feather size={54} />
            <h3>No posts yet</h3>
            <p>Be the first — hit “Write your take” and tell everyone about something you watched.</p>
          </div>
        ) : (
          <div className="blog-feed">
            {visible.map((post, i) => (
              <PostCard key={post.id} post={post} index={i} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
