import { Fragment, JSX } from 'react'
import { Play } from 'lucide-react'
import { findFilmMentions, platformFromUrl, watchHref } from '../filmLinks'
import { platformClass } from '../share'
import { ArticleFilm } from '../types'

/**
 * Body text as paragraphs, with bare http(s) URLs turned into links.
 *
 * Articles are where someone says "watch it here" and pastes a link — as plain
 * text that is a URL the reader has to select and copy, which is not a link at
 * all. The composer is a plain textarea on purpose (no editor, no markdown to
 * learn), so this is where a pasted URL becomes usable.
 *
 * Links are visitor-supplied, so they open in a new tab and carry
 * `nofollow ugc noopener noreferrer` — the page must never lend its ranking to
 * whatever anyone pastes, and `noopener` keeps the opened tab off `window`.
 * The Worker's pre-render applies the same rule (linkify in seo.ts); the two
 * have to agree or a crawler and a reader see different pages.
 */

// Stops at whitespace and at the quote/bracket characters that normally sit
// around a pasted link rather than inside one
const URL_RE = /(https?:\/\/[^\s<>"']+)/g

/** Trailing sentence punctuation belongs to the sentence, not to the URL. */
function splitTrailing(url: string): [string, string] {
  const trimmed = url.replace(/[.,;:!?)\]}]+$/, '')
  return [trimmed, url.slice(trimmed.length)]
}

export function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <Fragment key={i}>{part}</Fragment>
        const [href, tail] = splitTrailing(part)
        const platform = platformFromUrl(href)
        return (
          <Fragment key={i}>
            {/* A link to a service we recognise is shown as that service's
                button: "Netflix" is readable, the URL it replaces is not */}
            <a
              className={platform ? `film-badge ${platformClass(platform)}` : undefined}
              href={href}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              title={platform ? `Open on ${platform}` : undefined}
            >
              {platform ? (
                <>
                  <Play size={10} fill="currentColor" />
                  {platform}
                </>
              ) : (
                href
              )}
            </a>
            {tail}
          </Fragment>
        )
      })}
    </>
  )
}

/** The platform badges that sit right after a film's name in the prose. */
function FilmBadges({ film, onOpen }: { film: ArticleFilm; onOpen: (platform: string) => void }) {
  return (
    <span className="film-badges">
      {film.platforms.map((p) => (
        <a
          key={p.name}
          className={`film-badge ${platformClass(p.name)}`}
          href={watchHref(p, film.title)}
          target="_blank"
          rel="nofollow noopener noreferrer"
          title={`Watch ${film.title} on ${p.name}`}
          onClick={() => onOpen(p.name)}
        >
          <Play size={10} fill="currentColor" />
          {p.name}
        </a>
      ))}
    </span>
  )
}

export default function Prose({
  text,
  className,
  films = [],
  onWatch,
}: {
  text: string
  className?: string
  /** Films to badge where they are named. */
  films?: ArticleFilm[]
  onWatch?: (film: ArticleFilm, platform: string) => void
}) {
  const paragraphs = text.split(/\n+/).filter((p) => p.trim())
  // One mention per film across the whole article, so a title repeated in the
  // closing paragraph does not collect a second set of badges
  const used = new Set<string>()
  return (
    <div className={className}>
      {paragraphs.map((raw, i) => {
        const p = raw.trim()
        const mentions = findFilmMentions(p, films, used)
        if (mentions.length === 0) {
          return (
            <p key={i}>
              <Linked text={p} />
            </p>
          )
        }
        const parts: JSX.Element[] = []
        let cursor = 0
        mentions.forEach((m, j) => {
          parts.push(<Linked key={`t${j}`} text={p.slice(cursor, m.end)} />)
          parts.push(
            <FilmBadges
              key={`b${j}`}
              film={m.film}
              onOpen={(platform) => onWatch?.(m.film, platform)}
            />
          )
          cursor = m.end
        })
        parts.push(<Linked key="tail" text={p.slice(cursor)} />)
        return <p key={i}>{parts}</p>
      })}
    </div>
  )
}
