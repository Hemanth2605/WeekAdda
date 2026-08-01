/**
 * Language-code labels, for the multi-language ("pan-India") films whose extra
 * languages arrive as bare ISO codes. Mirrors LANGUAGES in backend/src/queries.ts;
 * an unknown code falls back to itself rather than disappearing.
 */
const LABELS: Record<string, string> = {
  te: 'Telugu',
  hi: 'Hindi',
  ta: 'Tamil',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  pa: 'Punjabi',
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  es: 'Spanish',
}

export const languageLabel = (code: string) => LABELS[code] ?? code

/**
 * "Every language" — the filter chip's value, and what a notification
 * subscription stores when someone asks for the lot. Mirrors
 * ALL_LANGUAGES_CODE in backend/src/queries.ts.
 */
export const ALL_LANGUAGES = 'all'

/**
 * The fixed display order for language sections: Telugu, Tamil, English,
 * Hindi, Malayalam, Kannada; anything else follows, largest section first.
 * Mirrors `byLanguage` in backend/src/seo.ts — keep the two in step.
 */
export const LANGUAGE_ORDER = ['te', 'ta', 'en', 'hi', 'ml', 'kn']

/**
 * Every language a film can be watched in. Mirrors `releaseLanguages` in
 * backend/src/queries.ts: the field is absent on single-language films and on
 * any cache written before it existed, and the original language is the answer
 * in both cases.
 */
export const releaseLanguagesOf = (r: { language: string; languages?: string[] }) =>
  r.languages?.length ? r.languages : [r.language]

/**
 * "Hindi, Tamil and Malayalam" — the languages a pan-India film also plays in,
 * with its original dropped. Empty string when there are none, so callers can
 * test it directly.
 */
export function alsoInLabel(languages: string[] | undefined, original: string): string {
  const others = (languages ?? []).filter((c) => c !== original).map(languageLabel)
  if (others.length === 0) return ''
  if (others.length === 1) return others[0]
  return `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`
}
