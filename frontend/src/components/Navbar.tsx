import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { Film, Trophy, Feather, HandHeart, Sun, Moon, LogOut } from 'lucide-react'
import { authEnabled, signOut, useGoogleUser } from '../auth'
import GoogleButton from './GoogleButton'
import NotifyBell from './NotifyBell'

export default function Navbar() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )
  const user = useGoogleUser()

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
        {/* The favicon's letters, not a glyph. The tab icon, the home-screen
            icon and this are one mark now — and letters survive being shrunk to
            16px in a way a calendar outline never did. */}
        <span className="brand-ico" aria-hidden="true">
          WA
        </span>
        <span className="brand-word">
          Week<em>Adda</em>
        </span>
      </Link>

      <nav className="nav-links" aria-label="Sections">
        <NavLink
          to="/movies"
          aria-label="Movies"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <span className="nav-ico ico-movies">
            <Film size={16} />
          </span>{' '}
          <span className="nav-link-label">Movies</span>
        </NavLink>
        <NavLink
          to="/cricket"
          aria-label="Cricket"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <span className="nav-ico ico-results">
            <Trophy size={16} />
          </span>{' '}
          <span className="nav-link-label">Cricket</span>
        </NavLink>
        <NavLink
          to="/reviews"
          aria-label="Reviews"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <span className="nav-ico ico-theatre">
            <Feather size={16} />
          </span>{' '}
          <span className="nav-link-label">Reviews</span>
        </NavLink>
        <NavLink
          to="/adda"
          aria-label="Adda"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <span className="nav-ico ico-adda">
            <HandHeart size={16} />
          </span>{' '}
          <span className="nav-link-label">Adda</span>
        </NavLink>
      </nav>

      <span className="nav-tagline">Movies · OTT · Cricket</span>
      {authEnabled &&
        (user ? (
          <span className="nav-user" title={`Signed in as ${user.email}`}>
            {user.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="nav-user-initial">{(user.name || user.email).charAt(0)}</span>
            )}
            <span className="nav-user-name">{user.name.split(' ')[0] || user.email}</span>
            <button className="nav-signout" onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </span>
        ) : (
          <GoogleButton small />
        ))}
      <NotifyBell />
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
