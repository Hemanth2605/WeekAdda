import { Component, ComponentType, ReactNode, lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Releases from './pages/Releases'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ShareSheet from './components/ShareSheet'
import NotifySheet from './components/NotifySheet'
import NotifyPrompt from './components/NotifyPrompt'
import BackToTop from './components/BackToTop'

/**
 * Every page but the landing one is split out of the main bundle.
 *
 * `Releases` stays eagerly imported on purpose: it is where `/` sends everyone,
 * so lazy-loading it would put a second network round-trip in front of the
 * thing the largest-contentful-paint is measured on. Everything else is
 * fetched when someone actually goes there — the composer, the mini player's
 * heavier pages, the owner dashboard and the two personal pages were all being
 * downloaded by every first-time visitor who never opened them.
 */
/**
 * A lazy route that survives a deploy.
 *
 * Chunk filenames carry a content hash, so every deploy renames them. A browser
 * holding the previous index.html — an open tab, a page restored from bfcache,
 * an installed app resumed from the switcher — asks for names that are no
 * longer there. The import rejects, Suspense has no error boundary above it,
 * and React unmounts the entire tree: a blank page, not a broken route. It only
 * happens to people who were already here, which is why it looks intermittent.
 *
 * One reload fixes it, because the reload fetches a current index.html with the
 * current names. The flag makes it exactly one — a reload loop would be a worse
 * failure than the one being fixed — and a load that succeeds clears it, so the
 * next deploy is allowed its own retry.
 */
const RELOAD_KEY = 'weekadda-chunk-reload'

function route<T extends { default: ComponentType<Record<string, never>> }>(
  load: () => Promise<T>
) {
  return lazy<T['default']>(() =>
    load()
      .then((mod) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY)
        } catch {
          // private mode; the retry simply will not be remembered
        }
        return mod
      })
      .catch((err) => {
        let reloadedAlready = false
        try {
          reloadedAlready = sessionStorage.getItem(RELOAD_KEY) === '1'
          sessionStorage.setItem(RELOAD_KEY, '1')
        } catch {
          // cannot remember, so do not reload — better a caught error than a loop
          reloadedAlready = true
        }
        if (reloadedAlready) throw err
        window.location.reload()
        // The page is on its way out; never settle, so nothing renders in the
        // meantime and Suspense simply keeps showing the fallback
        return new Promise<T>(() => {})
      })
  )
}

const MovieDetail = route(() => import('./pages/MovieDetail'))
const PlatformHub = route(() => import('./pages/PlatformHub'))
const About = route(() => import('./pages/About'))
const Adda = route(() => import('./pages/Adda'))
const Privacy = route(() => import('./pages/Privacy'))
const Cricket = route(() => import('./pages/Cricket'))
const Reviews = route(() => import('./pages/Reviews'))
const ReviewDetail = route(() => import('./pages/ReviewDetail'))
const ArticleDetail = route(() => import('./pages/ArticleDetail'))
const AllArticles = route(() => import('./pages/AllArticles'))
const LogEntry = route(() => import('./pages/LogEntry'))
const MyArticles = route(() => import('./pages/MyArticles'))
const MyReviews = route(() => import('./pages/MyReviews'))
const Stats = route(() => import('./pages/Stats'))

/**
 * Shown only while a route's chunk is in flight — usually a few hundred
 * milliseconds on a cold navigation, nothing at all once cached. Deliberately
 * plain: a detailed skeleton here would guess at a layout it cannot know, and
 * each page already draws its own while its data loads.
 */
function RouteFallback() {
  return (
    <main className="route-loading" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="sk sk-line" style={{ width: '45%', height: 26 }} aria-hidden="true" />
      <div className="sk sk-line" style={{ width: '70%' }} aria-hidden="true" />
      <div className="sk sk-line" style={{ width: '60%' }} aria-hidden="true" />
    </main>
  )
}

/**
 * The last thing between a thrown error and a blank page.
 *
 * Without one, any error while rendering unmounts the whole tree — navbar,
 * footer and all — and leaves white. That is the worst possible failure for a
 * visitor: nothing to read, nothing to press, no way to tell a broken site from
 * a broken connection. The reload button matters as much as the message; it is
 * what someone will look for, and it is usually enough.
 *
 * Deliberately not a route-level boundary. An error in the navbar or a sheet is
 * just as capable of blanking the page as one in a route, and this catches
 * those too.
 */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="empty-state">
        <h3>Something went wrong on this page</h3>
        <p>
          Reloading usually fixes it — the site updates often, and a page left open
          across an update can end up asking for something that has moved.
        </p>
        <button className="share-wa" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </main>
    )
  }
}

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
    <Boundary>
      <ScrollToTop />
      <Navbar />
      <ShareSheet />
      <NotifySheet />
      {/* Mounted outside the routes, so the landing ask is timed once per
          visit rather than restarting on every navigation */}
      <NotifyPrompt />
      <Suspense fallback={<RouteFallback />}>
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
        {/* One review's own page — the feed can only show an opening, this is
            the whole take. Same id[/slug] shape as a title page; the Worker
            pre-renders it and buildSitemap lists it. */}
        <Route path="/review/:id" element={<ReviewDetail />} />
        <Route path="/review/:id/:slug" element={<ReviewDetail />} />
        {/* Articles: the writing with no release to hang on. Reachable from
            the rail beside the reviews feed, never from the feed itself. */}
        <Route path="/article/:id" element={<ArticleDetail />} />
        <Route path="/article/:id/:slug" element={<ArticleDetail />} />
        {/* Every article by everyone. Public and indexable, unlike the two
            /my-* pages below — the rail can only ever carry the newest few. */}
        <Route path="/articles" element={<AllArticles />} />
        {/* A writer's own body of work. Personal, not private — it only ever
            shows what the asking account wrote — but there is nothing here for
            a crawler, so the Worker serves it noindex. */}
        {/* One private log entry, in full. Never indexed — the Worker sends
            noindex for /log/:id, and it is empty for anyone but its owner. */}
        <Route path="/log/:id" element={<LogEntry />} />
        <Route path="/my-articles" element={<MyArticles />} />
        <Route path="/my-reviews" element={<MyReviews />} />
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
      </Suspense>
      <BackToTop />
      <Footer />
    </Boundary>
  )
}
