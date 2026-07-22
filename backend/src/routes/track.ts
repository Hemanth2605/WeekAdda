import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { Click, aggregateClicks } from '../queries'

/**
 * Outbound-click tracking: the audience-proof for future platform deals.
 * Locally clicks are appended to a JSONL file (one JSON object per line) so
 * writes are atomic and the history is never rewritten. In production the
 * Cloudflare Worker writes the same shape to the Supabase clicks table.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.jsonl')

const router = Router()

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
router.get('/stats', (_req: Request, res: Response) => {
  const clicks: Click[] = []
  if (fs.existsSync(CLICKS_FILE)) {
    for (const line of fs.readFileSync(CLICKS_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        clicks.push(JSON.parse(line))
      } catch {
        // a corrupt line is skipped, never fatal
      }
    }
  }
  res.json(aggregateClicks(clicks))
})

export default router
