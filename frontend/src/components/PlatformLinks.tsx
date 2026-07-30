import { Link } from 'react-router-dom'
import { OTT_PLATFORMS } from '../platforms'

/**
 * "Netflix · Prime Video · JioHotstar · …" — the way into the per-platform hubs.
 *
 * Deliberately text links, not chips. Everything else in the toolbar is a
 * filter that changes the list in place; these leave the page. Dressing
 * navigation as a filter chip promises the wrong thing, and eight more pills
 * turned the top of the phone screen into a wall of controls before a single
 * poster. One quiet wrapped line does the same job in a third of the height,
 * and keeps the real <a href> a crawler needs.
 *
 * No visible label: eight brand names in a row introduce themselves, and a
 * micro-label sitting inline read as a ninth item. It survives as aria-label
 * so the group still announces itself to a screen reader.
 */
export default function PlatformLinks({ current }: { current?: string }) {
  return (
    <p className="platform-links" aria-label="Browse by platform">
      {OTT_PLATFORMS.map((p) =>
        p.slug === current ? (
          <strong key={p.slug} aria-current="page">
            {p.name}
          </strong>
        ) : (
          <Link key={p.slug} to={`/ott/${p.slug}`}>
            {p.name}
          </Link>
        )
      )}
    </p>
  )
}
