import { useEffect, useState } from 'react'
import { Bell, BellRing, Share, X } from 'lucide-react'
import { NOTIFY_CHANGED, notifyChanged, openNotify } from '../notify'
import { currentSubscription, pushNeedsHomeScreen, pushSupported, unsubscribe } from '../push'

/**
 * The permanent way in, beside the theme toggle. Low intent by nature — nobody
 * comes to a site looking for a bell — but it has to exist, because the in-feed
 * card can be dismissed and a subscriber needs somewhere to turn this off
 * without hunting through browser settings.
 */
export default function NotifyBell() {
  const [on, setOn] = useState(false)
  /** The Home Screen explainer, for the Apple-in-a-tab case below. */
  const [howTo, setHowTo] = useState(false)

  useEffect(() => {
    const sync = () => currentSubscription().then((sub) => setOn(Boolean(sub)))
    sync()
    // Subscribing happens in the sheet, which cannot reach this state directly
    window.addEventListener(NOTIFY_CHANGED, sync)
    return () => window.removeEventListener(NOTIFY_CHANGED, sync)
  }, [])

  /*
   * An iPhone or iPad in a Safari tab is the one audience that has no bell and
   * could have one: Apple withholds PushManager until the site is on the Home
   * Screen. Left as a blank space they get no hint that the feature exists at
   * all, let alone that it is two taps away — so the bell stands where it would
   * have been and explains itself when asked.
   *
   * It cannot do the installing: there is no API for Add to Home Screen, by
   * design. So the honest thing is to name the two taps and get out of the way.
   */
  if (!pushSupported) {
    if (!pushNeedsHomeScreen) return null
    return (
      <>
        <button
          className="notify-bell"
          onClick={() => setHowTo(true)}
          title="Get release alerts on this iPad"
          aria-label="How to get release notifications on this device"
        >
          <Bell size={17} />
        </button>
        {howTo && (
          <div className="ios-push-hint" role="dialog" aria-label="Turn on release alerts">
            <div className="ios-push-card">
              <button
                className="share-close"
                onClick={() => setHowTo(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
              <strong>Release alerts on this device</strong>
              <p>
                Safari only delivers notifications to sites kept on the Home Screen — so add
                WeekAdda there once, and the bell will be waiting inside it.
              </p>
              <ol className="ios-push-steps">
                <li>
                  Tap <Share size={13} /> Share, at the top of Safari
                </li>
                <li>
                  Choose <b>Add to Home Screen</b>
                </li>
                <li>Open WeekAdda from that icon, then tap the bell</li>
              </ol>
              <button className="share-wa sm" onClick={() => setHowTo(false)}>
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  async function click() {
    if (!on) return openNotify()
    await unsubscribe()
    setOn(false)
    notifyChanged()
  }

  return (
    <button
      className={on ? 'notify-bell on' : 'notify-bell'}
      onClick={click}
      title={on ? 'Notifications on — click to turn off' : 'Get notified about new releases'}
      aria-label={on ? 'Turn off release notifications' : 'Get notified about new releases'}
    >
      {on ? <BellRing size={17} /> : <Bell size={17} />}
    </button>
  )
}
