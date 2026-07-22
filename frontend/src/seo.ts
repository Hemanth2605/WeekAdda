import { useEffect } from 'react'

/** Updates the document title + meta description for the current view (SPA SEO). */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', description)
  }, [title, description])
}
