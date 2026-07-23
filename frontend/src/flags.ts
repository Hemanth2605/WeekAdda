/**
 * Locally bundled country flags (frontend/public/flags/*.png), downloaded once
 * so cards never depend on ESPN's CDN. Team names resolve to a country by
 * stripping squad suffixes (Women / Under-19s); unknown teams (leagues, new
 * nations) fall back to whatever remote logo URL the data carries.
 */

const FLAG_SLUGS = new Set([
  'afghanistan', 'argentina', 'australia', 'austria', 'bahrain', 'bangladesh',
  'belgium', 'bhutan', 'brazil', 'bulgaria', 'canada', 'china', 'cyprus',
  'denmark', 'england', 'estonia', 'finland', 'france', 'germany', 'gibraltar',
  'greece', 'guernsey', 'hong-kong', 'hungary', 'india', 'indonesia', 'ireland',
  'isle-of-man', 'israel', 'italy', 'jersey', 'kuwait', 'luxembourg', 'malaysia',
  'malta', 'mexico', 'myanmar', 'namibia', 'nepal', 'netherlands', 'new-zealand',
  'norway', 'oman', 'pakistan', 'panama', 'peru', 'philippines', 'portugal',
  'qatar', 'romania', 'rwanda', 'saudi-arabia', 'scotland', 'serbia', 'singapore',
  'south-africa', 'spain', 'sri-lanka', 'sweden', 'switzerland', 'tanzania',
  'thailand', 'turkey', 'uganda', 'united-arab-emirates',
  'united-states-of-america', 'vanuatu', 'west-indies', 'zimbabwe',
])

/** Local flag path for a team name, or null when we don't have that country. */
export function countryFlag(teamName: string): string | null {
  const slug = teamName
    .replace(/\s+(Women|Under-19s?)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return FLAG_SLUGS.has(slug) ? `/flags/${slug}.png` : null
}

/**
 * The two flags for a match tag: local flags resolved from the team names in
 * the label ("Zimbabwe v India"), falling back per-team to the remote logos
 * stored on the tag.
 */
export function matchFlags(tag: { label: string; logos?: string[] }): string[] {
  const names = tag.label.split(/\s+vs?\s+/i)
  const remote = tag.logos ?? []
  const flags = names
    .map((name, i) => countryFlag(name.trim()) ?? remote[i] ?? null)
    .filter((f): f is string => Boolean(f))
  return flags.length ? flags : remote
}
