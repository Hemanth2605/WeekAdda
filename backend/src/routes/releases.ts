import { Router, Request, Response } from 'express'
import { getReleaseData, syncReleases, isSyncing } from '../agent/releaseAgent'
import { queryReleases } from '../queries'

const router = Router()

router.get('/', (req: Request, res: Response) => {
  res.json(
    queryReleases(getReleaseData(), req.query, {
      syncing: isSyncing(),
      liveConfigured: Boolean(process.env.TMDB_API_KEY),
    })
  )
})

// Manually wake the agent (local/dev convenience; in production the daily
// GitHub Actions sweep is the only writer)
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
