import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Land on one card of a list page rather than the top of it.
 *
 * The mini player's slides carry the id of the thing they are showing, so a
 * click opens `/cricket/results?match=<id>` or `/adda?post=<id>`; this scrolls
 * that card into view and flashes a ring round it so the eye finds it. Pages
 * whose items have their own page or modal (films, reviews) don't need this —
 * they navigate or open instead.
 *
 * `ready` guards the fetch: a cold link arrives before the list does, and the
 * effect re-runs when it lands. An id that isn't on the page (a match from
 * another week, a listing since closed) is left alone — the reader still gets
 * the right page, just no highlight.
 *
 * @param param    query key to read, e.g. 'match'
 * @param idPrefix DOM id namespace, so the card is `<idPrefix>-<id>`
 * @param ready    true once the list this id should be in has loaded
 */
export function useFocusTarget(param: string, idPrefix: string, ready: boolean) {
  const [params, setParams] = useSearchParams()
  const wanted = params.get(param)

  useEffect(() => {
    if (!wanted || !ready) return
    const el = document.getElementById(`${idPrefix}-${wanted}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // The class carries the whole flash; it takes itself off at the end, so
    // nothing has to be timed or cleaned up
    el.classList.add('pip-focus')
    el.addEventListener('animationend', () => el.classList.remove('pip-focus'), { once: true })
    // Drop the key once used: a refresh or a Back is then a plain page load
    const next = new URLSearchParams(params)
    next.delete(param)
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ready])
}
