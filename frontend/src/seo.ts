import { useEffect } from 'react'

/** Route of a title's detail page (mirror of the backend's titleUrl). */
export function titlePath(r: { id: string; title: string }): string {
  const slug =
    r.title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'title'
  return `/movie/${r.id}/${slug}`
}

/** Updates the document title + meta description for the current view (SPA SEO). */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', description)
  }, [title, description])
}
