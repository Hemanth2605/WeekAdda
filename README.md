# 🎬 WeekAdda — This Week in Movies, OTT & Cricket

A weekly entertainment portal for India. One place that answers: **what released this week?**
— movies in theatres, new arrivals on OTT platforms, upcoming films, and cricket results &
fixtures. Built-in agents sweep public data sources daily; everything is browsable
**week by week** going back ~3 months.

## What's inside

- 🎞 **Just Released** (`/movies`) — theatrical releases paged by week (This Week, Last Week,
  … up to 13 weeks back), segregated into horizontally-scrolling rows per language, with
  posters, ratings, and search.
- 📺 **OTT India** — movies **and web series** that just arrived on JioHotstar, Amazon Prime
  Video, Netflix, Sony LIV, ZEE5, Aha and ETV Win — same weekly paging, platform badges,
  Movies / Web Series filter.
- 🔜 **Coming Soon** — two views: **In Theatres** (next 90 days) and **On OTT** (announced
  digital premieres for India, platform-tagged where known).
- 🏏 **Cricket** (`/cricket`) — match **results week by week** and **upcoming fixtures**,
  grouped series by series with scores, winners, venues and team logos. Series featuring
  India are always pinned first. Filter by International / Leagues & Domestic / All.
  **By design, no live scores** — the site shows completed results and upcoming fixtures
  only; in-progress matches appear once they finish.
- 📈 **Click tracking** — outbound Watch/Book/Scorecard clicks are appended to a JSONL log
  with an aggregated stats endpoint (audience-proof for future platform deals).

## Tech stack

| Layer    | Tech                                                           |
| -------- | -------------------------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite, React Router, lucide-react icons |
| Backend  | Node.js + Express + TypeScript (tsx), node-cron, cheerio       |

No database — each agent caches to JSON on disk under `backend/cache/`.

## The agents

Both run **daily at 6 AM** (node-cron) and on server start when their cache is stale.
A "Sync now" button on each page wakes them manually.

- 🤖 **Release agent** (`backend/src/agent/releaseAgent.ts`) — sweeps **12 languages**
  (Hindi, Telugu, Tamil, Malayalam, Kannada, Bengali, Marathi, Punjabi, English, Korean,
  Japanese, Spanish) covering **13 weeks of history + 90 days ahead**. Sources, merged with
  title de-duplication:
  - **TMDB** — posters, ratings, digital release dates, watch providers
  - **Wikipedia per-language film lists** ("List of Telugu films of 2026" …) — catches
    regional releases TMDB misses; fetches are serialized with a polite delay
  - **Wikipedia platform-originals pages** (`wikipediaOttSource.ts`) — how Aha and ETV Win
    titles appear even though TMDB doesn't cover them
  - **Watchmode** (`watchmodeSource.ts`, optional key) — catalog *additions* (licensed
    content a platform just added), skipped silently when no key is set
- 🏏 **Cricket agent** (`backend/src/agent/cricketAgent.ts`) — sweeps ESPN's public cricket
  scoreboard JSON (no key needed), every active league month by month. ESPN only lists
  *current* leagues, so the cache **accumulates**: past weeks keep filling up from launch
  day and finished series stay until they age out of the 13-week window.

Without any API key the app runs on built-in sample data, so it works out of the box.

## Getting started

Open two terminals:

```bash
# Terminal 1 — API (http://localhost:4000)
cd backend
npm install
npm run dev

# Terminal 2 — Web app (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173** — no sign-up, it lands straight on this week's releases.

### Go live with real movie data (2 minutes)

1. Create a free account at [themoviedb.org](https://www.themoviedb.org)
2. Settings → API → copy your **API Key (v3 auth)**
3. `cd backend` → copy `.env.example` to `.env` → set `TMDB_API_KEY=your_key`
4. Restart the backend — the agent syncs immediately, then daily

### Environment variables (`backend/.env`)

| Variable            | Required | Purpose                                            |
| ------------------- | -------- | -------------------------------------------------- |
| `TMDB_API_KEY`      | No       | Real movie/OTT data (sample data without it)       |
| `WATCHMODE_API_KEY` | No       | OTT catalog additions (source skipped without it)  |
| `PORT`              | No       | API port, defaults to `4000`                       |

Cricket needs no key.

## API overview

| Method | Route                   | Description |
| ------ | ----------------------- | ----------- |
| GET    | `/api/releases`         | `?window=released\|ott\|upcoming` `&week=0..12` `&language=te` `&search=` `&contentType=movie\|series` `&source=ott` (upcoming OTT view) |
| POST   | `/api/releases/refresh` | Wake the release agent for an immediate sweep |
| GET    | `/api/cricket`          | `?window=recent\|upcoming` `&week=0..12` `&type=international\|league\|all` `&search=` |
| POST   | `/api/cricket/refresh`  | Wake the cricket agent for an immediate sweep |
| POST   | `/api/track/click`      | Record an outbound Watch/Book/Scorecard click (fire-and-forget) |
| GET    | `/api/track/stats`      | Aggregated click stats — totals, by platform/language/day, top titles |
| GET    | `/api/health`           | Liveness check |

## Project structure

```
backend/
  src/
    index.ts               # Express app, cron schedule, boot syncs
    routes/                # releases, cricket, track
    agent/                 # releaseAgent, cricketAgent + data sources
    data/                  # built-in sample data (no-key fallback)
  cache/                   # JSON caches + clicks.jsonl (gitignore-worthy)
frontend/
  src/
    pages/                 # Releases.tsx, Cricket.tsx
    components/            # Navbar, Footer, ReleaseCard, ReleaseModal
    seo.ts                 # per-view dynamic titles/descriptions
    watchLinks.ts          # outbound platform deep-links
```

## SEO

- Full meta set in `frontend/index.html`: title, description, keywords, Open Graph, Twitter
  cards, canonical URL, robots directives, JSON-LD `WebSite` + `SearchAction`
- Per-view dynamic titles/descriptions (`src/seo.ts`) targeting real queries: "new movie
  releases this week", "OTT releases India", "cricket results", …
- `public/robots.txt` and `public/sitemap.xml` — replace the placeholder domain when
  deploying, along with the canonical/OG URLs in `index.html`
- For maximum crawlability, consider prerendering or SSR (e.g. Next.js) once live

## Production

Live at **https://weekadda.hemanth-mareedu8.workers.dev** — all free tiers:

- **Daily sweep**: GitHub Actions (`.github/workflows/sweep.yml`) at 6 AM IST runs the
  agents and pushes both caches to Supabase (manual run: Actions → Daily sweep →
  Run workflow)
- **Serving**: a Cloudflare Worker (`backend/src/worker.ts`) reads the Supabase caches
  and serves the built frontend as static assets
- **Database**: Supabase — schema in `supabase/schema.sql`
- **Deploy app changes**: `cd frontend && npm run build && cd ../backend && npx wrangler deploy`

## Roadmap

- More sports beyond cricket (the weekly-results pattern generalizes)
- Custom domain weekadda.com (SEO tags already point there), then SSR/prerender
- Google Search Console + sitemap submission once the domain is live
