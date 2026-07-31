/**
 * Loading placeholders shaped like the thing that is coming.
 *
 * "Loading…" tells a reader that something is happening but nothing about
 * what; a skeleton says "an article, roughly this shape, in a moment" and the
 * page does not jump when the real content lands. Reuses the same `.sk`
 * shimmer the reviews feed already uses, so there is one loading idiom here.
 *
 * aria-hidden with a live region alongside: a screen reader should hear
 * "Loading" once, not a description of eight grey rectangles.
 */

export function ArticleCardsSkeleton({
  count = 4,
  label = 'Loading your articles',
}: {
  count?: number
  label?: string
}) {
  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="my-articles-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <article key={i} className="my-article-card">
            <div className="sk sk-thumb" />
            <div className="my-article-body">
              <div className="sk sk-line" style={{ width: '45%', height: 10 }} />
              <div className="sk sk-line" style={{ width: '90%', height: 18, marginTop: 8 }} />
              <div className="sk sk-line" style={{ width: '75%', height: 18 }} />
              <div className="sk sk-line" style={{ width: '100%', marginTop: 8 }} />
              <div className="sk sk-line" style={{ width: '60%' }} />
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

/** The reading column of an article or a review, while it arrives. */
export function ArticlePageSkeleton({ cover = true }: { cover?: boolean }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      <article className="review-article" aria-hidden="true">
        <div className="sk sk-line" style={{ width: '35%', height: 11 }} />
        <div className="sk sk-line" style={{ width: '85%', height: 28, marginTop: 12 }} />
        <div className="sk sk-line" style={{ width: '55%', height: 28 }} />
        <div className="sk sk-line" style={{ width: '40%', height: 11, marginTop: 12 }} />
        {cover && <div className="sk sk-cover" />}
        <div className="sk-body">
          {['100%', '96%', '88%', '100%', '72%', '94%', '60%'].map((w, i) => (
            <div key={i} className="sk sk-line" style={{ width: w }} />
          ))}
        </div>
      </article>
    </>
  )
}
