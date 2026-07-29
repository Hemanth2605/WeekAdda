import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

/**
 * A floating back-to-top arrow that fades in once the reader has scrolled a
 * screen's worth down. Sits just above the mini-player button so the two
 * stack as one control column at the bottom-right.
 */
export default function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setShow(window.scrollY > 600)
        ticking = false
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      className={`back-top${show ? ' show' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
    >
      <ArrowUp size={18} />
    </button>
  )
}
