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
        <Link to="/adda">Adda</Link>
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
      </nav>
      <p className="footer-credit">
        © {new Date().getFullYear()} WeekAdda · Built with{' '}
        <span className="footer-heart">❤️</span> by{' '}
        <a
          href="https://www.linkedin.com/in/hemanth-mareedu-a69271116/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Hemanth Mareedu
        </a>{' '}
        · Updated daily by the WeekAdda agent
      </p>
      <p className="footer-attribution">
        This product uses the{' '}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
          TMDB
        </a>{' '}
        API but is not endorsed or certified by TMDB. Cricket data via ESPN.
      </p>
    </footer>
  )
}
