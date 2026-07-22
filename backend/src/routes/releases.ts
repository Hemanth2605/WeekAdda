import { Router, Request, Response } from 'express'
import {
  getReleaseData,
  syncReleases,
  isSyncing,
  LANGUAGES,
  MAX_WEEKS,
} from '../agent/releaseAgent'

const router = Router()

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

router.get('/', (req: Request, res: Response) => {
  const { window, language, search } = req.query
  const data = getReleaseData()
  const today = new Date().toISOString().slice(0, 10)

  let releases = data.releases
  let weekInfo: { index: number; from: string; to: string; maxWeeks: number } | null = null

  if (window === 'upcoming') {
    if (req.query.source === 'ott') {
      const contentType = req.query.contentType
      releases = data.ottUpcoming.filter(
        (r) =>
          r.releaseDate > today &&
          (contentType === 'movie' || contentType === 'series' ? r.contentType === contentType : true)
      )
    } else {
      releases = releases.filter((r) => r.releaseDate > today)
    }
  } else if (window === 'ott') {
    // OTT arrivals in India are pre-bucketed by week during the agent sweep
    const rawWeek = Number(req.query.week)
    const week = Math.min(Math.max(Number.isFinite(rawWeek) ? Math.trunc(rawWeek) : 0, 0), MAX_WEEKS - 1)
    const to = isoDaysAgo(week * 7)
    const from = isoDaysAgo(week * 7 + 6)
    weekInfo = { index: week, from, to, maxWeeks: MAX_WEEKS }
    const contentType = req.query.contentType
    releases = data.ott.filter(
      (r) =>
        r.week === week &&
        (contentType === 'movie' || contentType === 'series' ? r.contentType === contentType : true)
    )
  } else {
    // Released view is week-paged: week 0 = last 7 days (today-6..today),
    // week 1 = the 7 days before that, … up to MAX_WEEKS (~3 months).
    const rawWeek = Number(req.query.week)
    const week = Math.min(Math.max(Number.isFinite(rawWeek) ? Math.trunc(rawWeek) : 0, 0), MAX_WEEKS - 1)
    const to = isoDaysAgo(week * 7)
    const from = isoDaysAgo(week * 7 + 6)
    weekInfo = { index: week, from, to, maxWeeks: MAX_WEEKS }
    releases = releases.filter((r) => r.releaseDate >= from && r.releaseDate <= to)
  }

  if (typeof language === 'string' && language && language !== 'all') {
    releases = releases.filter((r) => r.language === language)
  }
  if (typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase()
    releases = releases.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.originalTitle.toLowerCase().includes(q) ||
        r.overview.toLowerCase().includes(q) ||
        r.languageLabel.toLowerCase().includes(q)
    )
  }

  // Telugu first everywhere; then released: newest first, upcoming: soonest
  // first, OTT: most popular first.
  const sorted = [...releases].sort((a, b) => {
    const telugu = Number(b.language === 'te') - Number(a.language === 'te')
    if (telugu !== 0) return telugu
    if (window === 'upcoming') return a.releaseDate.localeCompare(b.releaseDate)
    if (window === 'ott') return b.votes - a.votes
    return b.releaseDate.localeCompare(a.releaseDate)
  })

  res.json({
    releases: sorted,
    week: weekInfo,
    meta: {
      fetchedAt: data.fetchedAt,
      source: data.source,
      total: data.releases.length,
      ottTotal: data.ott.length,
      syncing: isSyncing(),
      liveConfigured: Boolean(process.env.TMDB_API_KEY),
    },
    languages: LANGUAGES,
  })
})

// Manually wake the agent
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const data = await syncReleases()
    res.json({
      ok: true,
      meta: { fetchedAt: data.fetchedAt, source: data.source, total: data.releases.length },
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' })
  }
})

export default router
