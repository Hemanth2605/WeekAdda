import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import releaseRoutes from './routes/releases'
import cricketRoutes from './routes/cricket'
import trackRoutes from './routes/track'
import blogRoutes from './routes/blog'
import addaRoutes from './routes/adda'
import pushRoutes from './routes/push'
import { syncReleases, syncIfStale, getReleaseData } from './agent/releaseAgent'
import { findTitle, relatedTitles, queryPlatform } from './queries'
import { syncCricket, syncCricketIfStale } from './agent/cricketAgent'

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'WeekAdda API' }))
// Local dev has no IP lookup (that's Cloudflare's request.cf in production) —
// answer with nothing so the default language order applies; ?force=IN-KA tests it
app.get('/api/geo', (req, res) => {
  const force = typeof req.query.force === 'string' ? req.query.force : ''
  res.set('Cache-Control', 'no-store')
  res.json({ country: force.split('-')[0] || null, region: force.split('-')[1] || null })
})
app.use('/api/releases', releaseRoutes)
app.get('/api/title/:id', (req, res) => {
  const data = getReleaseData()
  const found = findTitle(data, req.params.id)
  if (!found) return res.status(404).json({ error: 'Title not found' })
  res.json({ release: found.item, status: found.status, related: relatedTitles(data, found.item) })
})
// Platform hubs: /ott/<slug> in the app, this behind it. Mirrors the Worker.
app.get('/api/ott/:slug', (req, res) => {
  const data = getReleaseData()
  const hub = queryPlatform(data, req.params.slug)
  if (!hub) return res.status(404).json({ error: 'Unknown platform' })
  res.json({ ...hub, meta: { fetchedAt: data.fetchedAt, source: data.source } })
})
app.use('/api/cricket', cricketRoutes)
app.use('/api/track', trackRoutes)
app.use('/api/blog', blogRoutes)
app.use('/api/adda', addaRoutes)
app.use('/api/push', pushRoutes)

// The daily agents: every morning at 04:00 — movies then cricket. Matches the
// production sweep (.github/workflows/sweep.yml), which runs at 4 AM IST.
cron.schedule('0 4 * * *', () => {
  syncReleases().catch((err) => console.warn('⚠️  Scheduled sync failed:', err.message))
  syncCricket().catch((err) => console.warn('⚠️  Scheduled cricket sync failed:', err.message))
})

app.listen(PORT, () => {
  console.log(`🎬 WeekAdda API running at http://localhost:${PORT}`)
  // .env is read once at boot and tsx watch doesn't restart on .env edits —
  // say out loud whether /stats can let anyone in, so a missing OWNER_EMAIL
  // isn't mistaken for "wrong account" at the browser
  console.log(
    process.env.OWNER_EMAIL
      ? `🔒 Private /stats open to: ${process.env.OWNER_EMAIL}`
      : '🔒 Private /stats is closed — set OWNER_EMAIL in backend/.env, then restart'
  )
  syncIfStale()
  syncCricketIfStale()
})
