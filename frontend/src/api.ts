import { getStoredUser } from './auth'

/** Anonymous per-browser id so stats can count unique visitors (no login). */
function visitorId(): string {
  try {
    let id = localStorage.getItem('weekadda-visitor')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('weekadda-visitor', id)
    }
    return id
  } catch {
    return ''
  }
}

/** Fire-and-forget outbound-click tracking; must never block or break navigation. */
export function trackClick(payload: {
  kind: 'watch' | 'book' | 'score' | 'share'
  platform: string
  titleId: string
  title: string
  language: string
}) {
  try {
    // Signed-in visitors are identified by their verified account (token
    // checked server-side); everyone else by the anonymous local id
    const token = getStoredUser()?.token
    fetch('/api/track/click', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...payload, visitorId: visitorId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // tracking is best-effort only
  }
}

// ---------------------------------------------------------------- blog

export function fetchPosts(): Promise<{ posts: import('./types').BlogPost[] }> {
  return api('/blog')
}

/**
 * One review plus the related row under it, in a single round trip — the row
 * is part of the page, not something it should fetch the whole feed to build.
 */
export function fetchPost(id: string): Promise<{
  post: import('./types').BlogPost
  related: import('./types').BlogPost[]
}> {
  return api(`/blog/${encodeURIComponent(id)}`)
}

export function fetchMyPosts(token: string): Promise<{ posts: import('./types').BlogPost[] }> {
  return api('/blog/mine', { headers: { Authorization: `Bearer ${token}` } })
}

export function fetchRatings(
  token?: string
): Promise<{ ratings: Record<string, import('./types').RatingSummary> }> {
  return api('/blog/ratings', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

export function ratePost(
  postId: string,
  rating: number,
  token: string
): Promise<import('./types').RatingSummary> {
  return api('/blog/rate', {
    method: 'POST',
    body: JSON.stringify({ postId, rating }),
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** Edit your own review. The server decides ownership; 404 for anyone else's. */
export function updatePost(
  id: string,
  payload: { title: string; body: string; tag: import('./types').BlogTag },
  token: string
): Promise<import('./types').BlogPost> {
  return api(`/blog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function deletePost(id: string, token: string): Promise<{ deleted: string }> {
  return api(`/blog/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createPost(
  payload: {
    author: string
    title: string
    body: string
    tag: import('./types').BlogTag
  },
  token?: string
): Promise<import('./types').BlogPost> {
  return api('/blog', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

// ---------------------------------------------------------------- articles

export function fetchArticles(): Promise<{ articles: import('./types').Article[] }> {
  return api('/articles')
}

/** The signed-in writer's own articles, so they can find what they published. */
export function fetchMyArticles(
  token: string
): Promise<{ articles: import('./types').Article[]; owner?: boolean }> {
  return api('/articles/mine', { headers: { Authorization: `Bearer ${token}` } })
}

/** One article plus the related rail beside it, in a single round trip. */
export function fetchArticle(id: string): Promise<{
  article: import('./types').Article
  related: import('./types').Article[]
}> {
  return api(`/articles/${encodeURIComponent(id)}`)
}

/**
 * Cover upload. The file goes up as the raw body with its own Content-Type —
 * no multipart, which keeps both servers free of a form-parsing dependency.
 * Deliberately not routed through `api()`: that helper forces a JSON
 * Content-Type, which is exactly the header this request needs to own.
 */
export async function uploadArticleImage(file: File, token?: string): Promise<{ url: string }> {
  const res = await fetch('/api/articles/image', {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`)
  return body as { url: string }
}

export function createArticle(
  payload: {
    author: string
    title: string
    body: string
    topic: 'movie' | 'match'
    films?: import('./types').ArticleFilm[]
    image?: string
    imagePosition?: string
    imageFit?: 'cover' | 'contain'
    /** Owner only: false declines the site byline. Ignored for anyone else. */
    official?: boolean
  },
  token?: string
): Promise<import('./types').Article> {
  return api('/articles', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

/** Like counts for every article; with a token, whether you liked each. */
export function fetchArticleLikes(
  token?: string
): Promise<{ likes: Record<string, import('./types').LikeSummary> }> {
  return api('/articles/likes', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

/** Toggle the heart. Tapping again removes it; sign-in required. */
export function likeArticle(
  id: string,
  token: string
): Promise<import('./types').LikeSummary> {
  return api(`/articles/${encodeURIComponent(id)}/like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** Edit your own article. The server decides ownership; 404 for anyone else's. */
export function updateArticle(
  id: string,
  payload: {
    title: string
    body: string
    topic: 'movie' | 'match'
    films?: import('./types').ArticleFilm[]
    image?: string
    imagePosition?: string
    imageFit?: 'cover' | 'contain'
  },
  token: string
): Promise<import('./types').Article> {
  return api(`/articles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function deleteArticle(id: string, token: string): Promise<{ deleted: string }> {
  return api(`/articles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ---------------------------------------------------------------- owner stats

/** Click stats for the private /stats dashboard — owner account only (403 otherwise). */
export function fetchStats(token: string): Promise<import('./types').ClickStats> {
  return api('/track/stats', { headers: { Authorization: `Bearer ${token}` } })
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return body as T
}
