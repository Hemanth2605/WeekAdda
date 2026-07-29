import { useEffect, useState } from 'react'
import { api } from './api'
import { LANGUAGE_ORDER } from './languages'

/**
 * Home-language detection: the Worker's /api/geo says (coarsely, from the IP,
 * nothing stored) which country — and inside India which state — a visitor is
 * in, and that language's section moves to the top of every list. Karnataka
 * opens on Kannada, Kerala on Malayalam, Japan on Japanese; a country whose
 * language we don't carry gets English first; and when nothing is detected
 * the site's fixed order stands untouched.
 */

/** ISO 3166-2:IN state code → the language its audience mostly watches in. */
const REGION_LANG: Record<string, string> = {
  AP: 'te', // Andhra Pradesh
  TG: 'te', // Telangana
  TN: 'ta', // Tamil Nadu
  PY: 'ta', // Puducherry
  KA: 'kn', // Karnataka
  KL: 'ml', // Kerala
  LD: 'ml', // Lakshadweep
  MH: 'mr', // Maharashtra
  WB: 'bn', // West Bengal
  TR: 'bn', // Tripura
  PB: 'pa', // Punjab
  // The Hindi belt
  DL: 'hi',
  UP: 'hi',
  UT: 'hi',
  MP: 'hi',
  CT: 'hi',
  BR: 'hi',
  JH: 'hi',
  RJ: 'hi',
  HR: 'hi',
  HP: 'hi',
  // States whose main language we don't carry (Gujarat, Odisha, Assam, …)
  // are simply absent — they keep the default order.
}

/** Country → language, for the languages we actually carry. */
const COUNTRY_LANG: Record<string, string> = {
  JP: 'ja',
  KR: 'ko',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CO: 'es',
  CL: 'es',
  PE: 'es',
  VE: 'es',
  EC: 'es',
  GT: 'es',
  UY: 'es',
}

/**
 * Country → national cricket team, where the country's own English name is
 * not the team's name: the UK plays as England, Hong Kong's display name
 * carries "SAR China", and the Caribbean plays as West Indies. Every other
 * country's team IS its name — see homeTeam.
 */
const COUNTRY_TEAM: Record<string, string> = {
  GB: 'england',
  HK: 'hong kong',
  // The West Indies span many flags
  JM: 'west indies',
  TT: 'west indies',
  BB: 'west indies',
  GY: 'west indies',
  LC: 'west indies',
  GD: 'west indies',
  VC: 'west indies',
  AG: 'west indies',
  KN: 'west indies',
  DM: 'west indies',
}

export interface Geo {
  country: string | null
  region: string | null
}

/** The language this visitor most likely calls home, or null for "no idea". */
export function homeLanguage(geo: Geo): string | null {
  if (!geo.country) return null
  if (geo.country === 'IN') return (geo.region && REGION_LANG[geo.region]) || null
  // Anywhere outside India: their language if we carry it, else English
  return COUNTRY_LANG[geo.country] ?? 'en'
}

/**
 * The fixed display order with the home language promoted to the front.
 * A visitor abroad gets English right after their own language — so a week
 * with no Japanese releases leads with English in Tokyo, not Telugu.
 */
const INDIAN = new Set(['te', 'ta', 'hi', 'ml', 'kn', 'bn', 'mr', 'pa'])

export function orderWithHome(home: string | null): string[] {
  if (!home) return LANGUAGE_ORDER
  const head = INDIAN.has(home) ? [home] : [home, 'en']
  return [...new Set([...head, ...LANGUAGE_ORDER])]
}

/**
 * The national team this visitor's country follows, as a lowercase name
 * prefix to match ESPN team names against ("Argentina" covers "Argentina
 * Women"), or null for "no idea". Works for every country: the special map
 * first, else the country's own English name — Brazil's team is "Brazil".
 * The page falls back to India-first when the named team has no matches.
 */
export function homeTeam(geo: Geo): string | null {
  if (!geo.country) return null
  const special = COUNTRY_TEAM[geo.country]
  if (special) return special
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(geo.country)
    return name ? name.toLowerCase() : null
  } catch {
    return null
  }
}

const STORE_KEY = 'weekadda-geo'
const TTL_MS = 24 * 3600 * 1000

function cachedGeo(): Geo | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { geo: Geo; ts: number }
      if (Date.now() - saved.ts < TTL_MS) return saved.geo
    }
  } catch {
    // private mode — detect fresh each visit
  }
  return null
}

/**
 * Where the visitor is, cached for a day so the lookup is one request, not
 * one per page. Starts with the cached answer (or null) and never blocks
 * rendering — the ordering simply improves when the answer lands.
 */
export function useGeo(): Geo | null {
  const [geo, setGeo] = useState<Geo | null>(cachedGeo)

  useEffect(() => {
    if (cachedGeo()) return
    api<Geo>('/geo')
      .then((fresh) => {
        setGeo(fresh)
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ geo: fresh, ts: Date.now() }))
        } catch {
          // private mode — fine, it just re-detects next visit
        }
      })
      .catch(() => {
        // no answer = default order, which is always correct
      })
  }, [])

  return geo
}

/** The visitor's home movie language (see homeLanguage), ready to use. */
export function useHomeLanguage(): string | null {
  const geo = useGeo()
  return geo ? homeLanguage(geo) : null
}

/** The visitor's national cricket team (see homeTeam), ready to use. */
export function useHomeTeam(): string | null {
  const geo = useGeo()
  return geo ? homeTeam(geo) : null
}
