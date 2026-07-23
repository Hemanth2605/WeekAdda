/** Fire-and-forget outbound-click tracking; must never block or break navigation. */
export function trackClick(payload: {
  kind: 'watch' | 'book' | 'score' | 'share'
  platform: string
  titleId: string
  title: string
  language: string
}) {
  try {
    fetch('/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

export function createPost(payload: {
  author: string
  title: string
  body: string
  tag: import('./types').BlogTag
}): Promise<import('./types').BlogPost> {
  return api('/blog', { method: 'POST', body: JSON.stringify(payload) })
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
