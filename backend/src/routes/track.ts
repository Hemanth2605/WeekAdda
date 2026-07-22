import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

/**
 * Outbound-click tracking: the audience-proof for future platform deals.
 * Clicks are appended to a JSONL file (one JSON object per line) so writes
 * are atomic and the history is never rewritten.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.jsonl')

const router = Router()

interface Click {
  ts: string
  kind: 'watch' | 'book' | 'score'
  platform: string
  titleId: string
  title: string
  language: string
}

router.post('/click', (req: Request, res: Response) => {
  const { kind, platform, titleId, title, language } = req.body ?? {}
  if (kind !== 'watch' && kind !== 'book' && kind !== 'score') {
    return res.status(400).json({ error: 'kind must be watch, book or score' })
  }
  if (!platform || !title) {
    return res.status(400).json({ error: 'platform and title are required' })
  }
  const click: Click = {
    ts: new Date().toISOString(),
    kind,
    platform: String(platform).slice(0, 60),
    titleId: String(titleId ?? '').slice(0, 120),
    title: String(title).slice(0, 200),
    language: String(language ?? '').slice(0, 40),
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.appendFile(CLICKS_FILE, JSON.stringify(click) + '\n', (err) => {
    if (err) console.warn('⚠️  Could not record click:', err.message)
  })
  res.status(204).end()
})

// Aggregated stats — the numbers you show a platform team.
router.get('/stats', async (_req: Request, res: Response) => {
  const stats = {
    totalClicks: 0,
    byKind: {} as Record<string, number>,
    byPlatform: {} as Record<string, number>,
    byLanguage: {} as Record<string, number>,
    byDay: {} as Record<string, number>,
    topTitles: [] as Array<{ title: string; clicks: number }>,
    since: null as string | null,
  }
  if (!fs.existsSync(CLICKS_FILE)) return res.json(stats)

  const titleCounts = new Map<string, number>()
  const rl = readline.createInterface({
    input: fs.createReadStream(CLICKS_FILE, 'utf-8'),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    let c: Click
    try {
      c = JSON.parse(line)
    } catch {
      continue
    }
    stats.totalClicks++
    if (!stats.since) stats.since = c.ts
    stats.byKind[c.kind] = (stats.byKind[c.kind] ?? 0) + 1
    stats.byPlatform[c.platform] = (stats.byPlatform[c.platform] ?? 0) + 1
    if (c.language) stats.byLanguage[c.language] = (stats.byLanguage[c.language] ?? 0) + 1
    const day = c.ts.slice(0, 10)
    stats.byDay[day] = (stats.byDay[day] ?? 0) + 1
    titleCounts.set(c.title, (titleCounts.get(c.title) ?? 0) + 1)
  }
  stats.topTitles = [...titleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([title, clicks]) => ({ title, clicks }))

  res.json(stats)
})

export default router
