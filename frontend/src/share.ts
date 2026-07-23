import { Release, CricketMatch } from './types'
import { trackClick } from './api'

/** CSS class carrying a platform's brand colour, e.g. 'pf-netflix'. */
export function platformClass(platform: string) {
  return 'pf-' + platform.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface SharePayload {
  body: string
  url: string
  titleId: string
  title: string
  language: string
}

export const SHARE_EVENT = 'weekadda:share'

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/**
 * Phones get the OS share sheet (WhatsApp, Telegram, Instagram — whatever is
 * installed); elsewhere the in-app ShareSheet chooser opens via SHARE_EVENT.
 */
function share(payload: SharePayload) {
  if (isMobile() && typeof navigator.share === 'function') {
    navigator
      .share({ text: payload.body, url: payload.url })
      .then(() =>
        trackClick({
          kind: 'share',
          platform: 'Native',
          titleId: payload.titleId,
          title: payload.title,
          language: payload.language,
        })
      )
      .catch(() => {})
    return
  }
  window.dispatchEvent(new CustomEvent<SharePayload>(SHARE_EVENT, { detail: payload }))
}

function siteUrl(path: string) {
  return `${window.location.origin}${path}`
}

export function shareRelease(r: Release) {
  const days = Math.round(
    (new Date(r.releaseDate + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000
  )
  const date = new Date(r.releaseDate + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
  const status = r.platforms?.length
    ? days > 0
      ? `coming to ${r.platforms[0]} on ${date}`
      : `streaming now on ${r.platforms.join(', ')}`
    : days > 0
      ? `in theatres from ${date}`
      : 'in theatres now'
  share({
    body: `🎬 *${r.title}* (${r.languageLabel}) — ${status}\n\nThis week's movies, OTT & cricket on WeekAdda:`,
    url: siteUrl('/movies'),
    titleId: r.id,
    title: r.title,
    language: r.languageLabel,
  })
}

export function shareMatch(m: CricketMatch, resultLine: string) {
  const scoreline = m.teams
    .map((t) => `${t.name}${t.score ? ` ${t.score}` : ''}`)
    .join(' vs ')
  share({
    body: `🏏 *${m.series}*\n${scoreline}\n${resultLine}\n\nCricket results week by week on WeekAdda:`,
    url: siteUrl('/cricket'),
    titleId: m.id,
    title: m.name,
    language: m.series,
  })
}
