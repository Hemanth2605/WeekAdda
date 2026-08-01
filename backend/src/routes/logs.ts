import express, { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import {
  WatchLog,
  applyWatchLogEdit,
  buildWatchLog,
  imageExtension,
  verifyGoogleToken,
} from '../queries'

/**
 * The private watch log: what someone watched, where, and when.
 *
 * Every route here requires a verified Google account, including the read —
 * this is the only store on the site with no public endpoint at all. There is
 * deliberately no "all logs" route, not even an owner one: nothing should be
 * able to ask for somebody else's, so the question is never askable.
 *
 * Locally a JSON file; production uses the Supabase `watch_logs` table via the
 * Worker, which enforces the same rule.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const LOGS_FILE = path.join(DATA_DIR, 'logs.json')
// Deliberately not under any static-file root: these are private, and the only
// way out of here is the owner-checked route below
const UPLOAD_DIR = path.join(DATA_DIR, 'log-uploads')

/** Mirrors accountFolder in worker.ts — the same account must map the same. */
function accountFolder(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) {
    h = (Math.imul(31, h) + email.charCodeAt(i)) | 0
  }
  return `u${(h >>> 0).toString(36)}`
}
const MAX_LOGS = 5000

function load(): WatchLog[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(logs: WatchLog[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(0, MAX_LOGS), null, 2))
}

/** The signed-in email, or null. Every route below starts here. */
async function requireUser(req: Request): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return null
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const user = await verifyGoogleToken(token, clientId)
  return user?.email ?? null
}

const router = Router()

/**
 * Nothing here may be kept by anything in front of us — no proxy, no CDN, no
 * shared browser cache. Every response below belongs to exactly one account,
 * so it must not be storable the way a public feed's response is. The Worker
 * says the same thing with `privateJson`.
 */
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})

/** Only ever your own — newest watch first, not newest entry. */
router.get('/', async (req: Request, res: Response) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in to see your log' })
  const mine = load()
    .filter((l) => l.userEmail === email)
    .sort((a, b) => (a.watchedOn < b.watchedOn ? 1 : a.watchedOn > b.watchedOn ? -1 : a.ts < b.ts ? 1 : -1))
  // The email is stripped even here: the client already knows whose log it is,
  // and a field that never travels cannot be logged, cached or leaked
  res.json({ logs: mine.map(({ userEmail, ...rest }) => rest) })
})

router.post('/', async (req: Request, res: Response) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in to add to your log' })
  const entry = buildWatchLog(req.body, email)
  if (!entry) return res.status(400).json({ error: 'Name the film you watched' })
  const logs = load()
  logs.unshift(entry)
  save(logs)
  const { userEmail, ...pub } = entry
  res.status(201).json(pub)
})

/**
 * A log photo. Locally these land in `cache/log-uploads/`, which is not served
 * as static files — the read below hands the bytes back only to the account
 * that owns the folder, mirroring the signed URLs production uses.
 */
router.post('/image', express.raw({ type: 'image/*', limit: '4mb' }), async (req, res) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in to add a photo' })
  const ext = imageExtension(req.headers['content-type'])
  if (!ext) return res.status(415).json({ error: 'Use a JPEG, PNG, WebP, GIF or AVIF' })
  const folder = accountFolder(email)
  const dir = path.join(UPLOAD_DIR, folder)
  fs.mkdirSync(dir, { recursive: true })
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  fs.writeFileSync(path.join(dir, name), req.body as Buffer)
  res.status(201).json({ path: `${folder}/${name}` })
})

/**
 * The file behind a stored path, gone. Best-effort: the entry that owned it is
 * already deleted, and a missing file is the outcome we wanted anyway.
 * `path.resolve` + the prefix check keep a stored value that somehow contains
 * `..` from reaching outside the upload directory.
 */
function dropImage(stored: string) {
  try {
    const file = path.resolve(UPLOAD_DIR, stored)
    if (!file.startsWith(path.resolve(UPLOAD_DIR))) return
    fs.rmSync(file, { force: true })
  } catch {
    // nothing worth failing a delete over
  }
}

/**
 * Local stand-in for Supabase's signed URLs.
 *
 * The URL has to work in an `<img src>`, and an `<img>` cannot send an
 * `Authorization` header — so the proof of ownership has to travel in the URL
 * itself. A one-off grant does that: minted here for the owner, held in memory,
 * good for an hour, and useless to anyone who did not just prove who they are.
 * Production does the same thing with a real signature; only the mechanism
 * differs, which is why the client cannot tell them apart.
 */
const grants = new Map<string, { file: string; expires: number }>()

router.post('/image/sign', async (req: Request, res: Response) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in first' })
  const p = String((req.body ?? {}).path ?? '')
  // The one check that matters, and it uses the folder derived from the token
  if (!p.startsWith(`${accountFolder(email)}/`)) return res.status(404).json({ error: 'Not found' })
  const file = path.join(UPLOAD_DIR, p)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  const grant = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  grants.set(grant, { file, expires: Date.now() + 3600_000 })
  res.json({ url: `/api/logs/image?g=${grant}` })
})

/** The bytes, to whoever holds an unexpired grant — nobody else can mint one. */
router.get('/image', (req: Request, res: Response) => {
  const grant = grants.get(String(req.query.g ?? ''))
  if (!grant) return res.status(404).json({ error: 'Not found' })
  if (grant.expires < Date.now()) {
    grants.delete(String(req.query.g))
    return res.status(404).json({ error: 'Not found' })
  }
  res.sendFile(grant.file)
})

/** Edit your own. 404 for someone else's, for the reason on the delete below. */
router.patch('/:id', async (req: Request, res: Response) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in first' })
  const logs = load()
  const found = logs.find((l) => l.id === req.params.id && l.userEmail === email)
  if (!found) return res.status(404).json({ error: 'Not found' })
  const updated = applyWatchLogEdit(found, req.body)
  save(logs.map((l) => (l === found ? updated : l)))
  // A replaced or cleared photo goes with the change, or it outlives the entry
  // it belonged to — same rule the Worker follows
  if (found.image && found.image !== updated.image) dropImage(found.image)
  const { userEmail, ...pub } = updated
  res.json(pub)
})

/** 404 for someone else's, never 403 — a 403 confirms the id exists. */
router.delete('/:id', async (req: Request, res: Response) => {
  const email = await requireUser(req)
  if (!email) return res.status(401).json({ error: 'Sign in first' })
  const logs = load()
  const found = logs.find((l) => l.id === req.params.id && l.userEmail === email)
  if (!found) return res.status(404).json({ error: 'Not found' })
  save(logs.filter((l) => l !== found))
  if (found.image) dropImage(found.image)
  res.json({ ok: true })
})

export default router
