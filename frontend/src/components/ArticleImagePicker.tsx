import { useRef, useState } from 'react'
import { Crop, ImagePlus, Loader2, Maximize2, X } from 'lucide-react'
import { uploadArticleImage } from '../api'
import { authEnabled, refreshUser, signInWithGoogle, useGoogleUser } from '../auth'

/**
 * Cover image for an article. Articles only: a review is a paragraph about
 * something that already carries a poster, and a picture there would only ever
 * be borrowing someone else's.
 *
 * Uploaded on choosing rather than on publish, so the writer sees the real
 * stored image before committing to it — and so publish stays a single JSON
 * request carrying nothing but a URL.
 */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Google's failure modes are raw event names. A dismissed popup is not an
 * error worth showing; a blocked one is, and it needs to say what to do about
 * it, since nothing on the page explains why nothing happened.
 */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (message === 'popup_closed' || message === 'popup_closed_by_user') return ''
  if (message === 'popup_failed_to_open') {
    return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.'
  }
  return message || 'Something went wrong — please try again'
}
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif'

export const DEFAULT_POSITION = '50% 50%'

export default function ArticleImagePicker({
  image,
  position = DEFAULT_POSITION,
  fit = 'cover',
  onChange,
  onPositionChange,
  onFitChange,
}: {
  image?: string
  position?: string
  fit?: 'cover' | 'contain'
  onChange: (url: string | undefined) => void
  onPositionChange: (position: string) => void
  onFitChange: (fit: 'cover' | 'contain') => void
}) {
  const [dragging, setDragging] = useState(false)

  /**
   * Dragging names the point of the picture that must stay visible, which is
   * what object-position takes — so there is no cropping, no re-encoding, and
   * nothing to undo. The cursor's position within the box *is* the answer.
   */
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const pct = (value: number, size: number) =>
      Math.round(Math.min(100, Math.max(0, (value / size) * 100)))
    onPositionChange(`${pct(e.clientX - box.left, box.width)}% ${pct(e.clientY - box.top, box.height)}%`)
  }

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // App-wide, so signing in from the navbar counts here too
  const user = useGoogleUser()
  const needsSignIn = authEnabled && !user

  /**
   * Sign-in happens on this button's click and never later. Google's popup is
   * blocked unless it opens straight out of a user gesture, and choosing a file
   * spends that gesture on the OS dialog — asking afterwards failed with
   * `popup_failed_to_open`. So: sign in first, pick the file second.
   */
  const signIn = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  const pick = async (file: File | undefined) => {
    if (!file || busy) return
    setError('')
    // Checked here as well as on the server: a 4 MB upload that is going to be
    // refused should not be sent at all, least of all on a phone connection
    if (!ACCEPT.split(',').includes(file.type)) {
      return setError('Use a JPEG, PNG, WebP, AVIF or GIF image')
    }
    if (file.size > MAX_BYTES) return setError('That image is larger than 4 MB')
    const token = authEnabled ? refreshUser()?.token : undefined
    if (authEnabled && !token) return setError('Please sign in first, then choose the image')
    setBusy(true)
    try {
      const { url } = await uploadArticleImage(file, token)
      onChange(url)
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="article-image-picker">
      <span className="film-picker-label">
        <ImagePlus size={13} /> Cover image <em>optional</em>
      </span>

      {image ? (
        <>
          {/* Framed in the same box the article uses, so what is dragged here
              is exactly what publishes — a preview at a different aspect ratio
              would be worse than none */}
          <div
            className="article-image-preview"
            onPointerDown={(e) => {
              if (fit === 'contain') return
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragging(true)
              drag(e)
            }}
            onPointerMove={(e) => dragging && drag(e)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            data-draggable={fit !== 'contain'}
          >
            <img src={image} alt="" style={{ objectFit: fit, objectPosition: position }} />
            <button
              className="share-close"
              onClick={() => onChange(undefined)}
              aria-label="Remove image"
            >
              <X size={14} />
            </button>
          </div>
          <div className="image-frame-tools">
            <span className="film-picked-hint">
              {fit === 'contain'
                ? 'Whole picture shown — nothing cropped.'
                : 'Drag the picture to choose what stays in frame.'}
            </span>
            <div className="genre-row">
              <button
                className={`genre-chip${fit === 'cover' ? ' active' : ''}`}
                onClick={() => onFitChange('cover')}
              >
                <Crop size={13} /> Fill
              </button>
              <button
                className={`genre-chip${fit === 'contain' ? ' active' : ''}`}
                onClick={() => onFitChange('contain')}
              >
                <Maximize2 size={13} /> Whole image
              </button>
              {fit !== 'contain' && position !== DEFAULT_POSITION && (
                <button className="genre-chip" onClick={() => onPositionChange(DEFAULT_POSITION)}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <button
          className="article-image-drop"
          onClick={() => (needsSignIn ? signIn() : inputRef.current?.click())}
          disabled={busy}
        >
          {busy ? <Loader2 size={16} className="spinning" /> : <ImagePlus size={16} />}
          {busy ? 'Working…' : needsSignIn ? 'Sign in to add a cover' : 'Choose an image'}
          <em>
            {needsSignIn
              ? 'Uploading needs a Google account — one click, then pick the file'
              : 'JPEG, PNG, WebP, AVIF or GIF · up to 4 MB'}
          </em>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error && <p className="blog-error">{error}</p>}
    </div>
  )
}
