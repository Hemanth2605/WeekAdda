import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { BlogPost, buildPost } from '../queries'

/**
 * Visitor blog posts about a tagged movie or cricket match. Locally posts are
 * kept in a JSON array (newest first, capped); in production the Cloudflare
 * Worker writes the same shape to the Supabase posts table.
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'cache')
const BLOG_FILE = path.join(DATA_DIR, 'blog.json')
const MAX_POSTS = 500

function loadPosts(): BlogPost[] {
  try {
    const posts = JSON.parse(fs.readFileSync(BLOG_FILE, 'utf-8'))
    return Array.isArray(posts) ? posts : []
  } catch {
    return []
  }
}

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  res.json({ posts: loadPosts().slice(0, 200) })
})

router.post('/', (req: Request, res: Response) => {
  const post = buildPost(req.body)
  if (!post) {
    return res.status(400).json({ error: 'title, body and a tagged movie or match are required' })
  }
  const posts = [post, ...loadPosts()].slice(0, MAX_POSTS)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(BLOG_FILE, JSON.stringify(posts, null, 2))
  res.status(201).json(post)
})

export default router
