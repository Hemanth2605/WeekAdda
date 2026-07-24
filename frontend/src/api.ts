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
