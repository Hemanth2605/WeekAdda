import { useEffect, useSyncExternalStore } from 'react'
import { fetchSavedArticles, saveArticle } from './api'
import { refreshUser, useGoogleUser } from './auth'

/**
 * Articles put aside to read later.
 *
 * **On the account, not the browser** (owner, Aug 2026). A read-later list that
 * lived in localStorage worked without a sign-in, which was its appeal, but it
 * stayed on the device it was made on — you save something on your phone and
 * your laptop has never heard of it. For a list whose entire purpose is "later,
 * when I have time", later is usually somewhere else.
 *
 * So saving needs a signed-in account, like rating and publishing already do.
 * Reading everything is still account-free; this is one more thing you can
 * choose to have, not a wall in front of the articles.
 *
 * Only ids are stored, here and on the server. The articles themselves come
 * from the ordinary listing — a saved *copy* would go stale the moment its
 * author fixed a typo, and would have to be kept in step forever.
 *
 * Every screen talks to this module and nothing else, which is what made
 * swapping the storage underneath them a change to one file.
 */

let ids: string[] = []
/** Which account's list is in `ids` — null signed out, undefined never asked. */
let loadedFor: string | null | undefined
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((notify) => notify())
}

/** Replaced wholesale rather than mutated — the array identity is the signal. */
function set(next: string[]) {
  ids = next
  emit()
}

/** Pull the account's list. Signed out, the answer is simply nothing. */
export async function loadSaved(): Promise<void> {
  const token = refreshUser()?.token
  if (!token) return set([])
  try {
    const res = await fetchSavedArticles(token)
    set(res.ids ?? [])
  } catch {
    // Let the next attempt try again rather than leaving this account marked as
    // loaded on the strength of a failed request
    loadedFor = undefined
  }
}

export function isSaved(id: string): boolean {
  return ids.includes(id)
}

/**
 * Save or unsave, and report which it became.
 *
 * Moved locally first so the button answers the tap immediately, then put back
 * if the server disagrees. A bookmark that waits on a round trip feels broken
 * on a slow connection, and the cost of being briefly wrong is nil.
 */
export async function toggleSaved(id: string): Promise<boolean> {
  const token = refreshUser()?.token
  if (!token) throw new Error('sign-in required')

  const was = ids.includes(id)
  set(was ? ids.filter((x) => x !== id) : [id, ...ids])
  try {
    const res = await saveArticle(id, token)
    // Trust the server's answer over ours, in case the two had drifted
    set(res.saved ? [id, ...ids.filter((x) => x !== id)] : ids.filter((x) => x !== id))
    return res.saved
  } catch (err) {
    set(was ? [id, ...ids.filter((x) => x !== id)] : ids.filter((x) => x !== id))
    throw err
  }
}

/**
 * The saved ids, live.
 *
 * `useSyncExternalStore` rather than an effect and a state, so every button on
 * the page agrees the instant one of them is pressed — a card in a list and the
 * article's own page can both be mounted, and one saying "Saved" while the
 * other still says "Save" is the kind of small wrongness nobody reports and
 * everybody notices.
 */
export function useSavedArticles(): string[] {
  const user = useGoogleUser()
  const list = useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => ids
  )

  /*
   * Fetched once per account, not once per component.
   *
   * Several of these can be mounted at the same time — a page full of cards,
   * each with its own button — and without the guard every one of them would
   * ask the server the same question on mount. Keyed on the email rather than a
   * boolean, so signing out empties the list and signing in as someone else
   * fetches theirs instead of showing the last account's.
   */
  useEffect(() => {
    const email = user?.email ?? null
    if (loadedFor === email) return
    loadedFor = email
    void loadSaved()
  }, [user?.email])

  return list
}
