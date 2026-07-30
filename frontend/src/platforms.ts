/**
 * The streaming services with a hub page at /ott/<slug>.
 *
 * Mirrors OTT_PLATFORMS in backend/src/queries.ts — keep the two in step. The
 * backend list is the authority (its `name` has to equal what the release agent
 * writes into `platforms`); this copy exists so the SPA can label a hub and
 * link between them without waiting for a fetch.
 */
export const OTT_PLATFORMS: Array<{ slug: string; name: string }> = [
  { slug: 'netflix', name: 'Netflix' },
  { slug: 'prime-video', name: 'Amazon Prime Video' },
  { slug: 'jiohotstar', name: 'JioHotstar' },
  { slug: 'sonyliv', name: 'Sony LIV' },
  { slug: 'zee5', name: 'ZEE5' },
  { slug: 'sun-nxt', name: 'Sun NXT' },
  { slug: 'apple-tv', name: 'Apple TV' },
  { slug: 'aha', name: 'Aha' },
]

export function platformBySlug(slug: string | undefined) {
  return OTT_PLATFORMS.find((p) => p.slug === slug) ?? null
}

/** By the label the release agent writes into `platforms` — most have no hub. */
export function platformByName(name: string) {
  return OTT_PLATFORMS.find((p) => p.name === name) ?? null
}

/**
 * The <title> and description for a hub. **Byte-identical to platformMeta in
 * backend/src/seo.ts**: the Worker writes those into the HTML and this
 * overwrites them on mount, so the two disagreeing means one URL advertising
 * two titles. See SEO-PLAN.md, "the four-place coupling".
 */
export function platformMeta(name: string): { title: string; description: string } {
  return {
    title: `New Movies & Web Series on ${name} India This Week | WeekAdda`,
    description: `New releases on ${name} in India — the latest movies and web series to start streaming, with release dates and languages, plus what is coming to ${name} next. Updated daily.`,
  }
}
