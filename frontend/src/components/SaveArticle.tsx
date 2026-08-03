import { useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { authEnabled, useGoogleUser } from '../auth'
import { toggleSaved, useSavedArticles } from '../saved'

/**
 * Put an article aside for later.
 *
 * The list lives on the account so it follows the reader between devices (see
 * saved.ts), which means saving needs a sign-in. Rather than hide the button
 * from signed-out readers — they are the ones most likely to want it, and a
 * feature nobody can see is a feature nobody asks for — it stays, says what it
 * is, and explains itself when pressed.
 *
 * The label changes to "Saved" rather than an icon quietly filling in: a reader
 * who taps this is asking "will I find this again?" and deserves the answer in
 * words.
 */
export default function SaveArticle({
  id,
  /** Compact for a card in a list; full size on the article's own page. */
  compact,
}: {
  id: string
  compact?: boolean
}) {
  // Subscribed rather than read once, so every copy on the page agrees the
  // instant any one of them is pressed
  const saved = useSavedArticles().includes(id)
  const user = useGoogleUser()
  const [hint, setHint] = useState(false)
  const [busy, setBusy] = useState(false)

  const needsSignIn = authEnabled && !user

  const click = async (e: React.MouseEvent) => {
    // On a card the whole rectangle is a link to the article; saving is not a
    // request to go there
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    if (needsSignIn) {
      setHint(true)
      window.setTimeout(() => setHint(false), 4000)
      return
    }
    setBusy(true)
    try {
      await toggleSaved(id)
    } catch {
      // The store has already put the button back where it was; nothing more
      // to say than that it did not take
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className={`save-article${compact ? ' sm' : ''}${saved ? ' on' : ''}`}
      onClick={click}
      disabled={busy}
      title={
        needsSignIn
          ? 'Sign in to keep a reading list across your devices'
          : saved
            ? 'Saved to read later — click to remove'
            : 'Save to read later'
      }
      aria-pressed={saved}
    >
      {/* The site's gradient tile, in its own violet → sky (see .ico-save).
          Tinted glass while unsaved and fully lit once saved — the convention
          everywhere else: unselected is a style, not a dimmed version of
          selected, so the tile keeps its colour either way. */}
      <span className="save-ico ico-save" aria-hidden="true">
        {saved ? <BookmarkCheck size={compact ? 12 : 14} /> : <Bookmark size={compact ? 12 : 14} />}
      </span>
      <span>{hint ? 'Sign in to save' : saved ? 'Saved' : 'Save'}</span>
    </button>
  )
}
