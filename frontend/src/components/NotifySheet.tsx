import { useEffect, useState, type CSSProperties } from 'react'
import { Bell, Check, Globe, X } from 'lucide-react'
import { LanguageInfo } from '../types'
import { ALL_LANGUAGES } from '../languages'
import { NOTIFY_EVENT, NotifyPayload, notifyChanged } from '../notify'
import { PushDenied, pushSupported, subscribe } from '../push'
import { api } from '../api'

/**
 * The one place the permission prompt can fire. Mounted once in App and opened
 * by NOTIFY_EVENT, the same way ShareSheet works.
 *
 * A bottom sheet on phones rather than a centred dialog: on a tall screen a
 * centred confirm button sits where thumbs do not reach, and a sheet is what
 * Android users expect. Languages are asked for rather than inferred — the
 * filter is one click, ticking a box is a decision — though whatever they were
 * browsing arrives pre-ticked.
 */
export default function NotifySheet() {
  const [open, setOpen] = useState(false)
  const [languages, setLanguages] = useState<LanguageInfo[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<NotifyPayload>).detail
      // Browsing with no language filter *is* "all", so it now pre-ticks that
      // rather than arriving with nothing chosen and the button disabled
      const wanted = detail?.languages?.filter(Boolean) ?? []
      setPicked(wanted.includes(ALL_LANGUAGES) ? [ALL_LANGUAGES] : wanted)
      setError('')
      setDone(false)
      setOpen(true)
    }
    window.addEventListener(NOTIFY_EVENT, onOpen)
    return () => window.removeEventListener(NOTIFY_EVENT, onOpen)
  }, [])

  // The language list is whatever this week actually has; fetched only when the
  // sheet is first opened, so it costs nothing for people who never open it
  useEffect(() => {
    if (!open || languages.length > 0) return
    api<{ languages: LanguageInfo[] }>('/releases?window=ott')
      .then((res) => setLanguages(res.languages ?? []))
      .catch(() => setLanguages([]))
  }, [open, languages.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || !pushSupported) return null

  const toggle = (code: string) =>
    setPicked((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))

  // "All languages" is stored as the sentinel rather than as every code we
  // happen to publish today — someone who asked for everything means everything,
  // including whatever gets added later. Ticking a single language therefore
  // replaces it rather than adding to it.
  const allPicked = picked.includes(ALL_LANGUAGES)
  const pickAll = () => setPicked(allPicked ? [] : [ALL_LANGUAGES])
  const pickOne = (code: string) => (allPicked ? setPicked([code]) : toggle(code))

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await subscribe(picked)
      notifyChanged()
      setDone(true)
      setTimeout(() => setOpen(false), 1400)
    } catch (err) {
      setError(
        err instanceof PushDenied
          ? 'Your browser is blocking notifications for this site. You can allow them in site settings.'
          : err instanceof Error
            ? err.message
            : 'Could not turn notifications on'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notify-backdrop" onClick={() => setOpen(false)}>
      <div className="notify-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <button className="notify-close" onClick={() => setOpen(false)} aria-label="Close">
          <X size={17} />
        </button>

        {done ? (
          <div className="notify-done">
            <span className="notify-done-ring">
              <Check size={30} />
            </span>
            <h3>You’re all set</h3>
            <p>The next release will find you.</p>
          </div>
        ) : (
          <>
            <span className="notify-icon">
              <Bell size={19} />
            </span>
            <h3>Never miss a release</h3>
            <p>
              Pick your languages and we’ll ping you the day something lands — only then, never a
              daily digest. No account, no email, off again whenever you like.
            </p>

            <div className="notify-langs">
              <button
                className={allPicked ? 'notify-lang all picked' : 'notify-lang all'}
                onClick={pickAll}
                aria-pressed={allPicked}
              >
                {/* The globe stays in both states rather than turning into a
                    tick: it is what tells this chip apart from the twelve, and
                    a tick would make it look like the thirteenth language.
                    Selection shows as the globe's own colour change — plus the
                    chip filling — not as a different icon. */}
                <Globe size={13} className="notify-globe" /> All languages
              </button>
              {languages
                .filter((l) => l.code !== ALL_LANGUAGES)
                .map((l, i) => (
                  <button
                    key={l.code}
                    className={
                      allPicked || picked.includes(l.code) ? 'notify-lang picked' : 'notify-lang'
                    }
                    // Position in the row, so ticking "All" fills it left to
                    // right instead of flashing twelve boxes at once
                    style={{ '--i': i } as CSSProperties}
                    onClick={() => pickOne(l.code)}
                    aria-pressed={allPicked || picked.includes(l.code)}
                  >
                    {(allPicked || picked.includes(l.code)) && <Check size={13} />} {l.label}
                  </button>
                ))}
            </div>

            {error && <p className="notify-error">{error}</p>}

            <div className="notify-foot">
              <button
                className="notify-confirm"
                onClick={confirm}
                disabled={busy || picked.length === 0}
              >
                {busy
                  ? 'Setting it up…'
                  : picked.length === 0
                    ? 'Pick a language to start'
                    : allPicked
                      ? 'Keep me posted (all)'
                      : `Keep me posted (${picked.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
