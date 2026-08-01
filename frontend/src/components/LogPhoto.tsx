import { useEffect, useState } from 'react'
import { signLogImage, uploadLogImage } from '../api'
import { refreshUser } from '../auth'
import ArticleImagePicker from './ArticleImagePicker'

/**
 * The photo on a log entry — a ticket stub, the screen, whoever you went with.
 *
 * The picker itself is the article one: same drag-to-frame, same Fill / Whole
 * image choice, same upload rules. Only two things differ, and both come from
 * the bucket being private — what is stored is a *path* rather than a URL, and
 * showing it means asking for a signed URL first. So this component is that
 * difference and nothing else.
 */
export default function LogPhoto({
  path,
  position,
  fit,
  onChange,
  onPositionChange,
  onFitChange,
}: {
  /** Storage path, not a URL. */
  path?: string
  position?: string
  fit?: 'cover' | 'contain'
  onChange: (path: string | undefined) => void
  onPositionChange: (position: string) => void
  onFitChange: (fit: 'cover' | 'contain') => void
}) {
  const [signed, setSigned] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')

  /**
   * A signed URL for whatever is stored, refreshed when the path changes.
   *
   * A failure here has to be said out loud. Showing nothing is exactly what a
   * failed *upload* looks like, so the one thing this must never do is leave
   * someone unable to tell which of the two happened.
   */
  useEffect(() => {
    let cancelled = false
    setSigned(undefined)
    setNote('')
    if (!path) return
    const token = refreshUser()?.token
    if (!token) return
    signLogImage(path, token)
      .then((url) => !cancelled && setSigned(url))
      .catch(() => {
        if (!cancelled) setNote('Uploaded, but the preview could not load. It is saved.')
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <>
      <ArticleImagePicker
        image={path}
        // Until the signature arrives there is nothing to draw, so the picker
        // shows its own empty frame rather than a broken image
        src={signed}
        label="Photo — only you see it"
        position={position}
        fit={fit}
        upload={uploadLogImage}
        onChange={onChange}
        onPositionChange={onPositionChange}
        onFitChange={onFitChange}
      />
      {note && <p className="blog-error">{note}</p>}
    </>
  )
}
