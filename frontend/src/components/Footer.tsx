import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        {/* The mark, not a stand-in glyph — the same WA the tab, the header and
            the About page carry. The calendar the header dropped was still
            sitting down here, which made the footer look like another site. */}
        <span className="brand-ico sm" aria-hidden="true">
          WA
        </span>
        <span className="footer-word">
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
        <Link to="/reviews">Reviews</Link>
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
      {/* The streaming services are the marks most visible on the site — named
          on release cards, hubs, the film picker — and the TMDB line above says
          nothing about them. Naming a service to say where a film streams is
          ordinary descriptive use; this makes explicit what that use already
          implies, which is that none of them are involved in WeekAdda. */}
      <p className="footer-attribution">
        Platform names and marks are the property of their respective owners. WeekAdda is not
        affiliated with, endorsed by, or sponsored by any streaming service.
      </p>
    </footer>
  )
}
