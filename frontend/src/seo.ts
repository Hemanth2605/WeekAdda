import { useEffect } from 'react'

/** Mirror of the backend's slugify — decorative, since lookup is always by id. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'title'
  )
}

/** Route of a title's detail page (mirror of the backend's titleUrl). */
export function titlePath(r: { id: string; title: string }): string {
  return `/movie/${r.id}/${slugify(r.title)}`
}

/** Route of one review's own page (mirror of the backend's reviewUrl). */
export function reviewPath(p: { id: string; title: string }): string {
  return `/review/${p.id}/${slugify(p.title)}`
}

/** Route of one article's own page (mirror of the backend's articleUrl). */
export function articlePath(a: { id: string; title: string }): string {
  return `/article/${a.id}/${slugify(a.title)}`
}

/** Updates the document title + meta description for the current view (SPA SEO). */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', description)
  }, [title, description])
}
