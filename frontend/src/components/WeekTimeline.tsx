import { useEffect, useRef } from 'react'

// Mirrors the backend's isoDaysAgo (UTC day), so chip dates always agree with
// the week ranges the API serves
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * The week history as a scrollable timeline of labelled chips — oldest on the
 * left, This Week on the right, time flowing the way calendars do. Replaces
 * the anonymous dot strip: every week is a readable, tappable target, the
 * active one centres itself, and it works on phones instead of hiding.
 */
export default function WeekTimeline({
  weeks,
  week,
  onPick,
}: {
  weeks: number
  week: number
  onPick: (w: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // Keep the chosen week centred; scroll only the track, never the page
  useEffect(() => {
    const track = trackRef.current
    const chip = activeRef.current
    if (!track || !chip) return
    track.scrollTo({
      left: chip.offsetLeft - (track.clientWidth - chip.clientWidth) / 2,
      behavior: 'smooth',
    })
  }, [week])

  const label = (wi: number) =>
    wi === 0
      ? 'This Week'
      : wi === 1
        ? 'Last Week'
        : `${fmt(isoDaysAgo(wi * 7 + 6))} – ${fmt(isoDaysAgo(wi * 7))}`

  return (
    <div className="week-timeline" ref={trackRef} aria-label={`${weeks} weeks of history`}>
      {Array.from({ length: weeks }, (_, k) => weeks - 1 - k).map((wi) => (
        <button
          key={wi}
          ref={wi === week ? activeRef : undefined}
          className={`week-tl-chip${wi === week ? ' active' : ''}`}
          onClick={() => onPick(wi)}
          title={wi === 0 ? 'This Week' : wi === 1 ? 'Last Week' : `${wi} weeks ago`}
        >
          {label(wi)}
        </button>
      ))}
    </div>
  )
}
