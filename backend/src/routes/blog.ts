import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import {
  BlogPost,
  PostRating,
  buildPost,
  publicPost,
  sanitizeRating,
  summarizeRatings,
  verifyGoogleToken,
} from '../queries'

/**
 * Visitor blog posts about a tagged movie or cricket match. Locally posts are
 * kept in a JSON array (newest first, capped); in production the Cloudflare
 * Worker writes the same shape to the Supabase posts table.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const BLOG_FILE = path.join(DATA_DIR, 'blog.json')
const RATINGS_FILE = path.join(DATA_DIR, 'ratings.json')
const MAX_POSTS = 500

function loadPosts(): BlogPost[] {
  try {
    const posts = JSON.parse(fs.readFileSync(BLOG_FILE, 'utf-8'))
    return Array.isArray(posts) ? posts : []
  } catch {
    return []
  }
}

function loadRatings(): PostRating[] {
  try {
    const ratings = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8'))
    return Array.isArray(ratings) ? ratings : []
  } catch {
    return []
  }
}

function bearer(req: Request): string {
  const authz = req.headers.authorization ?? ''
  return authz.startsWith('Bearer ') ? authz.slice(7) : ''
}

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  // authorEmail stays in the store for moderation; it is never served
  res.json({ posts: loadPosts().slice(0, 200).map(publicPost) })
})

// The signed-in visitor's own posts (attribution exists only for posts made
// after Google sign-in launched — older anonymous posts have no account)
router.get('/mine', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.json({ posts: [] })
  const authz = req.headers.authorization ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  const profile = token ? await verifyGoogleToken(token, clientId) : null
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  res.json({
    posts: loadPosts()
      .filter((p) => p.authorEmail === profile.email)
      .slice(0, 200)
      .map(publicPost),
  })
})

// Rating summaries for all posts; with a valid token, includes the viewer's own
router.get('/ratings', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  let email: string | undefined
  const token = bearer(req)
  if (token && clientId) {
    email = (await verifyGoogleToken(token, clientId))?.email
  }
  res.json({ ratings: summarizeRatings(loadRatings(), email) })
})

// Rate a post (1–5) — requires Google sign-in; one rating per account, upserted
router.post('/rate', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(401).json({ error: 'Sign-in is not configured' })
  const token = bearer(req)
  const profile = token ? await verifyGoogleToken(token, clientId) : null
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google to rate' })
  const postId = String(req.body?.postId ?? '')
  const rating = sanitizeRating(req.body?.rating)
  if (!postId || !rating) {
    return res.status(400).json({ error: 'postId and a rating from 1 to 5 are required' })
  }
  const post = loadPosts().find((p) => p.id === postId)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  if (post.authorEmail && post.authorEmail === profile.email) {
    return res.status(403).json({ error: "You can't rate your own take" })
  }
  const ratings = loadRatings().filter(
    (r) => !(r.postId === postId && r.userEmail === profile.email)
  )
  ratings.push({ postId, userEmail: profile.email, rating, ts: new Date().toISOString() })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings, null, 2))
  res.json(summarizeRatings(ratings, profile.email)[postId])
})

router.post('/', async (req: Request, res: Response) => {
  // Publishing requires Google sign-in once GOOGLE_CLIENT_ID is configured
  const clientId = process.env.GOOGLE_CLIENT_ID
  let profile = null
  if (clientId) {
    const authz = req.headers.authorization ?? ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    profile = token ? await verifyGoogleToken(token, clientId) : null
    if (!profile) {
      return res.status(401).json({ error: 'Please sign in with Google to publish' })
    }
  }
  const post = buildPost(req.body, profile)
  if (!post) {
    return res.status(400).json({ error: 'title, body and a tagged movie or match are required' })
  }
  const posts = [post, ...loadPosts()].slice(0, MAX_POSTS)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(BLOG_FILE, JSON.stringify(posts, null, 2))
  res.status(201).json(publicPost(post))
})

export default router
