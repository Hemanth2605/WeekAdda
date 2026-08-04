import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Film, PenLine, Search, Trophy } from 'lucide-react'
import { fetchArticles, fetchMyArticles } from '../api'
import { refreshUser, useGoogleUser } from '../auth'
import OfficialStamp from '../components/OfficialStamp'
import SaveArticle from '../components/SaveArticle'
import { timeAgo } from '../components/ReviewBits'
import { ArticleCardsSkeleton } from '../components/Skeletons'
import FirstCheer from '../components/FirstCheer'
import { articlePath, usePageMeta } from '../seo'
import { useSavedArticles } from '../saved'
import { Article } from '../types'

type Sort = 'new' | 'old'
type Topic = 'all' | 'movie' | 'match'

/**
 * Every article on the site, by everyone.
 *
 * The rail beside the reviews feed is the only other way in, and a rail is a
 * column of narrow rectangles — fine for the newest handful, useless once there
 * are fifty. This is where the rest live, with the same search, topic filter and
 * sort as /my-articles, whose card and tool markup it deliberately reuses so the
 * two cannot drift into looking like different features.
 *
 * Public, unlike /my-articles: it is a real listing of published writing, so it
 * is indexable and belongs in the sitemap. No sign-in anywhere on it.
 *
 * Sort has no "Most liked" option, which /my-articles does have. Like counts
 * come from a signed-in-only endpoint keyed to the asking account; sorting a
 * public page by a number it cannot fetch would order it silently wrong.
 */
export default function AllArticles() {
  const user = useGoogleUser()
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [sort, setSort] = useState<Sort>('new')
  const [topic, setTopic] = useState<Topic>('all')
  const [query, setQuery] = useState('')
  // Which of these you wrote. A display name cannot answer that — two people
  // can share one — so it comes from the same signed-in endpoint /my-articles
  // uses. Signed out it stays empty and nothing about the page changes.
  const [mineIds, setMineIds] = useState<Set<string>>(new Set())
  // The composer hands the celebration over in router state rather than firing
  // it before navigating, which would cut it short. Read once and then wiped
  // from history, so a refresh or a back-and-forward is a plain page load and
  // not a second party.
  const location = useLocation()
  const navigate = useNavigate()
  const handover = (location.state as { cheer?: { first: boolean } } | null)?.cheer
  const [cheer, setCheer] = useState<{ first: boolean } | null>(handover ?? null)
  useEffect(() => {
    if (handover) navigate(location.pathname + location.search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ?mine=1 — how the rail's "Yours N" arrives here. In the URL rather than in
  // state alone so the filtered view can be shared, bookmarked and backed out
  // of like any other page.
  const [params, setParams] = useSearchParams()
  const mineOnly = params.get('mine') === '1'
  const setMineOnly = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('mine', '1')
    else next.delete('mine')
    setParams(next, { replace: true })
    // Alternatives, not filters that stack — see the note by setSavedScope
    if (on) setSavedOnly(false)
  }

  /*
   * The read-later list, and its own filter.
   *
   * Kept in component state rather than the URL, unlike ?mine=1 above. Both are
   * account-scoped now, but ?mine=1 exists because the rail links into it from
   * another page; nothing links to a saved view, and a shared ?saved=1 would
   * open the recipient's list rather than the one being pointed at. It is a
   * note to yourself, so it is not a place worth having a URL.
   */
  const savedIds = useSavedArticles()
  const [savedOnly, setSavedOnly] = useState(false)

  /*
   * "Yours" and "Saved" are two answers to the same question — *whose* articles
   * am I looking at — so turning one on turns the other off.
   *
   * Stacking them was not merely confusing, it was guaranteed to show nothing:
   * you cannot save your own article, so the overlap between the two is empty
   * by construction. Two chips that combine into a certainly-blank page are a
   * dead end dressed up as a filter.
   *
   * The topic chips and the search box above are a different matter and do
   * still stack, because "which of mine are about cricket" is a real question.
   */
  const setSavedScope = (on: boolean) => {
    setSavedOnly(on)
    if (on) setMineOnly(false)
  }

  usePageMeta(
    'All Articles — Movies & Cricket Writing | WeekAdda',
    'Every article on WeekAdda: old films revisited, matches worth remembering, top tens and the arguments behind them — written by viewers, not critics.'
  )

  useEffect(() => {
    fetchArticles((r) => setArticles(r.articles))
      .then((r) => setArticles(r.articles))
      .catch(() => setArticles([]))
  }, [])

  useEffect(() => {
    const fresh = user && refreshUser()
    if (!fresh) return setMineIds(new Set())
    fetchMyArticles(fresh.token)
      .then((r) => setMineIds(new Set(r.articles.map((a) => a.id))))
      .catch(() => setMineIds(new Set()))
  }, [user])

  // Inert until the ids have actually arrived. Without this, ?mine=1 empties the
  // page on first paint — the account resolves a tick after the articles do —
  // and signing out would leave a filter matching nothing with no way to tell
  // why. Signed out, the chip is not rendered either, so the flag simply sits
  // in the URL doing nothing.
  const mineActive = mineOnly && mineIds.size > 0

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (articles ?? [])
      // Only ever one of these two — see setSavedScope. Both narrow "whose",
      // and the topic and search filters below narrow "which" on top of it.
      .filter((a) => !mineActive || mineIds.has(a.id))
      .filter((a) => !savedOnly || savedIds.includes(a.id))
      .filter((a) => topic === 'all' || a.topic === topic)
      .filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q) ||
          a.author.toLowerCase().includes(q)
      )
    return [...list].sort((a, b) => (sort === 'old' ? (a.ts > b.ts ? 1 : -1) : a.ts < b.ts ? 1 : -1))
  }, [articles, topic, query, sort, mineActive, mineIds, savedOnly, savedIds])

  const total = articles?.length ?? 0

  return (
    <main className="article-page my-articles">
      <Link className="movie-back" to="/reviews">
        <ArrowLeft size={15} /> Reviews and articles
      </Link>

      <header className="my-articles-head">
        <div>
          <h1>All articles</h1>
          {articles === null ? (
            <div className="sk sk-line" style={{ width: 150, marginTop: 8 }} aria-hidden="true" />
          ) : (
            <p>
              {total === 0
                ? 'Nothing published yet.'
                : `${total} published${shown.length !== total ? ` · ${shown.length} shown` : ''}`}
            </p>
          )}
        </div>
        <Link
          className="community-cta"
          to="/reviews?compose=article"
          state={{ from: '/articles' }}
        >
          <PenLine size={18} /> Write an article
        </Link>
      </header>

      {total > 0 && (
        <div className="my-articles-tools">
          <div className="search-wrap">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles…"
            />
          </div>
          <div className="genre-row">
            {(
              [
                ['all', 'All'],
                ['movie', 'Movies'],
                ['match', 'Cricket'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${topic === value ? ' active' : ''}`}
                onClick={() => setTopic(value)}
              >
                {label}
              </button>
            ))}
            {/* Shown only to someone who has written one, so it can never be a
                filter that only ever returns nothing. A filter here rather than
                a link to /my-articles: on this page it is one of the same row
                of chips, and it keeps the search and sort you already set. */}
            {mineIds.size > 0 && (
              <button
                className={`genre-chip mine${mineOnly ? ' active' : ''}`}
                onClick={() => setMineOnly(!mineOnly)}
                aria-pressed={mineOnly}
              >
                Yours <span className="mine-count">{mineIds.size}</span>
              </button>
            )}
            {/* Where the things put aside actually live. Shown only once
                something has been saved — a chip that can only ever return
                nothing is the same mistake "Yours" avoids above. Not in the
                URL, unlike ?mine=1: this list is on one browser, so a link to
                it would open someone else's empty page. */}
            {savedIds.length > 0 && (
              <button
                className={`genre-chip saved${savedOnly ? ' active' : ''}`}
                onClick={() => setSavedScope(!savedOnly)}
                aria-pressed={savedOnly}
                title="Articles you put aside to read later"
              >
                Saved <span className="mine-count">{savedIds.length}</span>
              </button>
            )}
          </div>
          <div className="genre-row my-articles-sort">
            <span className="my-articles-sort-label">Sort</span>
            {(
              [
                ['new', 'Newest'],
                ['old', 'Oldest'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`genre-chip${sort === value ? ' active' : ''}`}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {articles === null ? (
        <ArticleCardsSkeleton />
      ) : total === 0 ? (
        <div className="empty-state">
          <PenLine size={54} />
          <h3>No articles yet</h3>
          <p>
            The 1983 final, a top ten, an old film worth another look — anything that isn’t tied to
            this week’s releases. Yours could be the first.
          </p>
          <Link
          className="empty-onward"
          to="/reviews?compose=article"
          state={{ from: '/articles' }}
        >
            Write the first one
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="my-articles-none">Nothing matches that. Try a different search or filter.</p>
      ) : (
        <div className="my-articles-grid">
          {shown.map((a) => (
            <article key={a.id} className="my-article-card">
              {a.image ? (
                <img
                  className="my-article-thumb"
                  src={a.image}
                  alt=""
                  loading="lazy"
                  style={{
                    objectFit: a.imageFit ?? 'cover',
                    objectPosition: a.imagePosition ?? '50% 50%',
                  }}
                />
              ) : (
                <span className={`my-article-thumb fallback ${a.topic}`}>
                  {a.topic === 'movie' ? <Film size={20} /> : <Trophy size={20} />}
                </span>
              )}
              <div className="my-article-body">
                <span className="my-article-meta">
                  {a.topic === 'movie' ? <Film size={11} /> : <Trophy size={11} />}{' '}
                  {a.topic === 'movie' ? 'Movies' : 'Cricket'} · <CalendarDays size={11} />{' '}
                  {timeAgo(a.ts)}
                  {/* A site piece is bylined by the site and nothing else */}
                  {/* A site piece is bylined by the site alone — no writer's
                      name behind the stamp. "You" still shows, because it is
                      not a byline: only the account that wrote it can see it,
                      and without it the owner's own pieces are the one set of
                      articles they cannot pick out of a list. */}
                  {a.official ? <OfficialStamp compact /> : <> · {a.author}</>}
                  {/* Not while the list is already filtered to yours: the badge
                      exists to pick your own out of everyone else's, and when
                      there is no one else's it just repeats the chip you pressed
                      to get here, on every row. */}
                  {!mineActive && mineIds.has(a.id) && <span className="blog-you">You</span>}
                  {/* No like count here: counts come from a signed-in-only
                      endpoint keyed to the asking account, and this page never
                      asks anyone to sign in */}
                </span>
                {/* Carries where it was opened from, so the article's own back
                    link returns here rather than dumping you on /reviews */}
                <Link
                  className="my-article-title"
                  to={articlePath(a)}
                  state={{ from: '/articles', fromLabel: 'All articles' }}
                >
                  {a.title}
                </Link>
                <p className="my-article-excerpt">{a.body.replace(/\s+/g, ' ').slice(0, 160)}…</p>
                {/* Put it aside from the list, without opening it first — which
                    is the whole point of a read-later button: the moment you
                    decide "not now" is before you have read it, not after.
                    Never on your own: you are not going to forget the one you
                    wrote, and "Yours" already gathers those. */}
                {!mineIds.has(a.id) && <SaveArticle id={a.id} compact />}
              </div>
            </article>
          ))}
        </div>
      )}
      {cheer && <FirstCheer kind="article" first={cheer.first} onDone={() => setCheer(null)} />}
    </main>
  )
}
