import { Fragment } from 'react'
import { Link } from 'react-router-dom'

export interface Crumb {
  name: string
  /** Omitted on the last crumb — that one is the page you are on. */
  href?: string
}

/**
 * The visible half of the breadcrumb. The Worker emits this same trail plus a
 * matching `BreadcrumbList` (see `breadcrumb()` in backend/src/seo.ts), and
 * React replaces that block on mount — so without this component the markup
 * would describe a path the reader cannot see, which is the same mistake as
 * marking up a rating nobody was asked for.
 *
 * It earns its place regardless: on a title page it is the only link back into
 * that film's platform hub.
 */
export default function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="wa-crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <Fragment key={`${c.name}-${i}`}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {c.href ? (
            <Link to={c.href}>{c.name}</Link>
          ) : (
            <span aria-current="page">{c.name}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
