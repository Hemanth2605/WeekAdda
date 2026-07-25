import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import {
  AddaInterest,
  AddaListing,
  BlogPost,
  Click,
  MemberActivity,
  PostRating,
  aggregateClicks,
  countMembers,
  isOwnerEmail,
  verifyGoogleToken,
} from '../queries'

/**
 * Outbound-click tracking: the audience-proof for future platform deals.
 * Locally clicks are appended to a JSONL file (one JSON object per line) so
 * writes are atomic and the history is never rewritten. In production the
 * Cloudflare Worker writes the same shape to the Supabase clicks table.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.jsonl')

const router = Router()

/** Read a JSON store, tolerating an absent or half-written file. */
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as T
  } catch {
    return fallback
  }
}

/**
 * Every signed-in action across the local stores, so the dashboard can count
 * members. There is no user table — an account exists because it did something.
 */
function memberActivity(clicks: Click[]): MemberActivity[] {
  const posts = readJson<BlogPost[]>('blog.json', [])
  const ratings = readJson<PostRating[]>('ratings.json', [])
  const adda = readJson<{ listings?: AddaListing[]; interests?: AddaInterest[] }>('adda.json', {})
  return [
    ...clicks.map((c) => ({ email: c.userEmail, ts: c.ts, source: 'click' as const })),
    ...posts.map((p) => ({ email: p.authorEmail, ts: p.ts, source: 'blog' as const })),
    ...ratings.map((r) => ({ email: r.userEmail, ts: r.ts, source: 'rating' as const })),
    ...(adda.listings ?? []).map((l) => ({ email: l.authorEmail, ts: l.ts, source: 'adda' as const })),
    ...(adda.interests ?? []).map((i) => ({ email: i.userEmail, ts: i.ts, source: 'adda' as const })),
  ]
}

router.post('/click', (req: Request, res: Response) => {
  const { kind, platform, titleId, title, language, visitorId } = req.body ?? {}
  if (kind !== 'watch' && kind !== 'book' && kind !== 'score' && kind !== 'share') {
    return res.status(400).json({ error: 'kind must be watch, book, score or share' })
  }
  if (!platform || !title) {
    return res.status(400).json({ error: 'platform and title are required' })
  }
  const authz = req.headers.authorization ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  res.status(204).end()
  // Identity is resolved after responding: signed-in clicks get the verified
  // account, everyone else keeps just the anonymous visitor id
  void (async () => {
    let userEmail = ''
    if (token && process.env.GOOGLE_CLIENT_ID) {
      const profile = await verifyGoogleToken(token, process.env.GOOGLE_CLIENT_ID)
      userEmail = profile?.email ?? ''
    }
    const click: Click = {
      ts: new Date().toISOString(),
      kind,
      platform: String(platform).slice(0, 60),
      titleId: String(titleId ?? '').slice(0, 120),
      title: String(title).slice(0, 200),
      language: String(language ?? '').slice(0, 40),
      ...(visitorId ? { visitorId: String(visitorId).slice(0, 64) } : {}),
      ...(userEmail ? { userEmail } : {}),
    }
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFile(CLICKS_FILE, JSON.stringify(click) + '\n', (err) => {
      if (err) console.warn('⚠️  Could not record click:', err.message)
    })
  })()
})

// Aggregated stats — private to the site owner (the hidden /stats dashboard).
// Owner is decided server-side from the Google-verified email, so the browser
// cannot claim it; with OWNER_EMAIL unset the dashboard is closed to everyone.
router.get('/stats', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const authz = req.headers.authorization ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  if (!clientId || !token) {
    return res.status(401).json({ error: 'Sign in with the owner account to view stats' })
  }
  const me = await verifyGoogleToken(token, clientId)
  // Distinguish the three failures — conflating them makes a config mistake
  // look identical to "wrong account", which is impossible to debug
  if (!me) {
    return res.status(401).json({ error: 'Your sign-in expired — please sign in again' })
  }
  if (!process.env.OWNER_EMAIL) {
    console.warn('⚠️  /api/track/stats: OWNER_EMAIL is not set — stats are closed to everyone')
    return res
      .status(403)
      .json({ error: 'Stats are not configured: OWNER_EMAIL is unset on the server' })
  }
  if (!isOwnerEmail(me.email, process.env.OWNER_EMAIL)) {
    return res.status(403).json({ error: 'This page is not available for your account' })
  }

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
  res.json({ ...aggregateClicks(clicks), ...countMembers(memberActivity(clicks)) })
})

export default router
