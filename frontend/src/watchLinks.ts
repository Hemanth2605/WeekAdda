/**
 * "Watch now" / "Book tickets" links.
 *
 * Platforms with a stable public search URL (Netflix, Prime Video, ZEE5) link
 * there directly. The rest — including BookMyShow and District, which ignore
 * query params — go through DuckDuckGo's first-result redirect (the `\`
 * operator) scoped to the platform's domain: it lands on the exact title page.
 */

function firstResult(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent('\\' + query)}`
}

export function watchUrl(platform: string, title: string): string {
  const q = encodeURIComponent(title)
  switch (platform) {
    case 'Netflix':
      return `https://www.netflix.com/search?q=${q}`
    case 'Amazon Prime Video':
      return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`
    case 'ZEE5':
      return `https://www.zee5.com/search?q=${q}`
    case 'JioHotstar':
      return firstResult(`${title} site:jiohotstar.com`)
    case 'Sony LIV':
      return firstResult(`${title} site:sonyliv.com`)
    case 'Aha':
      return firstResult(`${title} site:aha.video`)
    case 'ETV Win':
      return firstResult(`${title} site:etvwin.com`)
    default:
      return firstResult(`watch ${title} on ${platform}`)
  }
}

/**
 * Ticket-booking links for films running in theatres (India).
 *
 * `language` is for pan-India films only, and is the language the viewer found
 * the film under: a Telugu-original playing in Hindi should open the Hindi
 * listing, not send someone to a show they cannot follow. Both sites list each
 * language separately, so naming it in the query is what picks the right page.
 *
 * Pass it only when it is genuinely meaningful. On a single-language film the
 * word adds nothing to a search that already resolves, and every extra term is
 * a chance for the redirect to land somewhere worse.
 */
export function bookingUrls(title: string, language?: string) {
  const lang = language ? ` ${language}` : ''
  return [
    { label: 'BookMyShow', url: firstResult(`${title}${lang} movie site:in.bookmyshow.com`) },
    { label: 'District', url: firstResult(`${title}${lang} movie tickets site:district.in`) },
  ]
}
