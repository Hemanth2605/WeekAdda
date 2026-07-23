# 🎬 WeekAdda — This Week in Movies, OTT & Cricket

A weekly entertainment portal for India. One place that answers: **what released this week?**
— movies in theatres, new arrivals on OTT platforms, upcoming films, and cricket results &
fixtures. Built-in agents sweep public data sources daily; everything is browsable
**week by week** going back ~3 months.

## What's inside

- 🎞 **Just Released** (`/movies`) — theatrical releases paged by week (This Week, Last Week,
  … up to 13 weeks back), segregated into horizontally-scrolling rows per language, with
  posters, ratings, and search.
- 📺 **OTT India** (default tab) — movies **and web series** that just arrived on JioHotstar, Amazon Prime
  Video, Netflix, Sony LIV, ZEE5, Aha and ETV Win — same weekly paging, platform badges,
  Movies / Web Series filter.
- 🔜 **Coming Soon** — two views: **In Theatres** (next 90 days) and **On OTT** (announced
  digital premieres for India, platform-tagged where known).
- 🏏 **Cricket** (`/cricket`) — lands on **Fixtures** banded **Today / This Week / Later**;
  **Results week by week** on the second tab. Grouped series by series with scores,
  winners, venues and self-hosted country flags. Series featuring India are always pinned
  first. Filter by International / Leagues & Domestic / All. **By design, no live
  scores** — completed results and upcoming fixtures only.
- ✍️ **Blog** (`/blog`) — visitors write their own takes and **tag the movie or match**
  they're talking about (poster or team flags shown on the card). No login: names are
  optional, blank posts publish as Anonymous. 3-column magazine grid, six-line clamp
  with read-more, and a falling letter-tile backdrop that fades away as you scroll into
  reading.
- 📤 **Sharing** — native share sheet on phones (WhatsApp, Telegram, Instagram, anything
  installed); a WhatsApp / Telegram / X / Instagram / Copy chooser on desktop.
- 📈 **Click tracking** — outbound Watch/Book/Scorecard/Share clicks are appended to a
  JSONL log with an aggregated stats endpoint (audience-proof for future platform deals).

## Tech stack

| Layer    | Tech                                                           |
| -------- | -------------------------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite, React Router, lucide-react icons |
| Backend  | Node.js + Express + TypeScript (tsx), node-cron, cheerio       |

No database locally — agents cache to JSON on disk under `backend/cache/` (blog posts
land in `blog.json`). Production uses Supabase (see Production below).

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
| POST   | `/api/track/click`      | Record an outbound Watch/Book/Scorecard/Share click (fire-and-forget) |
| GET    | `/api/track/stats`      | Aggregated click stats — totals, by platform/language/day, top titles |
| GET    | `/api/blog`             | Latest visitor posts (newest first, capped at 200) |
| POST   | `/api/blog`             | Publish a post: `{ author?, title, body, tag: { kind, id, label, sub, poster, logos? } }` |
| GET    | `/api/health`           | Liveness check |

## Project structure

```
backend/
  src/
    index.ts               # Express app, cron schedule, boot syncs
    routes/                # releases, cricket, track, blog
    agent/                 # releaseAgent, cricketAgent + data sources
    data/                  # built-in sample data (no-key fallback)
    worker.ts              # Cloudflare Worker: API + static assets + pre-render
    seo.ts                 # edge pre-render HTML blocks (crawler-facing content)
    queries.ts             # shared filter/sort/sanitize logic (Express + Worker)
  cache/                   # JSON caches, clicks.jsonl, blog.json
frontend/
  src/
    pages/                 # Releases.tsx, Cricket.tsx, Blog.tsx
    components/            # Navbar, Footer, ReleaseCard, ReleaseModal, ShareSheet
    seo.ts                 # per-view dynamic titles/descriptions
    flags.ts               # team name → self-hosted country flag (ESPN fallback)
    watchLinks.ts          # outbound platform deep-links
  public/flags/            # 69 bundled country flags served from our own domain
```

## SEO

- **Edge pre-render** (`backend/src/seo.ts`, injected by the Worker): crawlers receive
  real content in the HTML, phrased the way people search — per-language sections like
  "Telugu OTT releases this week in India" and cricket sections like "India cricket
  match today". React replaces the block on mount; on any error the untouched page is
  served. Content refreshes automatically with each daily sweep.
- Full meta set in `frontend/index.html`: title, description, keywords, Open Graph, Twitter
  cards, canonical URL, robots directives, JSON-LD `WebSite` + `SearchAction`
- Per-view dynamic titles/descriptions (`src/seo.ts`) targeting real queries
- `public/robots.txt` and `public/sitemap.xml` (all four routes); real favicons in
  `public/` for search results and home-screen icons
- Verified in Google Search Console; the sitemap is submitted and re-read by Google
  automatically

## Production

Live at **https://weekadda.com** (the old workers.dev URL redirects there) — all
free tiers plus the domain:

- **Daily sweep**: GitHub Actions (`.github/workflows/sweep.yml`) at 6 AM IST runs the
  agents and pushes both caches to Supabase (manual run: Actions → Daily sweep →
  Run workflow)
- **Serving**: a Cloudflare Worker (`backend/src/worker.ts`) reads the Supabase caches,
  serves the built frontend as static assets, pre-renders crawler content into the
  HTML, and 301-redirects the legacy workers.dev host to weekadda.com
- **Database**: Supabase — schema in `supabase/schema.sql` (`caches`, `clicks`, `posts`);
  run new tables in the Supabase SQL Editor before deploying Worker code that uses them
- **Deploy app changes**: `cd frontend && npm run build && cd ../backend && npx wrangler deploy`

## Roadmap

- Per-post blog URLs (`/blog/:id`) with their own meta tags, so individual takes can
  rank in search and be shared directly
- A second daily sweep in the evening so cricket results land the same night
- Blog moderation / Google sign-in when traffic warrants it
- More sports beyond cricket (the weekly-results pattern generalizes)
