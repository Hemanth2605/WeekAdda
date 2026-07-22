import { NavLink, Link } from 'react-router-dom'
import { Clapperboard, Film, Trophy } from 'lucide-react'

export default function Navbar() {
  return (
    <header className="navbar">
      <Link to="/movies" className="nav-brand">
        <Clapperboard size={26} />
        <span>
          Cine<em>Pitch</em>
        </span>
      </Link>

      <nav className="nav-links" aria-label="Sections">
        <NavLink
          to="/movies"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <Film size={16} /> Movies
        </NavLink>
        <NavLink
          to="/cricket"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <Trophy size={16} /> Cricket
        </NavLink>
      </nav>

      <span className="nav-tagline">Movies · OTT · Cricket</span>
    </header>
  )
}
