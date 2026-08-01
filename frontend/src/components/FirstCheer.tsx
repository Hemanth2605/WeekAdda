import { useEffect, useMemo } from 'react'
import { PartyPopper, X } from 'lucide-react'

/**
 * The one-time celebration for someone's first published piece.
 *
 * Deliberately once per kind, ever: a party that fires on every publish is
 * noise by the third time, and the thing being marked is *starting*, not
 * posting. `alreadyCheered`/`markCheered` below hold that in localStorage —
 * server-side would be more exact, but there is no user table to count against
 * and a browser that forgets is a far cheaper failure than a party nobody
 * asked for.
 *
 * Confetti falls from above the viewport rather than bursting from the button:
 * the composer closes as this opens, so there is no button left to burst from.
 */

const FIRST: Record<Kind, { title: string; line: string }> = {
  review: {
    title: 'Your first review is live!',
    line: 'Many more to go. Someone deciding what to watch this week now has a real opinion to go on — yours.',
  },
  article: {
    title: 'Your first article is live!',
    line: 'Many more to go. This one isn’t tied to a release date, so it will still be worth reading next year.',
  },
  post: {
    title: 'Your first post is live!',
    line: 'Many more to go. Anyone who’s interested can reach you now, and you’ll see exactly who they are.',
  },
}

/** Every publish after the first still gets a plain answer to "did that work?" */
const AGAIN: Record<Kind, { title: string; line: string }> = {
  review: { title: 'Review published', line: 'It’s live at the top of the feed.' },
  article: { title: 'Article published', line: 'It’s live, and listed in the articles rail.' },
  post: { title: 'Posted to the adda', line: 'It’s live on the board.' },
}

export type Kind = 'review' | 'article' | 'post'

const KEY = (kind: Kind) => `weekadda-cheered-${kind}`

/** True once this browser has already celebrated this kind. */
export function alreadyCheered(kind: Kind): boolean {
  try {
    return localStorage.getItem(KEY(kind)) === '1'
  } catch {
    // Private mode: they get the party again next time, which is the kind
    // side of getting this wrong
    return false
  }
}

export function markCheered(kind: Kind) {
  try {
    localStorage.setItem(KEY(kind), '1')
  } catch {
    // As above — nothing to recover, and nothing breaks
  }
}

/** The registry's palettes, so the confetti is made of the site's own colours. */
const COLOURS = [
  '#7c5cff',
  '#d247c8',
  '#ff7a3d',
  '#f0326a',
  '#2bc46b',
  '#10a5c4',
  '#f5a524',
  '#a3e635',
  '#2f7bff',
  '#e8b34b',
]

export default function FirstCheer({
  kind,
  first,
  onDone,
}: {
  kind: Kind
  /** Confetti and the long copy; false gives the plain "it published" note. */
  first: boolean
  onDone: () => void
}) {
  // Fixed count, generated once — regenerating on re-render would restart every
  // piece mid-fall
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        // 37 is coprime with 100, so stepping by it walks the full width
        // without ever repeating a column — an even spread from a fixed list
        left: (i * 37) % 100,
        delay: (i % 14) * 0.11,
        duration: 2.3 + ((i * 7) % 14) / 10,
        colour: COLOURS[i % COLOURS.length],
        drift: ((i % 7) - 3) * 24,
        round: i % 3 === 0,
      })),
    []
  )

  // Long enough to read the line, short enough that it never has to be dismissed
  useEffect(() => {
    const t = setTimeout(onDone, first ? 7000 : 3500)
    return () => clearTimeout(t)
  }, [onDone, first])

  const copy = first ? FIRST[kind] : AGAIN[kind]

  return (
    <div className="cheer" role="status" aria-live="polite">
      <div className="cheer-fall" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            className={p.round ? 'cheer-bit round' : 'cheer-bit'}
            style={
              {
                left: `${p.left}%`,
                background: p.colour,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                '--drift': `${p.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="cheer-card">
        {/* Drawn rather than dropped in: the ring closes, then the tick is
            struck through it, which reads as "this completed" in a way a
            static check mark never does. Hand-rolled SVG, not the lucide
            Check — the stroke has to be dash-animated. */}
        <svg className="cheer-tick" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="cheer-tick-ring" cx="26" cy="26" r="23" />
          <path className="cheer-tick-mark" d="M15 26.5 l7.5 7.5 l15 -16" />
        </svg>
        {first && (
          <span className="cheer-kicker">
            <PartyPopper size={13} /> A first
          </span>
        )}
        <strong>{copy.title}</strong>
        <span className="cheer-line">{copy.line}</span>
        <button className="cheer-close" onClick={onDone} aria-label="Close">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
