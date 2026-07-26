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
