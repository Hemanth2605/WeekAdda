import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import {
  BlogPost,
  PostRating,
  applyPostEdit,
  buildPost,
  canEditPost,
  publicPost,
  relatedReviews,
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

// One review, for its own page at /review/:id/:slug. Declared after the literal
// routes above so /mine and /ratings are never read as an id.
router.get('/:id', (req: Request, res: Response) => {
  const all = loadPosts()
  const post = all.find((p) => p.id === req.params.id)
  if (!post) return res.status(404).json({ error: 'Review not found' })
  // Related in the same round trip — the row under the review is part of the
  // page, not something it should have to fetch the whole feed to build
  res.json({
    post: publicPost(post),
    related: relatedReviews(all, post.id).map(publicPost),
  })
})

/** The signed-in writer, or null. Shared by the two owner-gated routes below. */
async function writer(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return null
  const token = bearer(req)
  return token ? await verifyGoogleToken(token, clientId) : null
}

function savePosts(all: BlogPost[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(BLOG_FILE, JSON.stringify(all, null, 2))
}

// Edit one's own review. 404 rather than 403 for someone else's, so the API
// never confirms an id exists to an account with no business knowing.
router.patch('/:id', async (req: Request, res: Response) => {
  const profile = await writer(req)
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  const all = loadPosts()
  const index = all.findIndex((p) => p.id === req.params.id)
  if (index < 0 || !canEditPost(all[index], profile.email)) {
    return res.status(404).json({ error: 'Review not found' })
  }
  const edited = applyPostEdit(all[index], req.body)
  if (!edited) {
    return res.status(400).json({ error: 'title, body and a tagged movie or match are required' })
  }
  all[index] = edited
  savePosts(all)
  res.json(publicPost(edited))
})

router.delete('/:id', async (req: Request, res: Response) => {
  const profile = await writer(req)
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  const all = loadPosts()
  const found = all.find((p) => p.id === req.params.id)
  if (!found || !canEditPost(found, profile.email)) {
    return res.status(404).json({ error: 'Review not found' })
  }
  savePosts(all.filter((p) => p.id !== found.id))
  // Ratings of a review that no longer exists are orphans that would still be
  // counted if an id were ever reused
  const ratings = loadRatings().filter((r) => r.postId !== found.id)
  fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings, null, 2))
  res.json({ deleted: found.id })
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
  const post = buildPost(req.body, profile, process.env.OWNER_EMAIL)
  if (!post) {
    return res.status(400).json({ error: 'title, body and a tagged movie or match are required' })
  }
  const posts = [post, ...loadPosts()].slice(0, MAX_POSTS)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(BLOG_FILE, JSON.stringify(posts, null, 2))
  res.status(201).json(publicPost(post))
})

export default router
