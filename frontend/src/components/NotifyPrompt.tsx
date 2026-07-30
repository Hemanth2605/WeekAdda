import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { askSnoozed, snoozeAsk, openNotify, setPromptOpen, NOTIFY_CHANGED } from '../notify'
import { currentSubscription, pushSupported } from '../push'

/** Long enough for the page to paint and the visitor to see what this is. */
const APPEAR_AFTER_MS = 3500

/**
 * The landing ask — one card, bottom of the screen, on the first visit.
 *
 * It is our own UI, not the browser's permission dialog, and that is the whole
 * design. The native prompt on page load is answered "no" reflexively, and that
 * no is *permanent*: the browser will never show it again, and JS can never
 * re-ask. A soft prompt costs nothing when declined, which is what lets "not
 * now" mean a week rather than forever. Tapping "Yes, notify me" opens the
 * language sheet, and the real permission call happens from a click in there —
 * see the note on `subscribe()` in push.ts.
 *
 * Never shown when: push is unsupported (which includes iPhone Safari outside
 * a Home Screen install), permission is already granted or already blocked at
 * browser level, this browser is subscribed, or the ask was parked inside the
 * last seven days.
 */
export default function NotifyPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!pushSupported) return
    // 'granted' and 'denied' are both settled answers — the first needs no ask,
    // and the second is not ours to re-open from here
    if (Notification.permission !== 'default') return
    if (askSnoozed()) return

    let timer: number | undefined
    currentSubscription().then((sub) => {
      if (sub) return
      timer = window.setTimeout(() => {
        setShow(true)
        setPromptOpen(true)
      }, APPEAR_AFTER_MS)
    })

    // Subscribing from the navbar bell while this is pending retires it
    const onChange = () =>
      currentSubscription().then((sub) => {
        if (!sub) return
        if (timer !== undefined) window.clearTimeout(timer)
        setShow(false)
        setPromptOpen(false)
      })
    window.addEventListener(NOTIFY_CHANGED, onChange)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener(NOTIFY_CHANGED, onChange)
      setPromptOpen(false)
    }
  }, [])

  if (!show) return null

  const close = () => {
    snoozeAsk()
    setShow(false)
    setPromptOpen(false)
  }

  const accept = () => {
    setShow(false)
    setPromptOpen(false)
    // Park it too: if they back out of the sheet without finishing, we are not
    // asking again tomorrow
    snoozeAsk()
    // Pre-tick whatever language they filter by, so the sheet opens on the
    // answer they would have given anyway
    let language = ''
    try {
      language = localStorage.getItem('weekadda-language') ?? ''
    } catch {
      language = ''
    }
    openNotify(language && language !== 'all' && language !== 'pan' ? [language] : [])
  }

  return (
    <section className="notify-prompt" role="dialog" aria-label="Get release notifications">
      <span className="notify-prompt-icon">
        <Bell size={18} />
      </span>
      <div className="notify-prompt-text">
        <strong>Know the day it drops</strong>
        <span>
          One ping when a release lands in your language — and silence the rest of the week. No
          account, no email.
        </span>
      </div>
      <div className="notify-prompt-actions">
        <button className="notify-prompt-no" onClick={close}>
          Not now
        </button>
        <button className="notify-prompt-yes" onClick={accept}>
          Yes, notify me
        </button>
      </div>
      <button className="notify-prompt-close" onClick={close} aria-label="Not now">
        <X size={15} />
      </button>
    </section>
  )
}
