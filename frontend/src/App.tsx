import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Releases from './pages/Releases'
import MovieDetail from './pages/MovieDetail'
import PlatformHub from './pages/PlatformHub'
import About from './pages/About'
import Adda from './pages/Adda'
import Privacy from './pages/Privacy'
import Cricket from './pages/Cricket'
import Reviews from './pages/Reviews'
import Stats from './pages/Stats'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ShareSheet from './components/ShareSheet'
import NotifySheet from './components/NotifySheet'
import NotifyPrompt from './components/NotifyPrompt'
import BackToTop from './components/BackToTop'

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
      <NotifySheet />
      {/* Mounted outside the routes, so the landing ask is timed once per
          visit rather than restarting on every navigation */}
      <NotifyPrompt />
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<Releases />} />
        {/* Browse state lives in the URL, not in useState: each tab is its own
            indexable page, and a shared link opens where the sender was.
            Adding one here also needs SPA_ROUTES + SEO_PAGES in worker.ts and
            routeMeta + buildSitemap in seo.ts — see SEO-PLAN.md */}
        <Route path="/movies/:tab" element={<Releases />} />
        <Route path="/movie/:id" element={<MovieDetail />} />
        <Route path="/movie/:id/:slug" element={<MovieDetail />} />
        {/* One page per streaming service — the queries /movies cannot win.
            Unknown slugs 404 at the edge and redirect to /movies in the app;
            adding a platform means editing OTT_PLATFORMS in both queries.ts
            and platforms.ts. See SEO-PLAN.md, Tier 2. */}
        <Route path="/ott/:platform" element={<PlatformHub />} />
        <Route path="/cricket" element={<Cricket />} />
        <Route path="/cricket/:tab" element={<Cricket />} />
        <Route path="/reviews" element={<Reviews />} />
        {/* Renamed from /blog in July 2026 — the content was always reviews,
            and "review" is what people search. The Worker 301s the old path;
            this covers any in-app link still pointing at it. */}
        <Route path="/blog" element={<Navigate to="/reviews" replace />} />
        <Route path="/about" element={<About />} />
        <Route path="/adda" element={<Adda />} />
        <Route path="/privacy" element={<Privacy />} />
        {/* Owner-only click dashboard: intentionally unlinked from the app and
            gated server-side by OWNER_EMAIL — see pages/Stats.tsx */}
        <Route path="/stats" element={<Stats />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
      <BackToTop />
      <Footer />
    </>
  )
}
