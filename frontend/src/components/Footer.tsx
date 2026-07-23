import { Link } from 'react-router-dom'
import { CalendarRange } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <CalendarRange size={18} />
        <span>
          Week<em>Adda</em>
        </span>
      </div>
      <p>
        New movie releases this week across Hindi, Telugu, Tamil, Malayalam, Kannada, English
        and 12+ languages · OTT arrivals on Netflix, Amazon Prime Video, JioHotstar, Sony LIV,
        ZEE5 &amp; Aha · Upcoming films and digital premieres in India · Cricket match results
        week by week and upcoming fixtures across every series.
      </p>
      <nav aria-label="Footer">
        <Link to="/movies">Movies</Link>
        <Link to="/cricket">Cricket</Link>
        <Link to="/blog">Blog</Link>
      </nav>
      <p className="footer-credit">Movie &amp; OTT data from TMDB. Updated daily by the WeekAdda agent.</p>
    </footer>
  )
}
