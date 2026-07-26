import { useEffect, useState } from 'react'
import { Bell, BellRing } from 'lucide-react'
import { openNotify } from '../notify'
import { currentSubscription, pushSupported, unsubscribe } from '../push'

/**
 * The permanent way in, beside the theme toggle. Low intent by nature — nobody
 * comes to a site looking for a bell — but it has to exist, because the in-feed
 * card can be dismissed and a subscriber needs somewhere to turn this off
 * without hunting through browser settings.
 */
export default function NotifyBell() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    currentSubscription().then((sub) => setOn(Boolean(sub)))
  }, [])

  if (!pushSupported) return null

  async function click() {
    if (!on) return openNotify()
    await unsubscribe()
    setOn(false)
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
