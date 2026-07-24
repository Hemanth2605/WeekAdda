import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import releaseRoutes from './routes/releases'
import cricketRoutes from './routes/cricket'
import trackRoutes from './routes/track'
import blogRoutes from './routes/blog'
import { syncReleases, syncIfStale, getReleaseData } from './agent/releaseAgent'
import { findTitle, relatedTitles } from './queries'
import { syncCricket, syncCricketIfStale } from './agent/cricketAgent'

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'WeekAdda API' }))
app.use('/api/releases', releaseRoutes)
app.get('/api/title/:id', (req, res) => {
  const data = getReleaseData()
  const found = findTitle(data, req.params.id)
  if (!found) return res.status(404).json({ error: 'Title not found' })
  res.json({ release: found.item, status: found.status, related: relatedTitles(data, found.item) })
})
app.use('/api/cricket', cricketRoutes)
app.use('/api/track', trackRoutes)
app.use('/api/blog', blogRoutes)

// The daily agents: every morning at 06:00 — movies then cricket.
cron.schedule('0 6 * * *', () => {
  syncReleases().catch((err) => console.warn('⚠️  Scheduled sync failed:', err.message))
  syncCricket().catch((err) => console.warn('⚠️  Scheduled cricket sync failed:', err.message))
})

app.listen(PORT, () => {
  console.log(`🎬 WeekAdda API running at http://localhost:${PORT}`)
  syncIfStale()
  syncCricketIfStale()
})
