import { Router, Request, Response } from 'express'
import { getCricketData, syncCricket, isCricketSyncing } from '../agent/cricketAgent'
import { queryCricket } from '../queries'

const router = Router()

router.get('/', (req: Request, res: Response) => {
  res.json(queryCricket(getCricketData(), req.query, { syncing: isCricketSyncing() }))
})

// Manually wake the agent (local/dev convenience; in production the daily
// GitHub Actions sweep is the only writer)
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const data = await syncCricket()
    res.json({ ok: true, meta: { fetchedAt: data.fetchedAt, total: data.matches.length } })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' })
  }
})

export default router
