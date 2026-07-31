import { Router, Request, Response, raw } from 'express'
import fs from 'fs'
import path from 'path'
import {
  Article,
  ArticleLike,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  applyArticleEdit,
  buildArticle,
  canEditArticle,
  imageExtension,
  isOwnerEmail,
  publicArticle,
  relatedArticles,
  summarizeLikes,
  verifyGoogleToken,
} from '../queries'

/**
 * Articles: the writing that has no release to hang on — the 1983 final, a
 * top-ten list, an old film revisited. Kept apart from reviews all the way
 * down (own store here, own table in production) so the two can never be
 * served as one feed. See the Article type in queries.ts for why.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json')
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const LIKES_FILE = path.join(DATA_DIR, 'article-likes.json')
const MAX_ARTICLES = 500

function loadLikes(): ArticleLike[] {
  try {
    const rows = JSON.parse(fs.readFileSync(LIKES_FILE, 'utf-8'))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function loadArticles(): Article[] {
  try {
    const list = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf-8'))
    return Array.isArray(list) ? list : []
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
  res.json({ articles: loadArticles().slice(0, 200).map(publicArticle) })
})

// The signed-in visitor's own articles
router.get('/mine', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.json({ articles: [] })
  const token = bearer(req)
  const profile = token ? await verifyGoogleToken(token, clientId) : null
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  res.json({
    articles: loadArticles()
      .filter((a) => a.authorEmail === profile.email)
      .slice(0, 200)
      .map(publicArticle),
    // Whether this account may publish under the site's byline. The composer
    // needs it to offer the choice, and OWNER_EMAIL never leaves the server.
    owner: isOwnerEmail(profile.email, process.env.OWNER_EMAIL),
  })
})

/**
 * Cover upload. The file arrives as the raw request body with its own
 * Content-Type — no multipart, so no new dependency; `express.json()` above
 * ignores an image/* body and leaves it to the parser here.
 *
 * Sign-in gated, capped at 4 MB and restricted to four image types, because an
 * unauthenticated endpoint that writes whatever it is sent to disk is a file
 * host, not a feature. The stored name is generated — nothing the client sends
 * reaches the filesystem, so a crafted filename cannot climb out of the folder.
 */
router.post(
  '/image',
  raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (clientId) {
      const token = bearer(req)
      const profile = token ? await verifyGoogleToken(token, clientId) : null
      if (!profile) return res.status(401).json({ error: 'Please sign in with Google to upload' })
    }
    const ext = imageExtension(req.headers['content-type'])
    if (!ext) return res.status(415).json({ error: 'Use a JPEG, PNG, WebP, AVIF or GIF image' })
    const body = req.body
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'No image received' })
    }
    if (body.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Image is larger than 4 MB' })
    }
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    fs.writeFileSync(path.join(UPLOAD_DIR, name), body)
    res.status(201).json({ url: `/api/articles/image/${name}` })
  }
)

// Serving the local uploads. Two segments, so it can never be read as an id by
// the single-segment /:id route below. The name is matched against the pattern
// we generate rather than trusted, and resolved inside the folder.
router.get('/image/:name', (req: Request, res: Response) => {
  const name = req.params.name
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).end()
  const file = path.join(UPLOAD_DIR, name)
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return res.status(404).end()
  // Set the type from the extension we generated rather than leaving it to
  // Express's mime table, which does not know .avif and falls back to
  // application/octet-stream — a download prompt where a picture should be
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0]
  if (type) res.type(type)
  res.sendFile(file)
})

// Like counts for every article; with a valid token, whether you liked each.
// MUST stay above /:id, or "likes" is read as an article id and 404s.
router.get('/likes', async (req: Request, res: Response) => {
  const profile = await writer(req)
  res.json({ likes: summarizeLikes(loadLikes(), profile?.email) })
})

// One article plus what to show beside it, in a single round trip — the panel
// is part of the page, not an afterthought it can render without.
router.get('/:id', (req: Request, res: Response) => {
  const all = loadArticles()
  const article = all.find((a) => a.id === req.params.id)
  if (!article) return res.status(404).json({ error: 'Article not found' })
  res.json({
    article: publicArticle(article),
    related: relatedArticles(all, article.id).map(publicArticle),
  })
})

/** The signed-in writer, or null. Shared by the two owner-gated routes below. */
async function writer(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return null
  const token = bearer(req)
  return token ? await verifyGoogleToken(token, clientId) : null
}

function save(all: Article[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(all, null, 2))
}

// Toggle the heart. Sign-in required, one per account, tap again to remove.
router.post('/:id/like', async (req: Request, res: Response) => {
  const profile = await writer(req)
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google to like' })
  const article = loadArticles().find((a) => a.id === req.params.id)
  if (!article) return res.status(404).json({ error: 'Article not found' })
  if (article.authorEmail && article.authorEmail === profile.email) {
    return res.status(403).json({ error: "You can't like your own article" })
  }
  const rows = loadLikes()
  const already = rows.some((l) => l.articleId === article.id && l.userEmail === profile.email)
  const next = already
    ? rows.filter((l) => !(l.articleId === article.id && l.userEmail === profile.email))
    : [...rows, { articleId: article.id, userEmail: profile.email, ts: new Date().toISOString() }]
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(LIKES_FILE, JSON.stringify(next, null, 2))
  res.json(summarizeLikes(next, profile.email)[article.id] ?? { count: 0 })
})

// Edit one's own article. 404 rather than 403 for someone else's, so the API
// never confirms that an id exists to an account with no business knowing.
router.patch('/:id', async (req: Request, res: Response) => {
  const profile = await writer(req)
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  const all = loadArticles()
  const index = all.findIndex((a) => a.id === req.params.id)
  if (index < 0 || !canEditArticle(all[index], profile.email)) {
    return res.status(404).json({ error: 'Article not found' })
  }
  const edited = applyArticleEdit(all[index], req.body)
  if (!edited) return res.status(400).json({ error: 'A title, some writing and a topic are required' })
  all[index] = edited
  save(all)
  res.json(publicArticle(edited))
})

router.delete('/:id', async (req: Request, res: Response) => {
  const profile = await writer(req)
  if (!profile) return res.status(401).json({ error: 'Please sign in with Google' })
  const all = loadArticles()
  const found = all.find((a) => a.id === req.params.id)
  if (!found || !canEditArticle(found, profile.email)) {
    return res.status(404).json({ error: 'Article not found' })
  }
  save(all.filter((a) => a.id !== found.id))
  res.json({ deleted: found.id })
})

router.post('/', async (req: Request, res: Response) => {
  // Publishing requires Google sign-in once GOOGLE_CLIENT_ID is configured;
  // while it is unset, anonymous posting still works (keyless fallback)
  const clientId = process.env.GOOGLE_CLIENT_ID
  let profile = null
  if (clientId) {
    const token = bearer(req)
    profile = token ? await verifyGoogleToken(token, clientId) : null
    if (!profile) return res.status(401).json({ error: 'Please sign in with Google to publish' })
  }
  const article = buildArticle(req.body, profile, process.env.OWNER_EMAIL)
  if (!article) {
    return res.status(400).json({ error: 'A title, some writing and a topic are required' })
  }
  const all = [article, ...loadArticles()].slice(0, MAX_ARTICLES)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(all, null, 2))
  res.status(201).json(publicArticle(article))
})

export default router
