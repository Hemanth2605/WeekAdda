import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * A month calendar in our own markup.
 *
 * `<input type="date">` was the obvious answer and it is the wrong one here:
 * the popup it opens is browser chrome, no stylesheet can reach inside it, and
 * `color-scheme` — the only lever CSS has — merely picks between the browser's
 * own light and dark. On a page this styled it always arrived looking like it
 * came from somewhere else.
 *
 * So this draws the grid itself. The trade is real and worth naming: we give up
 * the platform's locale handling and its mobile wheel, and take on the keyboard
 * and screen-reader work ourselves. For a field whose two commonest answers are
 * already one tap away as Today and Yesterday, that is a fair price.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Parsed as local noon: midnight plus a timezone shift lands on the day before. */
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12)
}

export default function DayPicker({
  value,
  max,
  onChange,
}: {
  value: string
  /** Latest selectable day, inclusive. Days after it are shown but dead. */
  max: string
  onChange: (day: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => fromIso(value))
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Reopening on a different month than the chosen day would be disorienting
  useEffect(() => {
    if (open) setView(fromIso(value))
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    // Monday-first, which is how a week is read here — getDay() is Sunday-first
    const lead = (first.getDay() + 6) % 7
    const count = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
    const cells: Array<{ day: string; label: number } | null> = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= count; d++) {
      cells.push({ day: iso(new Date(view.getFullYear(), view.getMonth(), d)), label: d })
    }
    return cells
  }, [view])

  const today = iso(new Date())
  const shown = fromIso(value)
  const label = shown.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="daypick" ref={wrapRef}>
      <button
        className={`log-date${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Change date — currently ${label}`}
      >
        <CalendarDays size={15} />
        {label}
      </button>

      {open && (
        <div className="daypick-pop" role="dialog" aria-label="Choose a date">
          <div className="daypick-head">
            <button
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1, 12))}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <b>
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </b>
            <button
              // Never past the month holding `max` — an empty grid of dead days
              // is a road to nowhere
              disabled={iso(new Date(view.getFullYear(), view.getMonth(), 1)) >= max.slice(0, 8) + '01'}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1, 12))}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="daypick-week" aria-hidden="true">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div className="daypick-grid">
            {days.map((cell, i) =>
              cell === null ? (
                <span key={`pad-${i}`} />
              ) : (
                <button
                  key={cell.day}
                  className={`daypick-day${cell.day === value ? ' picked' : ''}${
                    cell.day === today ? ' today' : ''
                  }`}
                  disabled={cell.day > max}
                  onClick={() => {
                    onChange(cell.day)
                    setOpen(false)
                  }}
                  aria-current={cell.day === value ? 'date' : undefined}
                >
                  {cell.label}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
