import { Link } from 'react-router-dom'
import { ArrowRight, Film, Heart, PenLine, Trophy } from 'lucide-react'
import { articlePath } from '../seo'
import { Article, LikeSummary } from '../types'
import OfficialStamp from './OfficialStamp'

const TOPIC_LABEL: Record<Article['topic'], string> = { movie: 'Movies', match: 'Cricket' }

/**
 * The rail down the right of the page: articles, as small rectangles carrying
 * their title. Deliberately never reviews — a review answers "is this week's
 * film worth it" and belongs in the feed beside it; an article has no release
 * to hang on and would be buried there within a week.
 *
 * Used twice: beside the reviews feed, where it is the way into the articles,
 * and beside an article, where it holds the related ones. Same component, so
 * the second can never look like a different feature from the first.
 */
export default function ArticleIndex({
  articles,
  heading = 'Articles',
  currentId,
  empty,
  write,
  mineIds,
  likes,
}: {
  articles: Article[]
  heading?: string
  /** Highlighted rather than hidden — where you are is part of the list. */
  currentId?: string
  /** Shown instead of the list when there is nothing yet. */
  empty?: string
  /**
   * The signed-in writer's own article ids. Without this there is no way to
   * tell which of these you wrote — a display name is not an answer, since two
   * people can share one.
   */
  mineIds?: Set<string>
  /** Like counts, keyed by article id. Read-only in the rail. */
  likes?: Record<string, LikeSummary>
  /**
   * Lead the rail with a write invitation. On an article page this is the only
   * prompt in sight — the "Write a review" button lives back on /reviews, and
   * someone who just finished reading is exactly who might write the next one.
   */
  write?: boolean
}) {
  const mineCount = mineIds ? articles.filter((a) => mineIds.has(a.id)).length : 0

  if (articles.length === 0 && !write) {
    return empty ? (
      <aside className="blog-index" aria-label={heading}>
        <div className="blog-index-head">
          <h2>{heading}</h2>
        </div>
        <p className="blog-index-empty">{empty}</p>
      </aside>
    ) : null
  }
  return (
    <aside className="blog-index" aria-label={heading}>
      <div className="blog-index-head">
        <h2>{heading}</h2>
        {mineCount > 0 ? (
          // A link out, not a filter in place: a rail this narrow cannot sort,
          // search or hold a hundred titles, and that is what a writer with a
          // body of work actually needs
          <Link className="blog-index-mine" to="/my-articles" title="Everything you have written">
            Yours {mineCount} →
          </Link>
        ) : (
          articles.length > 0 && <span className="count">{articles.length}</span>
        )}
      </div>
      <ol className="blog-index-list">
        {write && (
          <li>
            {/* Opens the composer already switched to Article — landing on the
                reviews form after clicking "write an article" is a small lie */}
            <Link className="blog-index-item write" to="/reviews?compose=article">
              <span className="blog-index-text">
                <span className="blog-index-title">Write an article</span>
                <span className="blog-index-sub">An old match, an old film, a top ten</span>
              </span>
              <span className="blog-index-go" aria-hidden="true">
                <PenLine size={14} />
              </span>
            </Link>
          </li>
        )}
        {articles.map((a) => (
          <li key={a.id}>
            <Link
              className={`blog-index-item${a.id === currentId ? ' current' : ''}`}
              to={articlePath(a)}
              aria-current={a.id === currentId ? 'page' : undefined}
            >
              <span className="blog-index-text">
                <span className="blog-index-title">{a.title}</span>
                <span className="blog-index-sub">
                  {a.topic === 'movie' ? <Film size={11} /> : <Trophy size={11} />}{' '}
                  {TOPIC_LABEL[a.topic]} ·{' '}
                  {/* A site piece is bylined by the site and nothing else — no
                      writer's name behind it, no "You". Everyone else is
                      credited by name, with "You" so they can find their own. */}
                  {a.official ? (
                    <OfficialStamp compact />
                  ) : (
                    <>
                      {a.author}
                      {mineIds?.has(a.id) && <span className="blog-you">You</span>}
                    </>
                  )}
                  {/* Read-only here — liking happens on the article, where the
                      reader has actually read the thing */}
                  {(likes?.[a.id]?.count ?? 0) > 0 && (
                    <em className="blog-index-likes">
                      {' '}
                      · <Heart size={10} fill="currentColor" /> {likes![a.id].count}
                    </em>
                  )}
                </span>
              </span>
              {/* Says the card leaves the page — the cards in the feed beside
                  it open in place, and nothing else tells them apart at a
                  glance. Decorative: the whole rectangle is the link. */}
              <span className="blog-index-go" aria-hidden="true">
                <ArrowRight size={14} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  )
}
