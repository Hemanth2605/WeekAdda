import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import {
  AddaListing,
  AddaInterest,
  buildListing,
  liveListings,
  publicListing,
  verifyGoogleToken,
} from '../queries'

/**
 * The Adda: a community board. Anyone can read; posting a listing and
 * expressing interest require Google sign-in. Contact details are revealed
 * mutually and only on interest — the deal itself happens between the two
 * people, off the site. Locally stored in JSON; production uses the Supabase
 * listings/listing_interests tables via the Worker.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const ADDA_FILE = path.join(DATA_DIR, 'adda.json')
const MAX_LISTINGS = 500

interface AddaStore {
  listings: AddaListing[]
  interests: AddaInterest[]
}

function loadStore(): AddaStore {
  try {
    const store = JSON.parse(fs.readFileSync(ADDA_FILE, 'utf-8'))
    return {
      listings: Array.isArray(store.listings) ? store.listings : [],
      interests: Array.isArray(store.interests) ? store.interests : [],
    }
  } catch {
    return { listings: [], interests: [] }
  }
}

function saveStore(store: AddaStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(ADDA_FILE, JSON.stringify(store, null, 2))
}

function bearer(req: Request): string {
  const authz = req.headers.authorization ?? ''
  return authz.startsWith('Bearer ') ? authz.slice(7) : ''
}

async function viewer(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const token = bearer(req)
  if (!clientId || !token) return null
  return verifyGoogleToken(token, clientId)
}

const contactOf = (l: AddaListing) => ({
  name: l.author,
  email: l.authorEmail,
  ...(l.whatsapp ? { whatsapp: l.whatsapp } : {}),
})

const router = Router()

// Open board — public; a valid token additionally reveals what's yours and
// the contacts you already unlocked
router.get('/', async (req: Request, res: Response) => {
  const me = await viewer(req)
  const store = loadStore()
  const listings = liveListings(store.listings).map((l) => {
    const interests = store.interests.filter((i) => i.listingId === l.id)
    const mine = Boolean(me && l.authorEmail === me.email)
    const myInterest = me ? interests.find((i) => i.userEmail === me.email) : undefined
    return {
      ...publicListing(l),
      interestCount: interests.length,
      ...(mine
        ? { mine: true, interests: interests.map((i) => ({ name: i.name, email: i.userEmail, ts: i.ts })) }
        : {}),
      ...(myInterest ? { contact: contactOf(l) } : {}),
    }
  })
  res.json({ listings })
})

// Post a listing — sign-in required
router.post('/', async (req: Request, res: Response) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Sign-in is not configured' })
  }
  const me = await viewer(req)
  if (!me) return res.status(401).json({ error: 'Please sign in with Google to post' })
  const listing = buildListing(req.body, me)
  if (!listing) {
    return res.status(400).json({ error: 'A title and a few words of detail are required' })
  }
  const store = loadStore()
  store.listings = [listing, ...store.listings].slice(0, MAX_LISTINGS)
  saveStore(store)
  res.status(201).json({ ...publicListing(listing), interestCount: 0, mine: true, interests: [] })
})

// Express interest — sign-in required; reveals the poster's contact
router.post('/:id/interest', async (req: Request, res: Response) => {
  const me = await viewer(req)
  if (!me) return res.status(401).json({ error: 'Please sign in with Google to respond' })
  const store = loadStore()
  const listing = store.listings.find((l) => l.id === req.params.id && l.status === 'open')
  if (!listing) return res.status(404).json({ error: 'This listing is gone or closed' })
  if (listing.authorEmail === me.email) {
    return res.status(400).json({ error: 'This is your own listing' })
  }
  if (!store.interests.some((i) => i.listingId === listing.id && i.userEmail === me.email)) {
    store.interests.push({
      listingId: listing.id,
      userEmail: me.email,
      name: me.name || me.email,
      ts: new Date().toISOString(),
    })
    saveStore(store)
  }
  res.json({ contact: contactOf(listing) })
})

// Close your own listing
router.post('/:id/close', async (req: Request, res: Response) => {
  const me = await viewer(req)
  if (!me) return res.status(401).json({ error: 'Please sign in with Google' })
  const store = loadStore()
  const listing = store.listings.find((l) => l.id === req.params.id)
  if (!listing) return res.status(404).json({ error: 'Listing not found' })
  if (listing.authorEmail !== me.email) {
    return res.status(403).json({ error: 'Only the poster can close a listing' })
  }
  listing.status = 'closed'
  saveStore(store)
  res.json({ ok: true })
})

export default router
