import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { CalendarRange, Film, Trophy, Sun, Moon } from 'lucide-react'

export default function Navbar() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem('weekadda-theme', next)
    } catch {
      // private mode: theme still applies for this visit
    }
  }

  return (
    <header className="navbar">
      <Link to="/movies" className="nav-brand">
        <CalendarRange size={26} />
        <span>
          Week<em>Adda</em>
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
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </header>
  )
}
