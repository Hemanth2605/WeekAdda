import { Release, CricketMatch } from './types'
import { trackClick } from './api'

/** CSS class carrying a platform's brand colour, e.g. 'pf-netflix'. */
export function platformClass(platform: string) {
  return 'pf-' + platform.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function openWhatsApp(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
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
  openWhatsApp(
    `🎬 *${r.title}* (${r.languageLabel}) — ${status}\n\nThis week's movies, OTT & cricket on WeekAdda:\n${siteUrl('/movies')}`
  )
  trackClick({
    kind: 'share',
    platform: 'WhatsApp',
    titleId: r.id,
    title: r.title,
    language: r.languageLabel,
  })
}

export function shareMatch(m: CricketMatch, resultLine: string) {
  const scoreline = m.teams
    .map((t) => `${t.name}${t.score ? ` ${t.score}` : ''}`)
    .join(' vs ')
  openWhatsApp(
    `🏏 *${m.series}*\n${scoreline}\n${resultLine}\n\nCricket results week by week on WeekAdda:\n${siteUrl('/cricket')}`
  )
  trackClick({
    kind: 'share',
    platform: 'WhatsApp',
    titleId: m.id,
    title: m.name,
    language: m.series,
  })
}
