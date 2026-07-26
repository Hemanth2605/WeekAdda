import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { PushSubscriptionRecord, buildPushSubscription } from '../queries'

/**
 * Release-notification signups, local-dev twin of the Worker's /api/push/*.
 * Production stores these in Supabase; locally they go to a JSON file like
 * every other visitor-authored thing. Nothing here sends anything — that is
 * the sweep's job, see PUSH-PLAN.md.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const FILE = path.join(DATA_DIR, 'push.json')

const router = Router()

function read(): PushSubscriptionRecord[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as PushSubscriptionRecord[]
  } catch {
    return []
  }
}

function write(subs: PushSubscriptionRecord[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(subs, null, 2))
}

router.post('/subscribe', (req: Request, res: Response) => {
  const sub = buildPushSubscription(req.body)
  if (!sub) return res.status(400).json({ error: 'Pick at least one language to hear about' })
  // The endpoint is this browser's identity, so re-subscribing or changing
  // languages replaces the row rather than adding a second one
  const subs = read().filter((s) => s.endpoint !== sub.endpoint)
  subs.push(sub)
  write(subs)
  res.status(201).json({ ok: true, languages: sub.languages })
})

router.post('/unsubscribe', (req: Request, res: Response) => {
  const endpoint = String((req.body ?? {}).endpoint ?? '')
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' })
  write(read().filter((s) => s.endpoint !== endpoint))
  res.json({ ok: true })
})

export default router
