import { useEffect, useMemo, useState } from 'react'
import { Check, Film, Plus, Search, X } from 'lucide-react'
import { api } from '../api'
import { OTT_PLATFORMS } from '../platforms'
import { platformClass } from '../share'
import { ArticleFilm, Release } from '../types'

/**
 * "Where to watch" on a movie article.
 *
 * Two ways in, because one is not enough. A film still inside the thirteen-week
 * release window can be picked from the cache, and its platforms fill in from
 * what the sweep already knows. Anything older — which is most of what an
 * article is about — is typed by name, and the writer names the platform.
 *
 * That is not a shortcut: no API we have knows where a 1983 film streams in
 * India, and guessing would send people to empty searches. The link itself is
 * a search on the platform (watchUrl), so a title is all it ever needs.
 */
export default function FilmWatchPicker({
  films,
  onChange,
}: {
  films: ArticleFilm[]
  onChange: (films: ArticleFilm[]) => void
}) {
  const [pool, setPool] = useState<Release[]>([])
  const [search, setSearch] = useState('')
  // Open only while nothing has been picked yet; after that it takes a
  // deliberate "add another" to reopen it
  const [adding, setAdding] = useState(films.length === 0)

  useEffect(() => {
    let cancelled = false
    Promise.all(
      ['released', 'ott', 'upcoming'].map((w) =>
        api<{ releases: Release[] }>(`/releases?window=${w}`).then(
          (r) => r.releases,
          () => [] as Release[]
        )
      )
    ).then((lists) => {
      if (cancelled) return
      const seen = new Set<string>()
      const all: Release[] = []
      for (const list of lists) {
        for (const r of list) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          all.push(r)
        }
      }
      setPool(all)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const q = search.trim()
  const suggestions = useMemo(() => {
    if (!q) return []
    const lower = q.toLowerCase()
    return pool
      .filter((r) => r.title.toLowerCase().includes(lower))
      .filter((r) => !films.some((f) => f.id === r.id))
      .slice(0, 6)
  }, [pool, q, films])

  // A title we already hold is worth offering as itself; anything else is the
  // free-text path, which is the one that matters for older films
  const exact = suggestions.some((r) => r.title.toLowerCase() === q.toLowerCase())

  const add = (film: ArticleFilm) => {
    onChange([...films, film])
    setSearch('')
    // Close the search once something is chosen. Leaving it open reads as the
    // pick not having registered — the field you just used is still sitting
    // there asking for the same thing.
    setAdding(false)
  }

  const togglePlatform = (index: number, name: string) => {
    onChange(
      films.map((f, i) =>
        i === index
          ? {
              ...f,
              platforms: f.platforms.some((p) => p.name === name)
                ? f.platforms.filter((p) => p.name !== name)
                : [...f.platforms, { name }].slice(0, 4),
            }
          : f
      )
    )
  }

  const setUrl = (index: number, name: string, url: string) => {
    onChange(
      films.map((f, i) =>
        i === index
          ? {
              ...f,
              platforms: f.platforms.map((p) =>
                p.name === name ? { name, ...(url.trim() ? { url: url.trim() } : {}) } : p
              ),
            }
          : f
      )
    )
  }

  return (
    <div className="film-picker">
      <span className="film-picker-label">
        <Film size={13} /> Where to watch <em>optional</em>
      </span>

      {films.map((f, i) => (
        <div key={`${f.title}-${i}`} className="film-picked">
          <div className="film-picked-head">
            <b>{f.title}</b>
            <button
              className="share-close"
              onClick={() => onChange(films.filter((_, j) => j !== i))}
              aria-label={`Remove ${f.title}`}
            >
              <X size={14} />
            </button>
          </div>
          <div className="genre-row film-platforms">
            {/* The same badge a release card wears: the service's brand colour
                with its name on it, always — so Netflix looks like Netflix here
                and there rather than like a chip that happens to say Netflix.
                Selection is a white ring and a tick, not a colour change: the
                colour is the platform's identity and dimming it to mean
                "unpicked" would make eight live choices look switched off. */}
            {OTT_PLATFORMS.map((p) => {
              const picked = f.platforms.some((x) => x.name === p.name)
              const brand = platformClass(p.name)
              return (
                <button
                  key={p.slug}
                  className={`platform-chip ${brand}${picked ? ' picked' : ''}`}
                  onClick={() => togglePlatform(i, p.name)}
                  aria-pressed={picked}
                >
                  {picked && <Check size={13} />}
                  {p.short ?? p.name}
                </button>
              )
            })}
          </div>
          {/* A pasted title-page URL beats the search we would build: a search
              can land on the wrong film, or on nothing */}
          {f.platforms.map((p) => (
            <label key={p.name} className="film-url">
              <span>{p.name} link</span>
              <input
                className="blog-input"
                value={p.url ?? ''}
                onChange={(e) => setUrl(i, p.name, e.target.value)}
                placeholder="Paste the title page URL — optional, we search otherwise"
              />
            </label>
          ))}
          {f.platforms.length === 0 && (
            <p className="film-picked-hint">
              Pick a platform, or leave it — the film is still named on the article.
            </p>
          )}
        </div>
      ))}

      {films.length > 0 && films.length < 6 && !adding && (
        <button className="film-add-more" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add another film
        </button>
      )}

      {/* films.length === 0 keeps the search reachable after removing the last
          one — otherwise closing it would leave nothing to click at all */}
      {films.length < 6 && (adding || films.length === 0) && (
        <>
          <div className="search-wrap">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Film name — anything, however old"
            />
          </div>
          {q && (
            <div className="blog-tag-options">
              {suggestions.map((r) => (
                <button
                  key={r.id}
                  className="blog-tag-option"
                  onClick={() =>
                    add({
                      id: r.id,
                      title: r.title,
                      platforms: (r.platforms ?? []).slice(0, 4).map((name) => ({ name })),
                    })
                  }
                >
                  {r.poster ? (
                    <img src={r.poster} alt="" loading="lazy" />
                  ) : (
                    <span className="blog-tag-icon movie">
                      <Film size={15} />
                    </span>
                  )}
                  <span className="blog-tag-text">
                    <b>{r.title}</b>
                    <small>
                      {r.platforms?.length
                        ? `${r.languageLabel} · ${r.platforms.join(', ')}`
                        : r.languageLabel}
                    </small>
                  </span>
                </button>
              ))}
              {!exact && (
                <button
                  className="blog-tag-option add-own"
                  onClick={() => add({ title: q, platforms: [] })}
                >
                  <span className="blog-tag-icon">
                    <Plus size={15} />
                  </span>
                  <span className="blog-tag-text">
                    <b>Add “{q}”</b>
                    <small>Not in this week&apos;s releases — you pick the platform</small>
                  </span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
