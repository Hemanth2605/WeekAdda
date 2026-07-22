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

/** Ticket-booking links for films running in theatres (India). */
export function bookingUrls(title: string) {
  return [
    { label: 'BookMyShow', url: firstResult(`${title} movie site:in.bookmyshow.com`) },
    { label: 'District', url: firstResult(`${title} movie tickets site:district.in`) },
  ]
}
