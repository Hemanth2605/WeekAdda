import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import releaseRoutes from './routes/releases'
import cricketRoutes from './routes/cricket'
import trackRoutes from './routes/track'
import { syncReleases, syncIfStale } from './agent/releaseAgent'
import { syncCricket, syncCricketIfStale } from './agent/cricketAgent'

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'CinePitch API' }))
app.use('/api/releases', releaseRoutes)
app.use('/api/cricket', cricketRoutes)
app.use('/api/track', trackRoutes)

// The daily agents: every morning at 06:00 — movies then cricket.
cron.schedule('0 6 * * *', () => {
  syncReleases().catch((err) => console.warn('⚠️  Scheduled sync failed:', err.message))
  syncCricket().catch((err) => console.warn('⚠️  Scheduled cricket sync failed:', err.message))
})

app.listen(PORT, () => {
  console.log(`🎬 CinePitch API running at http://localhost:${PORT}`)
  syncIfStale()
  syncCricketIfStale()
})
