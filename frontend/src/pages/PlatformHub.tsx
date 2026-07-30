import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { MonitorPlay, Film } from 'lucide-react'
import { api } from '../api'
import { usePageMeta, titlePath } from '../seo'
import { Release } from '../types'
import { platformBySlug, platformMeta } from '../platforms'
import PlatformLinks from '../components/PlatformLinks'
import Breadcrumbs from '../components/Breadcrumbs'
import { languageLabel } from '../languages'
import ReleaseCard, { formatDate } from '../components/ReleaseCard'
import ReleaseModal from '../components/ReleaseModal'
import PipShow, { MAX_SLIDES } from '../components/PipShow'
import { useHomeLanguage, orderWithHome } from '../geo'

interface HubResponse {
  platform: { slug: string; name: string }
  streaming: Release[]
  upcoming: Release[]
  indexable: boolean
}

/**
 * One page per streaming service — /ott/netflix, /ott/zee5, …
 *
 * It exists for search, not for the tab bar: "new movies on netflix india" is a
 * query /movies cannot win, because that page's title says "this week" and
 * names eight platforms at once. Not week-paged for the same reason — the
 * question is a standing one. See SEO-PLAN.md, Tier 2.
 */
export default function PlatformHub() {
  const { platform: slug } = useParams<{ platform: string }>()
  const platform = platformBySlug(slug)
  const [data, setData] = useState<HubResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Release | null>(null)

  const meta = platformMeta(platform?.name ?? 'OTT')
  usePageMeta(meta.title, meta.description)

  useEffect(() => {
    if (!platform) return
    setLoading(true)
    setData(null)
    api<HubResponse>(`/ott/${platform.slug}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [platform?.slug])

  // Same home-first language order the rest of the site uses
  const homeLang = useHomeLanguage()
  const langOrder = useMemo(() => orderWithHome(homeLang), [homeLang])
  const sections = useMemo(() => {
    const rank = (code: string) => {
      const i = langOrder.indexOf(code)
      return i === -1 ? langOrder.length : i
    }
    const map = new Map<string, Release[]>()
    for (const r of data?.streaming ?? []) {
      const arr = map.get(r.language) ?? []
      arr.push(r)
      map.set(r.language, arr)
    }
    return [...map.entries()]
      .map(([code, items]) => ({ code, label: languageLabel(code), items }))
      .sort((a, b) => rank(a.code) - rank(b.code) || b.items.length - a.items.length)
  }, [data, langOrder])

  const pipSlides = useMemo(
    () =>
      (data?.streaming ?? [])
        .filter((r) => r.poster)
        .slice(0, MAX_SLIDES)
        .map((r) => ({
          title: r.title,
          sub: `${r.languageLabel} · ${formatDate(r.releaseDate)}`,
          image: r.poster,
          href: titlePath(r),
        })),
    [data]
  )

  // A slug we do not serve is not a page: send it to the movies hub rather
  // than rendering an empty shell (the Worker 404s it for crawlers).
  if (!platform) return <Navigate to="/movies" replace />

  return (
    <main>
      <PipShow
        slides={pipSlides}
        noun="titles"
        context={{ tab: platform.name, detail: 'Now streaming' }}
      />
      <section className="opp-header">
        <div>
          <Breadcrumbs
            trail={[
              { name: 'WeekAdda', href: '/' },
              { name: 'Movies & OTT', href: '/movies' },
              { name: platform.name },
            ]}
          />
          <span className="hero-eyebrow">
            <MonitorPlay size={13} /> Now streaming in India
          </span>
          <h1 className="sr-only">New Movies &amp; Web Series on {platform.name} in India</h1>
          <p>
            Everything that recently started streaming on {platform.name} in India, newest first —
            plus what has been announced next. Swept daily and laid out language by language.
          </p>
          {/* Every hub links to every other one: eight pages only the sitemap
              knows about are eight orphans. Real links, not a JS-only tab. */}
          <PlatformLinks current={platform.slug} />
        </div>
      </section>

      {loading ? (
        <div className="lang-sections" aria-hidden>
          {[0, 1].map((s) => (
            <section key={s} className="lang-section">
              <div className="lang-head">
                <div className="sk sk-line" style={{ width: 120 }} />
              </div>
              <div className="lang-row">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="sk sk-poster" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : sections.length === 0 && !(data?.upcoming.length ?? 0) ? (
        <div className="empty-state">
          <Film size={54} />
          <h3>Nothing recorded on {platform.name} yet</h3>
          <p>
            New arrivals are swept every morning at 4 AM IST. In the meantime, the{' '}
            <Link to="/movies">week&apos;s OTT releases</Link> cover every platform at once.
          </p>
        </div>
      ) : (
        <div className="lang-sections">
          {sections.map((s) => (
            <section key={s.code} className="lang-section">
              <div className="lang-head">
                <h2>
                  {s.label} on {platform.name}
                </h2>
                <span className="count">
                  {s.items.length} title{s.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="lang-row">
                {s.items.map((r, i) => (
                  <ReleaseCard key={r.id} release={r} index={i} onOpen={setSelected} />
                ))}
              </div>
            </section>
          ))}

          {(data?.upcoming.length ?? 0) > 0 && (
            <section className="lang-section">
              <div className="lang-head">
                <h2>Coming soon to {platform.name}</h2>
                <span className="count">{data!.upcoming.length} announced</span>
              </div>
              <div className="lang-row">
                {data!.upcoming.map((r, i) => (
                  <ReleaseCard key={r.id} release={r} index={i} onOpen={setSelected} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {selected && <ReleaseModal release={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
