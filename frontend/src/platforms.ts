/**
 * The streaming services with a hub page at /ott/<slug>.
 *
 * Mirrors OTT_PLATFORMS in backend/src/queries.ts — keep the two in step. The
 * backend list is the authority (its `name` has to equal what the release agent
 * writes into `platforms`); this copy exists so the SPA can label a hub and
 * link between them without waiting for a fetch.
 */
export const OTT_PLATFORMS: Array<{ slug: string; name: string; short?: string }> = [
  { slug: 'netflix', name: 'Netflix' },
  // `short` is the name used in a <title>, where characters are rationed
  { slug: 'prime-video', name: 'Amazon Prime Video', short: 'Prime Video' },
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

/** The name for a <title> or meta description; full name everywhere else. */
export function platformShort(p: { name: string; short?: string }): string {
  return p.short ?? p.name
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
    title: `New Movies & Web Series on ${name} India This Week`,
    description: `New this week on ${name} in India — the movies and web series that just started streaming, plus everything from recent weeks and what is coming next.`,
  }
}
