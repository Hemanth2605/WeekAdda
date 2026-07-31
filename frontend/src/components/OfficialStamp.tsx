import { BadgeCheck } from 'lucide-react'

/**
 * Marks an article as published by the site rather than by a visitor.
 *
 * It reads the server-set `official` flag, never the author name — a name is
 * typed, so it is evidence of nothing. `buildArticle` sets the flag from the
 * verified Google email against OWNER_EMAIL, and reserves the byline itself so
 * nobody else can wear it either.
 */
export default function OfficialStamp({ compact }: { compact?: boolean }) {
  return (
    <span
      className={`official-stamp${compact ? ' compact' : ''}`}
      title="Written and published by WeekAdda"
    >
      <BadgeCheck size={compact ? 11 : 13} />
      {compact ? 'WeekAdda' : 'Published by WeekAdda'}
    </span>
  )
}
