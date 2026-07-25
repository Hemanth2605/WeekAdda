import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Releases from './pages/Releases'
import MovieDetail from './pages/MovieDetail'
import About from './pages/About'
import Adda from './pages/Adda'
import Privacy from './pages/Privacy'
import Cricket from './pages/Cricket'
import Blog from './pages/Blog'
import Stats from './pages/Stats'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ShareSheet from './components/ShareSheet'

/** Start every page from the top when the route changes (SPA keeps scroll otherwise). */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Navbar />
      <ShareSheet />
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<Releases />} />
        <Route path="/movie/:id" element={<MovieDetail />} />
        <Route path="/movie/:id/:slug" element={<MovieDetail />} />
        <Route path="/cricket" element={<Cricket />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/about" element={<About />} />
        <Route path="/adda" element={<Adda />} />
        <Route path="/privacy" element={<Privacy />} />
        {/* Owner-only click dashboard: intentionally unlinked from the app and
            gated server-side by OWNER_EMAIL — see pages/Stats.tsx */}
        <Route path="/stats" element={<Stats />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
      <Footer />
    </>
  )
}
