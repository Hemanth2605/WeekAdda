# 🎬 WeekAdda — This Week in Movies, OTT & Cricket

A weekly entertainment portal for India. One place that answers: **what released this week?**
— movies in theatres, new arrivals on OTT platforms, upcoming films, and cricket results &
fixtures. Built-in agents sweep public data sources daily; everything is browsable
**week by week** going back ~3 months.

## What's inside

Every browse tab is its own URL, so each one can rank for its own search and a shared
link opens where the sender was.

- 📺 **OTT India** (`/movies`, the default) — movies **and web series** that just arrived on
  JioHotstar, Amazon Prime Video, Netflix, Sony LIV, ZEE5, Sun NXT, Apple TV, Aha and
  ETV Win — weekly paging, platform badges, Movies / Web Series filter (which, like the
  language filter, is remembered for next time). Anything **out today** keeps flipping
  its date tile over to a glowing green **New** and back, so the day's arrivals are
  findable in a grid of a hundred posters.
- 🎞 **Just Released** (`/movies/theatres`) — theatrical releases paged by week along a
  scrollable **week timeline** of labelled chips (This Week, Last Week, … up to 13 weeks
  back, oldest on the left), segregated into horizontally-scrolling rows per language —
  always **Telugu, Tamil, English, Hindi, Malayalam, Kannada** first, then the rest —
  with posters, ratings, and search.
- 🔜 **Coming Soon** (`/movies/upcoming`) — two views: **In Theatres** (next 90 days) and
  **On OTT** (announced digital premieres for India, platform-tagged where known).
  An upcoming OTT card carries **one badge, not two**: the platform in its brand
  colour with the timing on a dark bar beneath it — *Tomorrow*, *In 6 days*, or the
  date itself once a countdown stops meaning anything.
- 📡 **A page per platform** (`/ott/netflix`, `/ott/prime-video`, `/ott/jiohotstar`,
  `/ott/sonyliv`, `/ott/zee5`, `/ott/sun-nxt`, `/ott/apple-tv`, `/ott/aha`) —
  everything that recently landed on one service, newest first, by language, plus
  what's announced next. Not week-paged: "what's on Netflix" is a standing question,
  where `/movies` answers "what arrived this week". A hub with fewer than three
  titles still works for anyone who visits but is kept out of the index until it has
  something to say.
- 🏏 **Cricket** (`/cricket`) — lands on **Fixtures** banded **Today / This Week / Later**;
  **Results week by week** at `/cricket/results`. Grouped series by series with scores,
  winners, venues and self-hosted country flags. Series featuring India are always pinned
  first. Filter by International / Leagues & Domestic / All. **By design, no live
  scores** — completed results and upcoming fixtures only.
- 🔗 **Per-title pages** (`/movie/:id/:slug`) — every movie and web series in the caches
  gets its own shareable page: poster, release dates, platforms with Watch/Book links,
  rating, and more releases in the same language. Reached from each release's modal
  ("Full page") and crawled by search engines via the sitemap.
- ✍️ **Reviews** (`/reviews`) — visitors write their own reviews and **tag the movie or match**
  they're talking about (poster or team flags shown on the card), each with a 5-star
  **rating**. The full take opens in a modal, and every review also has **its own page**
  (`/review/:id/:slug`) carrying related takes — other opinions on the same title first.
  Reading is open to all; **publishing or rating needs a one-click Google sign-in**
  (keeps it spam-free — display names stay self-chosen). Writers can **edit or delete
  their own** reviews, and `/my-reviews` collects everything they've written with
  search, Movies/Cricket filters and Newest / Oldest / Best-rated sorting.
- 📰 **Articles** (`/article/:id/:slug`) — the other kind of writing: the pieces with no
  release date to hang on. The 1983 World Cup final, a best-of-the-decade list, an old
  film worth another look. **Deliberately kept apart from reviews** — a review answers
  "is this week's film worth it" and would bury an article within a week — so they live
  in a rail beside the reviews feed rather than in it, and have their own store, pages
  and composer. An article carries an optional **cover image** (re-framed after upload
  by dragging a focal point, no re-encoding), a **Where to watch** list whose platform
  badges sit beside each film *where the prose names it*, and a **heart** — a like, not
  a rating, celebrated with a small burst on the first one. Pasted links render as the
  service's own button (Netflix, Prime Video, JioHotstar, Sun NXT, YouTube and more).
  Pieces published from the owner account carry a **✓ WeekAdda** stamp, which reads a
  server-set flag rather than the author name — the byline itself is reserved, so nobody
  else can wear it. `/my-articles` does for articles what `/my-reviews` does for reviews.
- 🤝 **The Adda** (`/adda`) — a community board to **ask, offer and find company**: a
  spare ticket at face value, a movie plan that needs one more person, an honest
  question for fellow fans. Anyone can read; posting or clicking **"I'm interested"**
  needs Google sign-in, and contact details (email, optional WhatsApp) are then shared
  **mutually and only between the two people**. Posters can close a listing; anything
  older than 30 days auto-expires. House rules keep it clean (nothing against any
  service's terms, tickets at face value only).
- 👤 **About & Privacy** (`/about`, `/privacy`) — the founder story and a plain-language
  privacy policy (what's collected, why, and who can see it).
- 📍 **Your language and your team, first** — the page opens on what the visitor
  actually watches. Cloudflare knows each request's country (and Indian state) from the
  IP, so **Karnataka lands on Kannada**, Kerala on Malayalam, Tamil Nadu on Tamil, the
  Hindi belt on Hindi; **Japan on Japanese**, Spain on Spanish, and anywhere abroad whose
  language we don't carry on **English**. Cricket does the same by country: **Australia
  sees Australia's series pinned first**, Pakistan sees Pakistan's. Everything else keeps
  the site's fixed order (Telugu, Tamil, English, Hindi, Malayalam, Kannada, then the
  rest) and India-first cricket — which is also the answer when the country has no
  matches that week, when the state's language isn't one we carry, and when nothing is
  detected at all. **No permission prompt, no coordinates, nothing stored**: it's a
  coarse IP lookup the edge already did, cached in the browser for a day.
- 🪟 **Mini player** — a floating picture-in-picture slideshow on Movies, Cricket,
  Reviews and the Adda that plays whatever the page is showing — movie posters, match
  cards with team flags and who won, reviews with their star rating, open Adda posts —
  while the viewer does other things. Desktop Chrome/Edge get a fully clickable window
  (‹ › arrows to step, an end card offering the adjacent weeks); everywhere else a
  canvas-drawn video PiP with the system's ⏮ ⏭ controls. The button hides itself when
  the page has nothing to play or the browser has no PiP at all.
  **A click lands on the thing that was showing**, not the page it came from: a film
  opens its own page, a review opens itself in the reader, and a match or Adda post
  scrolls into the middle of the screen with a ring drawn round it. Those are real
  URLs (`/cricket/results?match=…`, `/adda?post=…`, `/reviews?review=…`), so they can
  be shared as they are.
- ⬆️ **Back to top** — a floating arrow fades in after a screen of scrolling on every
  page, stacked above the mini-player button as one bottom-right control column.
- 📤 **Sharing** — native share sheet on phones (WhatsApp, Telegram, Instagram, anything
  installed); a WhatsApp / Telegram / X / Instagram / Copy chooser on desktop. Every
  page (including per-title movie pages) carries its own Open Graph tags, so shared
  links preview with the right title, description and poster.
- 📈 **Click tracking** — outbound Watch/Book/Scorecard/Share clicks are logged with an
  anonymous per-browser visitor id (and the signed-in account when present); the
  aggregated stats endpoint reports unique visitors and popular titles. Emails never
  leave the server.
- 🔔 **Release notifications** — tap **Keep me posted**, pick your languages, and get a
  browser notification **at 9 AM your own time, only on days something actually arrives
  in one of them**. Silence on quiet days is the feature, not a fault — arrivals cluster,
  and a daily digest regardless of content is the fastest way to be switched off.
  **Anonymous**: a push endpoint is issued by the browser vendor, so there is no account,
  no email and no visitor id — browsing stays as account-free as everything else. The
  browser reports its timezone at subscribe time, so Hyderabad and New Jersey each hear at
  their own breakfast. iPhones only receive Web Push once the site is added to the Home
  Screen, so the button feature-detects itself away there rather than promising something
  that cannot work. Design and rules in `PUSH-PLAN.md`.
  On a first visit a card asks once, a few seconds in — **our card, never the browser's
  dialog**. That distinction is the design: a reflexive "no" to the browser is permanent
  and can never be asked again, while **"Not now" here means a week**. The real
  permission call still only ever happens from a tap, after the language picker.
- 🔒 **Owner dashboard** (`/stats`) — a private view of those clicks: totals and today
  (clicks, unique visitors, signed-in accounts), member counts, a 14-day chart and
  breakdowns by action, platform, language and title. Days bucket in **IST**, since
  "today" has to mean today in India. Not part of the app — no nav link, absent from the
  sitemap, `Disallow`ed and `noindex`ed. **Access is enforced server-side, not by the
  unlisted URL**: the endpoint verifies the Google token against `OWNER_EMAIL` and fails
  closed, so an unset variable locks everyone out rather than letting everyone in.
  Counts only — no visitor email is ever returned.

## Tech stack

| Layer    | Tech                                                           |
| -------- | -------------------------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite, React Router, lucide-react icons |
| Backend  | Node.js + Express + TypeScript (tsx), node-cron, cheerio       |

No database locally — agents cache to JSON on disk under `backend/cache/` (visitor
content in `blog.json`, `ratings.json`, `adda.json`). Production uses Supabase (see
Production below). **Google sign-in** for writing is optional: set `GOOGLE_CLIENT_ID`
(backend) and `VITE_GOOGLE_CLIENT_ID` (frontend); without them, posting stays anonymous.

## The agents

Both run **daily at 4 AM** (node-cron) and on server start when their cache is stale.
Each also keeps a `POST /refresh` route for dev convenience; in production a manual
sweep is Actions → Daily sweep → Run workflow.

- 🤖 **Release agent** (`backend/src/agent/releaseAgent.ts`) — sweeps **12 languages**
  (Hindi, Telugu, Tamil, Malayalam, Kannada, Bengali, Marathi, Punjabi, English, Korean,
  Japanese, Spanish) covering **13 weeks of history + 90 days ahead**. Sources, merged with
  title de-duplication:
  - **TMDB** — posters, ratings, digital release dates, watch providers. Only the largest
    services get a provider link, so for anything still unlabelled the agent reads the
    platform out of the free-text note on the India digital release date ("ZEE5",
    "Streaming On Zee5") — which is how most regional titles get a platform at all
  - **Wikipedia per-language film lists** ("List of Telugu films of 2026" …) — catches
    regional releases TMDB misses; fetches are serialized with a polite delay
  - **Wikipedia platform-originals pages** (`wikipediaOttSource.ts`) — how Aha and ETV Win
    titles appear even though TMDB doesn't cover them
  - **Watchmode** (`watchmodeSource.ts`, optional key) — catalog *additions* (licensed
    content a platform just added), skipped silently when no key is set
  - **Two honesty passes at the end**: a film whose only release is its OTT premiere
    (same TMDB id premiering digitally within a week of its "theatrical" date) is kept
    out of the theatre lists — TMDB's discover has no release-type filter, so ZEE5 web
    series were showing as upcoming theatre releases; and a same-day title that is a
    prefix of another ("KJQ" vs "KJQ: King Jackie Queen") enters once, not twice
- 🏏 **Cricket agent** (`backend/src/agent/cricketAgent.ts`) — sweeps ESPN's public cricket
  scoreboard JSON (no key needed), every active league month by month. ESPN only lists
  *current* leagues, so the cache **accumulates**: past weeks keep filling up from launch
  day and finished series stay until they age out of the 13-week window. ESPN's
  scoreboard feed marks winners with the **strings** `"true"`/`"false"` (its other feeds
  use booleans) — the agent parses them strictly, and when ESPN itself crowns both
  teams, it highlights neither rather than the wrong one.

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
| `GOOGLE_CLIENT_ID`  | No       | Google sign-in for blog/Adda writes (anonymous without it); frontend needs the same value as `VITE_GOOGLE_CLIENT_ID` in `frontend/.env` |
| `OWNER_EMAIL`       | No       | Who may open `/stats` (comma-separated list allowed). Unset = closed to everyone |
| `VAPID_PUBLIC_KEY`  | No       | Web Push. Also needed by the frontend as `VITE_VAPID_PUBLIC_KEY` — public by design |
| `VAPID_PRIVATE_KEY` | No       | Signs push messages. **Secret** — a GitHub Actions secret in production, never in the frontend |
| `VAPID_SUBJECT`     | No       | `mailto:` contact the push services use to reach you. Unset keys = no button, no sending |
| `PORT`              | No       | API port, defaults to `4000`                       |

`tsx watch` restarts on source edits, **not** on `.env` edits — after adding a variable,
restart the backend or the running process keeps the old environment. Boot logs whether
`/stats` is open, so this is visible.

Cricket needs no key.

## API overview

| Method | Route                   | Description |
| ------ | ----------------------- | ----------- |
| GET    | `/api/releases`         | `?window=released\|ott\|upcoming` `&week=0..12` `&language=te` `&search=` `&contentType=movie\|series` `&source=ott` (upcoming OTT view) |
| POST   | `/api/releases/refresh` | Wake the release agent for an immediate sweep |
| GET    | `/api/title/:id`        | One release by id (any pool) + status (`streaming`, `upcoming-ott`, `in-theatres`, `upcoming-theatre`) + same-language related titles — feeds `/movie/:id/:slug` |
| GET    | `/api/ott/:slug`        | One platform's titles — `{ platform, streaming[], upcoming[], indexable }`, newest first. Feeds `/ott/:slug`; an unknown slug is a 404, not an empty page |
| GET    | `/api/cricket`          | `?window=recent\|upcoming` `&week=0..12` `&type=international\|league\|all` `&search=` |
| POST   | `/api/cricket/refresh`  | Wake the cricket agent for an immediate sweep |
| POST   | `/api/track/click`      | Record an outbound Watch/Book/Scorecard/Share click (fire-and-forget) |
| GET    | `/api/track/stats`      | Aggregated click + member stats for `/stats` — **owner only** (Bearer token checked against `OWNER_EMAIL`; 401 unsigned, 403 otherwise) |
| GET    | `/api/blog`             | Latest visitor posts (newest first, capped at 200) |
| POST   | `/api/blog`             | Publish a post (Google `Authorization: Bearer` when configured): `{ author?, title, body, tag: { kind, id, label, sub, poster, logos? } }` |
| GET    | `/api/blog/mine`        | The signed-in user's own posts (Bearer token required) |
| GET    | `/api/blog/ratings`     | Per-post rating summaries `{ avg, count, mine? }` (a token adds the viewer's own rating) |
| POST   | `/api/blog/rate`        | Rate a post 1–5 (Bearer required; one per account, upsert; no self-rating) |
| GET    | `/api/blog/:id`         | One review + the related row under it — feeds `/review/:id/:slug` |
| PATCH  | `/api/blog/:id`         | Edit your own review (Bearer required). Someone else's answers **404**, never 403 |
| DELETE | `/api/blog/:id`         | Delete your own review, and its ratings with it (Bearer required) |
| GET    | `/api/articles`         | Latest articles (newest first, capped at 200) |
| POST   | `/api/articles`         | Publish an article (Bearer when configured): `{ author?, title, body, topic, films?, image?, imagePosition?, imageFit? }` |
| GET    | `/api/articles/mine`    | Your own articles + `owner` — whether this account may publish under the WeekAdda byline |
| GET    | `/api/articles/likes`   | Per-article like counts `{ count, mine? }`; counts are public, a token adds your own |
| POST   | `/api/articles/:id/like`| Toggle the heart (Bearer required; one per account, no liking your own) |
| POST   | `/api/articles/image`   | Upload a cover — raw body, own `Content-Type`, JPEG/PNG/WebP/AVIF/GIF, 4 MB cap, sign-in required |
| GET    | `/api/articles/:id`     | One article + the related rail beside it |
| PATCH  | `/api/articles/:id`     | Edit your own article. Identity (id, timestamp, author, stamp) is not editable |
| DELETE | `/api/articles/:id`     | Delete your own article |
| GET    | `/api/adda`             | Open board listings (a token also reveals your own + contacts you've unlocked) |
| POST   | `/api/adda`             | Post a listing (Bearer required): `{ title, details, author?, whatsapp? }` |
| POST   | `/api/adda/:id/interest`| Express interest (Bearer required) — returns the poster's contact |
| POST   | `/api/adda/:id/close`   | Close your own listing (Bearer required) |
| POST   | `/api/push/subscribe`   | Store a browser's release-notification registration: `{ subscription, languages[], timezone? }`. No account, no email |
| POST   | `/api/push/unsubscribe` | Forget it: `{ endpoint }` |
| GET    | `/api/geo`              | The visitor's coarse country + Indian state, from the edge's own IP lookup — the app puts their language and national team first. `no-store` (per-visitor), `?force=IN-KA` for testing, and `{ null, null }` in local dev |
| GET    | `/api/health`           | Liveness check |

## Project structure

```
backend/
  src/
    index.ts               # Express app, cron schedule, boot syncs
    routes/                # releases, cricket, track, blog, adda, push
    agent/                 # releaseAgent, cricketAgent + data sources
    data/                  # built-in sample data (no-key fallback)
    worker.ts              # Cloudflare Worker: API + static assets + pre-render
    seo.ts                 # edge pre-render + per-route meta/OG (crawler-facing)
    queries.ts             # shared filter/sort/sanitize/auth logic (Express + Worker)
    sweep.ts               # the daily gather (GitHub Actions)
    notify.ts              # the hourly send, separate from the sweep
    pushSender.ts          # Web Push via VAPID; 9 AM in each subscriber's zone
  cache/                   # JSON caches, clicks.jsonl, blog.json, ratings.json, adda.json,
                           #   articles.json, article-likes.json, uploads/ (local covers)
frontend/
  src/
    pages/                 # Releases, Cricket, Reviews, MovieDetail, PlatformHub (/ott/:slug),
                           #   Adda, About, Privacy, Stats,
                           #   ReviewDetail + ArticleDetail (one piece per page),
                           #   MyReviews + MyArticles (your own work, searchable and sortable)
    components/            # Navbar, Footer, ReleaseCard, ReleaseModal, ShareSheet, GoogleButton,
                           #   NotifyBell / NotifyCard / NotifySheet / NotifyPrompt, BackToTop,
                           #   PipShow (mini player), WeekTimeline (week chips), PlatformLinks,
                           #   ArticleIndex (the rail), ReviewBits (shared review pieces),
                           #   Prose (paragraphs + link-to-platform-button), LikeButton,
                           #   OfficialStamp, ArticleImagePicker, FilmWatchPicker, Skeletons
    filmLinks.ts           # which URL a platform badge points at; finds films named in prose
    platforms.ts           # the /ott hub list — mirrors OTT_PLATFORMS in backend queries.ts
    focusTarget.ts         # ?match= / ?post= → scroll that card into view and flash it
    geo.ts                 # country/state → home language + national team, one cached lookup
    auth.ts                # Google sign-in (token flow) + app-wide user state
    push.ts                # subscribe/unsubscribe + browser support detection
    seo.ts                 # usePageMeta — must mirror the Worker's routeMeta strings
    flags.ts               # team name → self-hosted country flag (ESPN fallback)
    watchLinks.ts          # outbound platform deep-links
  public/sw.js             # service worker: notifications only, deliberately no caching
  public/flags/            # 69 bundled country flags served from our own domain
.github/workflows/         # sweep.yml (daily) + notify.yml (9 AM per timezone)
supabase/schema.sql        # caches, clicks, posts, post_ratings, articles, article_likes,
                           #   listings, listing_interests, push_subscriptions
                           #   (+ the article-images Storage bucket, made by hand)
SEO-PLAN.md                # URL taxonomy roadmap + the four-place route coupling
PUSH-PLAN.md               # notification design, send rules and deploy order
```

## SEO

- **Edge pre-render** (`backend/src/seo.ts`, injected by the Worker): crawlers receive
  real content in the HTML, phrased the way people search — OTT sections first
  ("Telugu OTT releases this week in India", "New web series on OTT this week",
  upcoming OTT/theatre release dates) and cricket sections like "India cricket match
  today" and per-series "India vs X — next match, date & schedule" with IST times.
  React replaces the block on mount; on any error the untouched page is served.
  Content refreshes automatically with each daily sweep.
- **A page per intent, not per tab**: `/movies`, `/movies/theatres`, `/movies/upcoming`,
  `/cricket`, `/cricket/results` and the eight `/ott/<platform>` hubs each get their
  **own** pre-rendered block, title and canonical — URLs sharing one block would have
  Google pick one and drop the rest, which is worse than not splitting at all.
  `SEO-PLAN.md` holds the wider taxonomy (per-language hubs are next), the
  index-hygiene thresholds, and the **four places** a new route must be registered
  before it is reachable.
- **Index hygiene is enforced, not just written down**: a platform hub with fewer than
  three titles is served normally but sent `X-Robots-Tag: noindex, follow` and omitted
  from the sitemap, so a page with one film on it never drags the domain down. The
  Worker and `buildSitemap` read the same `indexable` flag, so the two cannot drift.
- **Hubs are linked, not just listed**: `/movies` carries a real `<a href>` row into the
  platform hubs in both the pre-render and the app, and every hub links to the other
  seven — eight pages that only the sitemap knows about are eight orphans. In the UI
  they are text links rather than filter chips on purpose: the chips beside them filter
  the list in place, these leave the page, and one shape for both promises the wrong
  thing.
- **A skeleton while the bundle boots**: the pre-render is crawler copy, so on a slow
  phone it flashed as an unstyled text document before React mounted. The Worker injects
  a shimmer ahead of it (reusing the app's own `.sk` classes) and hides the copy during
  parse. Crawlers that don't execute JS still get the full text.
- **One host, one scheme**: `www`, the legacy workers.dev host and plain `http` all
  redirect to `https://weekadda.com`. Not just tidiness — a second origin breaks Google
  sign-in (`origin_mismatch`) and splits `localStorage`, so signed-in clicks were
  recording anonymously.
- **Real 404s**: paths the app doesn't have (`/wp-login.php`, typos) return 404 instead
  of the SPA shell, so bot probes and mistyped URLs stop looking like indexable pages.
  The same applies to an **id that resolves to nothing** — `/movie/`, `/review/` and
  `/article/` with a dead id serve the app's not-found state with a 404 status rather
  than a 200 empty page, which Google would index and keep returning to.
- **A page per piece of writing**: every review (`/review/:id/:slug`) and every article
  (`/article/:id/:slug`) is pre-rendered in full with `Article`/`Review` and breadcrumb
  JSON-LD, `og:type: article`, the cover as `og:image` where there is one, and its own
  entry in the sitemap dated by the piece's own timestamp — not the sweep's, since a
  take written weeks ago did not change because the release cache refreshed.
- **Nothing is reachable only from the sitemap**: `/reviews` links every article in its
  pre-render, each article links its related ones, and each review links the other takes
  on the same title. A page only the sitemap knows about is an orphan.
- **Personal pages are kept out**: `/my-reviews`, `/my-articles` and `/stats` are real
  pages that are empty for anyone but their owner, so the Worker serves them
  `noindex, nofollow` and `buildSitemap` never lists them.
- **Per-title pages** (`/movie/:id/:slug`, built by `buildTitlePage`): the first line
  answers the query ("*X* is streaming on Netflix — OTT release date …"), with
  Movie/TVSeries JSON-LD (poster + aggregate rating) and per-title canonical. Titles
  age out with the cache window and then 404 out of the index.
- **Dynamic sitemap**: `/sitemap.xml` is generated by the Worker (`buildSitemap`) —
  the static routes (incl. /adda, /about, /privacy), every platform hub that clears the
  threshold, every current title page (~1,200 URLs), and every review and article,
  each dated by its own timestamp rather than the sweep's. There is deliberately **no
  static `public/sitemap.xml`**: it was a snapshot that could only ever go stale,
  shipped as a real asset and hidden only by the Worker intercepting the path first.
- The Worker stamps route-specific `<title>`/description/canonical **and Open Graph +
  Twitter tags** into the raw HTML (`routeMeta`; movie pages get the poster as
  `og:image`), so shared links preview the right page. The SPA then sets the **same**
  strings at runtime (`usePageMeta`) — two systems write these tags, the Worker's copy
  being what social scrapers read and React's what Google's rendering pass reads, so
  they must match exactly or one URL advertises two titles. Nothing is keyed on state
  that isn't in the URL. Titles stay within ~65 chars, descriptions within 160.
- **Structured data lives in `<head>`, never inside `<div id="root">`** — React empties
  the root on mount, so schema injected there exists in the raw HTML and is gone the
  moment the bundle boots, while Google's *rendering* pass is what decides rich results.
  The Worker lifts every `ld+json` tag out of the injected block. Related rule: never add
  a schema field just to answer a Search Console warning — `performer` and `superEvent`
  each turned a harmless suggestion into a validation error, and `organizer`/`offers`
  stay unanswered because we don't know the board and don't sell tickets.
- Full meta set in `frontend/index.html` (OTT-first): description, keywords, Open
  Graph, Twitter cards, robots directives, JSON-LD `WebSite` + `SearchAction`
- `public/robots.txt`; real favicons in `public/` for search results and home-screen icons
- Verified in Google Search Console and imported into Bing Webmaster Tools (which
  feeds ChatGPT/Copilot/DuckDuckGo); sitemaps submitted in both

## Production

Live at **https://weekadda.com** (the old workers.dev URL redirects there) — all
free tiers plus the domain:

- **Daily sweep**: GitHub Actions (`.github/workflows/sweep.yml`) at 4 AM IST runs the
  agents and pushes both caches to Supabase (manual run: Actions → Daily sweep →
  Run workflow)
- **Release notifications**: a separate workflow (`notify.yml`) because 6 AM is when the
  sources settle, not when anyone wants waking. It runs the hours India and the US need —
  03:30 UTC, then 13:00–19:00, a union that covers both daylight and standard time so
  nothing changes twice a year — and sends only to subscribers whose own clock reads 9.
  Anyone elsewhere takes the first of those runs landing in their daytime. A guard checks
  Supabase before installing anything, so runs with nobody to serve exit in seconds.
  GitHub's scheduler is not punctual, so the sender accepts a two-hour window
- **Serving**: a Cloudflare Worker (`backend/src/worker.ts`) reads the Supabase caches,
  serves the built frontend as static assets, pre-renders crawler content into the HTML,
  redirects the `www` and legacy workers.dev hosts to weekadda.com, and sets security
  headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) on
  every response
- **Geo personalization needs the edge**: `/api/geo` reads `request.cf` (country +
  `regionCode`), which only exists in production — locally it answers `{ null, null }`
  and the default order applies. The **pre-render deliberately keeps the canonical
  order**: HTML is cached per URL at the edge, so a personalized block would be served
  to the wrong visitor and to crawlers. Personalization is the SPA's job, after mount.
- **After a deploy that changes HTML, purge the Cloudflare cache** (Caching →
  Configuration → Purge Everything). Deploying does not evict cached pages, so the edge
  keeps serving the previous HTML — including to Googlebot. Hashed JS/CSS filenames are
  immune; it's HTML, which reuses its URL, that goes stale.
- **Database**: Supabase — schema in `supabase/schema.sql` (`caches`, `clicks`,
  `posts`, `post_ratings`, `listings`, `listing_interests`); run new tables/columns in
  the Supabase SQL Editor before deploying Worker code that uses them
- **Auth**: `GOOGLE_CLIENT_ID` is a plaintext Worker var in `wrangler.jsonc` (OAuth
  client IDs are public), so it deploys with the Worker — no `wrangler secret put`. The
  same value must be in `frontend/.env` as `VITE_GOOGLE_CLIENT_ID` at build time. Set
  the OAuth consent screen's privacy-policy link to `https://weekadda.com/privacy`.
  Authorized JavaScript origins should list **only** `https://weekadda.com` — every
  other host redirects there, so no other origin ever needs a token.
- **`OWNER_EMAIL` is a Worker secret**, not a var — unlike the client id it's a personal
  address and this repo is public: `npx wrangler secret put OWNER_EMAIL`. Until it's
  set, `/stats` is closed to everyone including the owner.
- **Deploy app changes**: `cd frontend && npm run build && cd ../backend && npx wrangler deploy`

## Roadmap

- Per-language hubs (`/movies/telugu`, `/movies/hindi`, …) on the platform-hub pattern —
  SEO-PLAN.md Tier 3
- IndexNow pings after each sweep so Bing indexes new title pages the same day
- Per-series cricket pages (`/cricket/india-vs-australia`) on the movie-page pattern
- A verdict-out-of-five field in the review composer — the one thing that would make
  `reviewRating` honest and unlock star snippets. Today's five stars measure how useful
  readers found the *review*, not the writer's verdict on the film, so mapping them
  would be inaccurate markup
- `dateModified` on articles, once an edit actually records a timestamp
- A visible "showing X first — change" control so a detected language/team can be
  overridden by hand (today the only override is the language filter itself)
- Per-week counts on the week timeline chips, so it's obvious which past weeks are worth
  opening
- Email notification to an Adda poster when someone responds (built then removed —
  revisit with a transactional-email key when the board sees real usage)
- A second daily sweep in the evening so cricket results land the same night
- Review/Adda moderation tools as traffic warrants it
- More sports beyond cricket (the weekly-results pattern generalizes)
