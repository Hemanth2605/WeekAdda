import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { cardDismissed, dismissCard, openNotify } from '../notify'
import { currentSubscription, pushSupported } from '../push'

/**
 * The ask that actually converts: dropped into the feed right after the reader
 * has scrolled a language they care about, naming that language back to them.
 *
 * Shown once. Dismissing it is permanent — a second ask is how a site gets its
 * notifications blocked at browser level, which cannot be undone from here. The
 * navbar bell remains for anyone who changes their mind.
 */
export default function NotifyCard({ language, label }: { language: string; label: string }) {
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (!pushSupported || cardDismissed()) return
    // Never ask someone who has already said yes
    currentSubscription().then((sub) => setHidden(Boolean(sub)))
  }, [])

  if (hidden || !pushSupported || cardDismissed()) return null

  return (
    <section className="notify-card-inline">
      <span className="notify-card-icon">
        <Bell size={17} />
      </span>
      <div className="notify-card-text">
        <strong>Never miss a {label} release</strong>
        <span>
          We’ll ping you the day it lands — and stay quiet the rest of the time. No account, no
          email.
        </span>
      </div>
      <button className="notify-card-cta" onClick={() => openNotify([language])}>
        Keep me posted
      </button>
      <button
        className="notify-card-dismiss"
        onClick={() => {
          dismissCard()
          setHidden(true)
        }}
        aria-label="No thanks"
      >
        <X size={15} />
      </button>
    </section>
  )
}
