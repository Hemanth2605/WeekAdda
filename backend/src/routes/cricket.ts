import { Router, Request, Response } from 'express'
import {
  getCricketData,
  syncCricket,
  isCricketSyncing,
  CRICKET_MAX_WEEKS,
} from '../agent/cricketAgent'

const router = Router()

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

// "India", "India Women", "India Under-19s", "India A" — but not "West Indies"
function involvesIndia(m: { teams: Array<{ name: string }> }) {
  return m.teams.some((t) => t.name.toLowerCase().startsWith('india'))
}

router.get('/', (req: Request, res: Response) => {
  const { window, search, type } = req.query
  const data = getCricketData()
  const today = new Date().toISOString().slice(0, 10)

  let matches = data.matches

  // Default view is international cricket; leagues/domestic on request
  if (type === 'league') matches = matches.filter((m) => !m.international)
  else if (type !== 'all') matches = matches.filter((m) => m.international)
  let weekInfo: { index: number; from: string; to: string; maxWeeks: number } | null = null

  if (window === 'upcoming') {
    matches = matches
      .filter((m) => m.state === 'pre' && m.date.slice(0, 10) >= today)
      .sort(
        (a, b) =>
          Number(involvesIndia(b)) - Number(involvesIndia(a)) || a.date.localeCompare(b.date)
      )
  } else {
    // Recent matches, week-paged exactly like movie releases
    const rawWeek = Number(req.query.week)
    const week = Math.min(
      Math.max(Number.isFinite(rawWeek) ? Math.trunc(rawWeek) : 0, 0),
      CRICKET_MAX_WEEKS - 1
    )
    const to = isoDaysAgo(week * 7)
    const from = isoDaysAgo(week * 7 + 6)
    weekInfo = { index: week, from, to, maxWeeks: CRICKET_MAX_WEEKS }
    matches = matches
      .filter((m) => {
        const day = m.date.slice(0, 10)
        return day >= from && day <= to && m.state === 'post'
      })
      .sort(
        (a, b) =>
          Number(involvesIndia(b)) - Number(involvesIndia(a)) || b.date.localeCompare(a.date)
      )
  }

  if (typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase()
    matches = matches.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.series.toLowerCase().includes(q) ||
        m.venue.toLowerCase().includes(q) ||
        m.teams.some((t) => t.name.toLowerCase().includes(q))
    )
  }

  res.json({
    matches,
    week: weekInfo,
    meta: {
      fetchedAt: data.fetchedAt,
      source: data.source,
      total: data.matches.length,
      syncing: isCricketSyncing(),
    },
  })
})

router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const data = await syncCricket()
    res.json({ ok: true, meta: { fetchedAt: data.fetchedAt, total: data.matches.length } })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' })
  }
})

export default router
