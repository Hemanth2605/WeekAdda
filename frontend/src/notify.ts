/**
 * Opening the notification sheet, from anywhere.
 *
 * Same shape as SHARE_EVENT in share.ts: the sheet is mounted once in App and
 * listens, so the navbar bell and the in-feed card can both raise it without
 * either owning it.
 */

export const NOTIFY_EVENT = 'weekadda:notify'

export interface NotifyPayload {
  /** Pre-ticked languages — whatever the reader was already looking at. */
  languages: string[]
}

export function openNotify(languages: string[] = []) {
  window.dispatchEvent(new CustomEvent<NotifyPayload>(NOTIFY_EVENT, { detail: { languages } }))
}

/**
 * Raised whenever this browser's subscription starts or stops existing.
 *
 * The bell lives in the navbar, which is mounted once outside the routes and so
 * never remounts — without this it would keep showing the unsubscribed icon,
 * still swinging for attention, until a full page reload.
 */
export const NOTIFY_CHANGED = 'weekadda:notify-changed'

export function notifyChanged() {
  window.dispatchEvent(new Event(NOTIFY_CHANGED))
}

const DISMISSED_KEY = 'weekadda-notify-dismissed'

/** A card dismissed once stays dismissed — asking twice is how you get blocked. */
export function cardDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissCard() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // private mode: it reappears next visit, which is acceptable
  }
}

// ---------------- the landing ask ----------------

const ASK_KEY = 'weekadda-notify-ask'
const ASK_AGAIN_AFTER = 7 * 24 * 60 * 60 * 1000 // a week

/**
 * "Not now" is not "never". It parks the ask for a week and then lets us try
 * once more — which is only possible because the landing prompt is our own UI.
 * Firing the browser's permission dialog on load would turn one reflexive "no"
 * into a permanent block that no amount of waiting can undo, and that is why
 * `subscribe()` is still only ever reached from a click.
 */
export function askSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(ASK_KEY)
    if (!raw) return false
    const at = Number(raw)
    // Unparseable value: stay quiet rather than ask forever. The next decline
    // writes a good timestamp and the week starts from there.
    if (!Number.isFinite(at)) return true
    return Date.now() - at < ASK_AGAIN_AFTER
  } catch {
    return false
  }
}

export function snoozeAsk() {
  try {
    localStorage.setItem(ASK_KEY, String(Date.now()))
  } catch {
    // private mode: the ask returns next visit, which is the honest fallback
  }
}

/**
 * Raised as the landing prompt opens and closes. Two asks for the same thing on
 * one screen is worse than none, so the in-feed card stands down while the
 * prompt is up.
 */
export const NOTIFY_PROMPT = 'weekadda:notify-prompt'

let promptOpen = false

export function isPromptOpen() {
  return promptOpen
}

export function setPromptOpen(open: boolean) {
  promptOpen = open
  window.dispatchEvent(new Event(NOTIFY_PROMPT))
}
