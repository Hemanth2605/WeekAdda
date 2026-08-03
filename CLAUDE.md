# WeekAdda — instructions for Claude Code

Weekly entertainment portal: movie releases, OTT arrivals in India, upcoming films, and
cricket results/fixtures. See `README.md` for the full feature and API overview.

## Commands

```bash
# Backend dev server (http://localhost:4000)
cd backend && npm run dev

# Frontend dev server (http://localhost:5173, proxies expect API on :4000)
cd frontend && npm run dev

# Typecheck
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Backend tests (vitest) — queries.ts and seo.ts, the two files both the
# Express app and the Worker run. No frontend suite yet.
cd backend && npm test

# Production frontend build
cd frontend && npm run build

# Responsive rules that never apply (reads the BUILT css — build first)
cd frontend && npm run check:css
```

## Architecture in one minute

- **Monorepo, no workspace tooling** — `backend/` and `frontend/` have independent
  `package.json`s; install and run each separately.
- **Local dev has no database.** Agents write JSON caches to `backend/cache/`
  (`releases.json`, `cricket.json`, `clicks.jsonl`; visitor content in `blog.json`).
  Deleting an agent cache file is safe — it regenerates on the next sync. `blog.json`
  holds real (or seeded test) posts and does NOT regenerate.
- **Two daily agents**: `releaseAgent.ts` (TMDB + Wikipedia film lists + Wikipedia OTT
  originals + optional Watchmode; at cache-build time it drops direct-to-OTT premieres
  from the theatre lists and skips same-day subtitle-variant duplicates — bump
  `SOURCES_VERSION` when sources or rules change so stale caches resweep on boot) and
  `cricketAgent.ts` (ESPN public scoreboard JSON, accumulating cache;
  `CRICKET_CACHE_VERSION` plays the same role). Locally node-cron runs them at 4 AM (`backend/src/index.ts`);
  each keeps a POST `/refresh` route for dev convenience (no UI button).
- **Per-platform hubs** (`/ott/<slug>`, July 2026 — SEO-PLAN Tier 2): eight pages,
  one per streaming service, for the queries `/movies` cannot win ("new movies on
  netflix india"). `OTT_PLATFORMS` + `queryPlatform` + `PLATFORM_MIN_TITLES` in
  `queries.ts` (the `name` must equal the label `releaseAgent` writes into
  `platforms` — that string is the join); `buildPlatformSeo`/`platformMeta` in
  `seo.ts`; `ottHubSlug` in `worker.ts` gates the route, the pre-render and
  `GET /api/ott/:slug`; page `PlatformHub.tsx`, list mirrored in
  `frontend/src/platforms.ts`. **Deliberately not week-paged** — a hub answers a
  standing question. A hub under 3 titles still serves but gets
  `X-Robots-Tag: noindex, follow` and is left out of `buildSitemap`; keep those
  two gates agreeing. Adding a platform means editing **both** platform lists.
- **Query logic is shared**: `backend/src/queries.ts` holds all filter/sort/stats logic
  and the cache types, used by both the Express routes and the Worker. Change behaviour
  there, never in just one of the two.
- **Frontend** is React 18 + Vite. Pages: `Releases.tsx` (defaults to the OTT India
  tab; tabs OTT/theatres/upcoming), a per-title detail page `MovieDetail.tsx` at
  /movie/:id/:slug fed by GET `/api/title/:id`, `Cricket.tsx` (defaults to Fixtures,
  banded Today / This Week / Later; Results is the second tab), `Reviews.tsx` (visitor
  posts tagged to a movie or match + 5-star ratings), `Adda.tsx` (community board,
  see below), plus `About.tsx` and `Privacy.tsx`. `App.tsx` has a `ScrollToTop` that
  resets scroll on every route change. Shared week-paging pattern: week 0 = last 7
  days, up to 13 weeks back. All API calls are relative `/api/...`.
- **Reviews** (page `/reviews`, renamed from `/blog` July 2026 — the content was
  always reviews and "review" is what people search; the Worker 301s the old path,
  and the **API, table, cache file and `.blog-*` CSS keep the old name on purpose**
  — renaming those is churn no visitor would ever see):
  `/api/blog` GET/POST (+ `/mine`, `/rate`, `/ratings`, and `/:id` for one
  review — declared **after** the literal paths in both Express and the Worker
  so none of them is read as an id), shared `buildPost`
  sanitizer in `queries.ts`; local store `backend/cache/blog.json` (+ `ratings.json`),
  production Supabase `posts` / `post_ratings` tables. `StarRow`/`TagLine`/`timeAgo`
  live in `components/ReviewBits.tsx` so the feed and the per-review page cannot
  drift into rendering the same review differently.
- **Articles** (`/article/:id/:slug`, `ArticleDetail.tsx`, July 2026): the second
  kind of writing — the 1983 final, a top-ten list, an old film revisited.
  **Not a variant of a review**: an article has no `tag`, so it gets its own
  `Article` type, its own `articles` table, its own `cache/articles.json` and its
  own `/api/articles` routes. That separation is the feature — "articles never
  mix into the reviews feed" is then true by construction rather than by a
  filter someone can forget. Filed under one `topic` (`movie` | `match`), which
  is all `relatedArticles` in `queries.ts` needs. **No star ratings** — see the
  ratings note below. The composer on `/reviews` switches between Review and
  Article (`.blog-mode`); articles get a 20 000-character body, reviews keep
  5 000. Pre-rendered by `buildArticlePage`, listed in `buildSitemap`, and
  linked from `buildBlogSeo` — those links are the **only** crawlable path to an
  article, so if that section stops rendering every article becomes an island.
  Adding the table needs `supabase/schema.sql` run by hand before deploying.
- **What an article carries beyond text** (all July 2026, all optional):
  - **A cover**, uploaded to the Supabase `article-images` bucket (local dev
    writes `cache/uploads/` and serves `/api/articles/image/:name`). Framed
    *after* upload by `imagePosition` (a CSS `object-position`) and `imageFit` —
    the bytes are never re-encoded, so re-framing is free and reversible. A
    portrait in a wide banner almost always needs the focal point moved up.
    Upload is **sign-in gated, 4 MB, five types**; the stored filename is
    generated, and the saved URL is re-validated even though we made it, because
    it comes back through the browser.
  - **`films[]`** — `{ id?, title, platforms: [{ name, url? }] }`. The platform
    is **stated, not looked up**: the release cache holds thirteen weeks and an
    article is usually about something far older, so no lookup would ever find
    it. `url` is the exact title page and beats the search `watchUrl` builds.
    Badges render *beside the film where the prose names it* (first mention, on
    a word boundary — or "83" matches inside "1983"); only films the prose never
    names fall through to a "Where to watch" block.
  - **A heart, not a rating** (`article_likes`): one per account, toggled, no
    liking your own, celebrated with a burst on the **first** like only. This is
    the one sanctioned exception to the no-ratings-elsewhere rule below —
    explicitly asked for, and a single count cannot be misread as a verdict on
    the film the way the review stars can.
  - **The ✓ WeekAdda stamp** — set server-side from `isOwnerEmail`, never from
    the request body, and declinable by the owner (`official: false`) so a
    personal piece is not forced out as the masthead. The byline itself is
    reserved: `resolveAuthor` in `queries.ts` refuses "WeekAdda" from anyone
    else, on reviews too. A stamped article shows the stamp **instead of a
    byline** — no writer name behind it. The "You" badge is the exception
    (owner, Aug 2026): it is not a byline, since only the account that wrote a
    piece can see it, and without it the owner's own articles are the one set
    they cannot pick out of a list.
- **Editing and deleting your own** (July 2026, articles *and* reviews):
  `PATCH`/`DELETE` on `/api/articles/:id` and `/api/blog/:id`. Rules that are
  enforced, not merely intended: only the verified writer (`canEditArticle` /
  `canEditPost`), **404 for someone else's, never 403** — a 403 confirms the id
  exists to an account with no claim on it; identity (id, ts, author, email,
  stamp) is not editable, so `applyArticleEdit`/`applyPostEdit` rebuild field by
  field rather than merging; a **cleared** cover or film must be written as an
  explicit `null` in the Worker's PATCH or the removal silently does nothing;
  and deleting a review takes its ratings with it. An **anonymous** post has no
  email, belongs to nobody, and can never be claimed. Controls live on the
  piece's own page (and the review modal), never on a list row — a destructive
  control on every row of a hundred is a mis-tap waiting to happen.
- **`/my-articles` and `/my-reviews`** (July 2026): a writer's own body of work,
  with search, topic filter and sort (Newest / Oldest / Most liked · Best rated).
  They replaced an in-place filter — a chip in the rail or the feed works at
  three items and collapses at a hundred. **Personal, not private**: each shows
  only what the asking account wrote, but there is nothing there for a crawler,
  so both are in `NOINDEX_PAGES` in `worker.ts` and out of `buildSitemap`.
  Cards carry `state={{ from, fromLabel }}`, which is how a piece's own back
  link and its post-delete redirect return where you actually came from.
- **The private watch log** (Aug 2026): what the visitor watched, where and
  when — `WatchLogForm.tsx`, the Private tab on `/my-reviews`, one entry at
  `/log/:id` (`LogEntry.tsx`), `routes/logs.ts` + `/api/logs*` in the Worker,
  Supabase `watch_logs`, local `cache/logs.json`. **This is the one part of
  the site that is nobody's business but its owner's, and that is enforced in
  seven places, not intended in one**: every route requires a verified token
  and filters on `user_email`, so there is no such thing as an anonymous read;
  there is deliberately **no `GET /api/logs/:id`** — an entry is found by
  loading your own log, so an id you do not own is simply not in what you are
  given; photos live in a **private** `log-images` bucket reached only through
  hour-long signed URLs, under a folder hashed from the verified email so no
  address appears in a path; every log response is `Cache-Control: private,
  no-store` (`privateJson` in `worker.ts`, the router-level header in
  `logs.ts`) so nothing in front of us keeps a copy; `/log/:id` and
  `/my-reviews` are **never pre-rendered**, carry `X-Robots-Tag: noindex,
  nofollow`, are absent from `buildSitemap` and `SEO_PAGES`, and **never ping
  IndexNow** — publishing a review shouts, a log entry must not. Only `/log/`
  is `Disallow`ed in robots.txt: the owner's articles and public reviews rank
  through their **own** URLs (`/article/:id/:slug`, `/review/:id/:slug`, both
  in `buildSitemap`), and blocking the personal index pages was mistaken for
  blocking those. Don't add the personal pages back to robots.txt.
  **Deleting an entry deletes its photo** (`dropLogImage` in `worker.ts`,
  `dropImage` in `routes/logs.ts`), and so does replacing one on edit —
  otherwise the object outlives the entry its owner believed they had taken
  down. `/privacy` says all of this in plain language, in both the page and
  `buildPrivacySeo`; if any of it changes, change the policy in the same
  commit, because it is now a promise made to the reader. Local `cache/` is gitignored, so a test log never
  reaches the public repo. **Nothing here may ever grow a public surface**: no
  sharing, no "friends can see", no crawlable anything. Adding one would not
  be a feature on top of this — it would undo the reason the log exists.
- **Per-review pages** (`/review/:id/:slug`, `ReviewDetail.tsx`, July 2026): the
  feed can only ever show an opening, so each review has its own URL — shareable,
  pre-rendered by `buildReviewPage` in `seo.ts` and listed in `buildSitemap`
  (dated by the review's own `ts`, not the sweep's). Same id[/slug] shape as a
  title page and gated the same way: `REVIEW_ROUTE` in `worker.ts` must match,
  or the edge 404s the path. The Worker's `loadPost` falls back to a by-id
  Supabase query, because its cached list holds only the 200 newest and an older
  review still has a page. No `reviewRating` in the markup, for the reason in
  the Gotchas below. The **right-hand rail (`ArticleIndex`, `.blog-index`)
  carries articles, never reviews** — owner decision, since the feed beside it
  already is the reviews. Same component on both pages: articles on `/reviews`,
  related ones on an article page. The modal's "Full page" link is therefore the
  only in-app link to `/review/:id`, and what keeps those pages from being
  orphans.
- **Auth is Google-only, and only for writing** (added July 2026). Browsing everything
  is account-free. Sign-in uses Google Identity Services' **OAuth token flow** (custom
  `GoogleButton.tsx` + `frontend/src/auth.ts`; app-wide state via `useGoogleUser`), NOT
  the pre-built iframe button. The browser sends the access token as `Authorization:
  Bearer`; the server verifies it with `verifyGoogleToken` in `queries.ts` (used by
  both Express and Worker). Gated writes: publishing/rating a blog post, and posting/
  responding on the Adda. Verified emails are stored server-side (`author_email`,
  `user_email`) and **never returned by public APIs** (`publicPost`/`publicListing`
  strip them). Needs `GOOGLE_CLIENT_ID` (Worker var in wrangler.jsonc + backend/.env)
  and `VITE_GOOGLE_CLIENT_ID` (frontend/.env, baked in at build). While unset,
  anonymous posting still works — keep that keyless fallback.
- **The Adda** (`Adda.tsx`, `backend/src/routes/adda.ts`, Worker `/api/adda*`): a
  community board where anyone posts asks/offers (spare ticket, company for a
  movie/match). Reading is public; posting and clicking "I'm interested" need sign-in.
  On interest, contact (email, optional WhatsApp) is revealed **mutually** — poster
  sees responders, responder sees poster — that reveal is the only place emails leave
  the server. Poster can close a listing; anything >30 days auto-expires. Supabase
  `listings` / `listing_interests`, local `cache/adda.json`.
- **Pan-India films appear in every language they released in** (July 2026). A
  `Release` may carry `languages: string[]` (release languages, original first);
  read it via `releaseLanguages`/`isPanIndia` in `queries.ts`, never directly —
  it is absent on single-language films and on any older cache. The language
  filter matches *any* of them (plus `PAN_INDIA_CODE` = `pan` for the
  "Pan-India" chip), and `Releases.tsx` lists such a film in each language row,
  badged so the repeat reads as information. **No API knows this**: TMDB has one
  record per film under its shooting language, no dubbed records, and budget is
  not a proxy. It is read from the films' own Wikipedia articles by
  `agent/panIndiaSource.ts` (italic links only — following every link in a list
  row picks up actor pages; sentences about songs/title disputes/merely
  *planned* dubs are rejected; the original language comes from the infobox).
  The curated list in `data/panIndia.ts` **overrides** detection — add a line
  there to pin or correct a film rather than tuning the prose matching.
  Booking links take the language the viewer found the film under, so a
  Telugu original opens Hindi tickets from the Hindi row.
- **Click tracking carries identity**: each outbound click sends an anonymous per-
  browser `visitorId` (localStorage UUID), plus the verified `userEmail` when signed
  in; stats report `uniqueVisitors`/`signedInClicks`. Emails never surface in the
  public stats endpoint.
- **Three headcounts, and they overlap** — never add them. `uniqueVisitors` counts
  browsers, `signedInVisitors`/`members` count accounts, and `uniquePeople` is the
  stitched figure: because a signed-in click carries *both* ids, `aggregateClicks`
  builds a `visitorId → email` map (first sign-in on a browser wins) and re-keys
  every click through it, so one human across phone + laptop counts once and their
  earlier signed-out clicks on those browsers fold in too. Someone who never signs
  in is still one-per-browser — that's a floor, not a bug.
- **Private owner dashboard** (`/stats`, `Stats.tsx`, added July 2026): click totals
  overall and for today (clicks, unique visitors, signed-in accounts), **member
  counts** (`countMembers` in `queries.ts` — there is no user table, so "members"
  are the distinct verified emails unioned across clicks + `posts` + `post_ratings`
  + `listings` + `listing_interests`; reports total / active today / new today and a
  per-feature split), a 14-day bar chart and breakdowns by action/platform/language/
  title. **Not part of the app** —
  no navbar or footer link, absent from `buildSitemap` and the Worker's `SEO_PAGES`,
  `Disallow`ed in robots.txt, and served with `X-Robots-Tag: noindex` by the Worker.
  Access is enforced server-side, not by the unlisted URL: GET `/api/track/stats`
  (Express + Worker) verifies the Google token and checks the email with
  `isOwnerEmail` in `queries.ts` against `OWNER_EMAIL` (comma-separated list
  allowed) — 401 unsigned, 403 for anyone else. It **fails closed**: no
  `OWNER_EMAIL` means nobody gets in. `aggregateClicks` buckets days in **IST**
  (`istDay`), since "today" must mean today in India. Counts only — no visitor
  email is ever returned.
- **Country flags are self-hosted**: `frontend/public/flags/*.png` + resolver
  `frontend/src/flags.ts` (team name → country, Women/U19 squads share the flag).
  Unknown teams fall back to the remote ESPN logo URL — keep that fallback.
- **Edge pre-render (SEO)**: the Worker injects search-phrased HTML (built by
  `backend/src/seo.ts` from the same caches) inside `<div id="root">` for
  /, /movies, /movies/theatres, /movies/upcoming, /cricket, /cricket/results,
  /reviews, /adda, /about, /privacy, and every /movie/:id/:slug — which also
  carries any reviews of that title, plus `Review` JSON-LD.
  It also stamps per-route `<title>`/description/canonical **and Open Graph + Twitter
  tags** (movie pages get the poster as `og:image`) so shared links preview correctly.
  React clears the injected block on mount; on any error the Worker serves the
  untouched page. `seo.ts` must stay free of Node-only imports.
- Without `TMDB_API_KEY` in `backend/.env` the app serves sample data from
  `backend/src/data/` — everything must keep working in that keyless mode.

## Production (live since July 2026, all free tiers)

- **Live URL**: https://weekadda.com (domain on Cloudflare Registrar; the old
  weekadda.hemanth-mareedu8.workers.dev host 301-redirects to it via worker.ts)
- **Sweep**: GitHub Actions (`.github/workflows/sweep.yml`) daily at 22:30 UTC
  (4 AM IST) runs `npm run sweep` (`backend/src/sweep.ts`) — the unchanged Node agents,
  then pushes caches to Supabase. Repo secrets: `TMDB_API_KEY`, `WATCHMODE_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Manual sweep = Actions → "Daily sweep" →
  Run workflow (owner-only Sync button).
- **Serve**: Cloudflare Worker (`backend/src/worker.ts`, config `backend/wrangler.jsonc`)
  reads the Supabase `caches` table (5-min in-isolate TTL) and writes the `clicks`
  table. Built frontend ships as Worker static assets with SPA fallback. Worker
  secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) set via `wrangler secret put`.
- **Database**: Supabase (Mumbai), schema in `supabase/schema.sql` (`caches`,
  `clicks`, `posts`, `post_ratings`, `articles`, `article_likes`, `listings`,
  `listing_interests`, `push_subscriptions`; RLS on, no
  public policies — service key only). New tables/columns must be added to
  schema.sql AND run manually in the Supabase SQL Editor before the Worker code
  that uses them is deployed (schema.sql ships idempotent `add column if not exists`
  migrations for the auth/ratings/Adda/articles additions).
- **Article covers need a Storage bucket, and SQL cannot make one.** Storage →
  New bucket → `article-images` → **Public** → Create. It has to be public: the
  Worker uploads with the service key, but readers and social-preview crawlers
  fetch the object URL directly, so a private bucket 403s every cover and every
  `og:image`.
- **`GOOGLE_CLIENT_ID` is a Worker var** (plaintext in wrangler.jsonc, not a secret —
  OAuth client IDs are public), so it deploys with the Worker; no `wrangler secret
  put` needed for it.
- **`INDEXNOW_KEY` is a var for the same reason** — the protocol proves ownership by
  fetching the key back from `https://weekadda.com/<key>.txt`, which `worker.ts` serves
  from the var itself, so the key and its proof cannot disagree. `pingIndexNow` fires
  on every article/review publish, edit and delete (plus the film's title page, which
  carries its reviews) through `ctx.waitUntil` — a writer's publish must never wait on,
  or fail because of, a search engine, so every error is swallowed. Unset = no pings,
  silently. **Bing, Yandex and Seznam only**: Google retired its sitemap ping in 2023
  and its Indexing API covers only job postings and live videos, so Google still finds
  new pages from the sitemap on its own schedule. Don't add a "Google IndexNow".
- **`OWNER_EMAIL` is a Worker secret**, not a var — unlike the client id it's a
  personal address and the repo is public. Set it once with
  `npx wrangler secret put OWNER_EMAIL` (locally it lives in `backend/.env`).
  Until it's set in production, `/stats` is closed to everyone, including the owner.
- **Deploying app changes is manual** (no git integration):
  `cd frontend && npm run build`, then `cd ../backend && npx wrangler deploy`.
  Pushing to GitHub alone does NOT update the live site.
- The Worker never needs the TMDB key; the sweep never needs Cloudflare. Keep
  `worker.ts` and `queries.ts` free of Node-only imports (fs/path/express).

## Owner decisions & conventions (do not undo)

- **No live cricket scores.** The owner removed live-score display and polling
  deliberately (July 2026). Results show only completed (`state === 'post'`) matches;
  in-progress matches are filtered out at the API and there is no live-polling code.
  Do not reintroduce any of it unless explicitly asked.
- **Fixed language display order** (July 2026): Telugu, Tamil, English, Hindi,
  Malayalam, Kannada, then the rest — in the filter chips (`LANGUAGES` in
  `queries.ts`), the section rows (`LANGUAGE_ORDER` in `frontend/src/languages.ts`),
  and the pre-render (`byLanguage` in `seo.ts`); keep the three in step. Within a
  list, Telugu-first then date/votes still applies (`queries.ts` sort).
  **India-first sorting** in cricket (series featuring any team whose name starts
  with "india" are pinned first). Intentional.
- **The visitor's own language/team goes first, but only as a promotion**
  (owner-requested, July 2026): geo detection moves *one* language (or one
  cricket team) to the front — Karnataka → Kannada, Japan → Japanese, abroad →
  English, Australia → Australia's series. It never reorders anything else and
  never removes anything; the fixed order above is what remains, and is what
  everyone undetected still gets. See the Geo personalization bullet.
- **Wikipedia fetches are serialized with a polite delay** — keep it that way; do not
  parallelize them.
- Optional data sources (Watchmode) must **fail silent** when their key is missing.
- A failed parse of any single source page is skipped safely — one bad page must never
  break a sweep.
- **Renamed CinePitch → WeekAdda** (July 2026) across the whole codebase. Do not
  reintroduce the old name; the GitHub repo is Hemanth2605/WeekAdda.
- Ask before making code changes when the owner is in "discussion mode" — they often
  want analysis or opinions only.
- **Never commit, push, or deploy without the owner's explicit go-ahead.** The owner
  batches changes: build locally, let them review in the running app, ship on their
  word. "Commit" and "push" are distinct instructions — do only what was asked.
- **Sharing is multi-app** (native sheet on phones; WhatsApp/Telegram/X/Instagram/Copy
  chooser on desktop) — do not revert to WhatsApp-only.
- **No login for browsing; Google sign-in gates writing only** (owner decision,
  July 2026). Reading everything stays account-free. Sign-in is required to publish
  or rate a blog post and to post/respond on the Adda; browsing, and all read
  endpoints, never need it. While `GOOGLE_CLIENT_ID` is unset, anonymous posting
  still works — keep that keyless fallback. Display names remain self-chosen (Google
  name is the fallback). See the Auth and Adda architecture bullets for the flow.
- **Blog-post ratings** (owner-requested, July 2026): 5 stars, sign-in required, one
  rating per account (upsert), no self-rating. NB an earlier *movie* ratings feature
  was deliberately removed — don't add ratings anywhere else unless asked. **Article
  hearts are the one sanctioned exception** (owner-requested, 31 July 2026), and they
  are a like rather than a rating on purpose.
- **Your own work gets a page, not a filter** (owner decision, 31 July 2026): the
  feed's "My reviews" **navigates** to `/my-reviews`. The in-place filter it
  replaced was removed rather than kept alongside — two doors to the same room is
  worse than either one. **Articles moved back to a filter** (owner, Aug 2026)
  once `/articles` existed: the rail's "Yours N" now lands on `/articles?mine=1`
  with the Yours chip on. That is not the old in-place filter — it is a full
  page with search and sort, and the chip can be switched off to see everyone
  else's beside your own, which a separate page cannot do. `mine` lives in the
  URL so the view is shareable and the back button works. `/my-articles` still
  exists and still works; nothing in the app links to it any more.
- **Titles are written the way people search** (31 July 2026). The title is the
  `<title>`, the `<h1>`, the `og:title` and the URL slug, so it is the single biggest
  lever on whether a piece is ever found. "Ten Telugu films of the last decade" was
  invisible for *best telugu movies*; renaming is safe on a published piece because
  lookup is by id and the slug is decorative. Head terms (*2013 world cup*) belong to
  Wikipedia and ESPN — don't promise them.
- **The Adda hosts nothing against any service's terms** (owner rule, July 2026): no
  account/subscription sharing, tickets at face value only. The board deliberately
  connects people only — no in-app payments or chat; contact reveal is mutual and
  sign-in-gated. Keep the house-rules notice and the privacy/attribution pages.
- The Reviews page's falling letter-tile backdrop fades out on scroll on purpose (greet,
  then get out of the reader's way).
- **Big visible page headings (h1) are hidden** on Movies, Cricket, Reviews and Adda
  (owner decision, July 2026 — the nav tab already names each page, and on
  Movies/Cricket the active tab + week label carry the context). The `<h1>` stays
  in the DOM as `className="sr-only"` (defined in index.css) so SEO and screen
  readers still get exactly one heading; the visible header is just the small
  gold eyebrow + description. **To bring the visible headings back, remove
  `className="sr-only"` from the `<h1>` in these four files:** `Releases.tsx`
  (~L184), `Cricket.tsx` (~L167), `Reviews.tsx` ("Movie & Cricket Reviews by
  Real Viewers"), and `Adda.tsx` ("The Adda"). Movies/Cricket use the
  `.opp-header` hero; Reviews/Adda
  use `.community-hero` (a compact hero with the CTA on the right).
- **Mini player (PiP)** — `components/PipShow.tsx`, mounted on Releases, Cricket,
  Reviews and Adda as a fixed bottom-right button (`.reel-btn`). A generic slide
  player: slides with `image` render poster-style, the rest as text cards
  (kicker / title / gold sub / lines / flag badges). Each page builds its own
  slides from the data it already fetched, so the show always mirrors the
  current tab/week/filters — and live-updates the open window when they change.
  Desktop Chrome/Edge use Document PiP (clickable, ‹ › arrows, end card with
  week jumps); everywhere else a canvas→captureStream video PiP with
  Media-Session prev/next. Button hides when unsupported or nothing to play.
  Reviews/Adda rotate at 3s (reading), Movies/Cricket at 2.5s (`rotateMs`).
- **Geo personalization** (`frontend/src/geo.ts`, July 2026): GET `/api/geo`
  returns `{ country, region }` from Cloudflare's `request.cf` (Express answers
  nulls locally; `?force=IN-KA` fakes it). One `useGeo` lookup, cached in
  localStorage for 24h, feeds both `useHomeLanguage` (state/country → language,
  promoted to the front of `LANGUAGE_ORDER`; abroad gets their language then
  English) and `useHomeTeam` (country → national team name prefix, pinned above
  India in `Cricket.tsx`'s series sort). **Every fallback path is the existing
  fixed order** — undetected, unmapped state, or a country with no matches must
  keep today's behaviour. Never make this a blocking wait or a permission
  prompt, and never personalize the pre-render (see the gotcha below).
- **Week timeline** — `components/WeekTimeline.tsx` replaces the old dot strip
  on Movies and Cricket Results: labelled chips (This Week, Last Week, then
  date ranges), oldest left → This Week right, active chip auto-centred,
  visible on mobile (the dots used to be hidden there). Chip dates use the
  same UTC-day math as the backend's isoDaysAgo.
- **Back to top** — `components/BackToTop.tsx`, mounted once in `App.tsx` so
  every page has it; fades in past 600px of scroll and sits above `.reel-btn`
  in the same bottom-right column.
- **Release cards on the day** (July 2026): a title with `daysUntil === 0` flips its
  `.date-cal` tile between the date and a glowing green "New" (`.date-cal-flip` +
  `cal-flip`/`cal-glow` in index.css). Green, not gold, on purpose — gold is the
  site's ambient accent and would read as furniture; green is the one unspent hue
  and already means "available now". Upcoming OTT cards merge platform + timing
  into one stacked badge (`.release-flag.ott.stacked`): two pills at opposite
  corners overlapped at phone width, and the countdown lost.
- **Mini-player slides carry the id of what they show** (July 2026): a click
  lands on the item, not the page. Films go to `/movie/:id/:slug`; reviews to
  `/reviews?review=<id>`, which opens that post's modal; matches and Adda posts
  to `?match=`/`?post=`, where `useFocusTarget` (`frontend/src/focusTarget.ts`)
  scrolls the card into view, flashes `.pip-focus` and strips the key so a
  refresh is a plain load. The click **navigates before closing** the PiP window
  — closing is what returns focus, and doing it first raced the navigation.
- **The landing notification ask** (`components/NotifyPrompt.tsx`, mounted in
  `App.tsx`, July 2026) is **our own card, never the browser's dialog**. It
  appears 3.5s in, only when `Notification.permission === 'default'` and nothing
  is subscribed; "Not now" parks it for **7 days** in `weekadda-notify-ask`, then
  it asks once more. That weekly re-ask only works because the ask is soft — a
  native denial is permanent and unrecoverable from JS, which is why
  `subscribe()` in `push.ts` is still only ever reached from a click. The in-feed
  `NotifyCard` hides while the prompt is up (`NOTIFY_PROMPT`); their dismissals
  stay separate (permanent vs weekly). See PUSH-PLAN.md "Prompt timing".
- **Browse controls remember, navigation reads as navigation** (July 2026): the
  Coming Soon source (`weekadda-upcoming-source`) and the OTT content type
  (`weekadda-ott-type`) persist in localStorage like the language filter already
  did — a control that forgets while the two beside it remember reads as a bug.
  The `/ott` hub links (`components/PlatformLinks.tsx`) are text links, **not
  chips**: everything else in the toolbar filters in place, these leave the page.
  On phones `.toolbar .genre-row` scrolls horizontally instead of wrapping —
  fourteen language chips wrapped to four rows and pushed the first poster off
  the screen. Nothing is dropped or reordered, the row just swipes.
- **Badges never claim something we cannot know** (owner rule, Aug 2026). The Top
  Picks spotlight (`heroPicks` in `Releases.tsx`) ranks by TMDB **vote count**, so
  its badge says how much attention a title has — `Most watched` on OTT,
  `Trending` in theatres, `Most awaited` on Coming Soon (`heroTag`). **Do not add
  "Fast filling" or any seat/availability wording**: that is a booking claim, we
  hold no booking data, and on the OTT tab there are no seats to fill. Earning it
  would need a real availability source, not a rename.
- **Top Picks is a carousel below 1024px** (owner, Aug 2026): one whole card,
  snapped centre, arrows over either edge (`.hero-arrow`) plus auto-advance every
  2s. Three guards make the autoplay bearable and all three are load-bearing —
  it pauses 6s after any touch/arrow, stops on `document.hidden`, and is off
  under `prefers-reduced-motion`. `stepHero` stamps the touch clock, so the timer
  must clear that stamp after calling it or it reads its own move as the
  visitor's and stalls after one step. Cards are `calc(100% - 48px)` so no slice
  of the next one shows — at tablet width a slice is 200px and reads as a second,
  broken card.
- **Icons are gradient tiles, and a gradient is used once** (owner decision,
  1 Aug 2026). The site used to be gold on everything; icons now sit in
  gradient tiles built by one shared block in `index.css` (`.tab-ico`,
  `.nav-ico`, `.notify-bell`, `.theme-toggle`, `.notify-icon`,
  `.notify-card-icon`, `.notify-prompt-icon`, `.reel-ico`). A tile draws its
  two colours from `--ico-a`/`--ico-b`, its shadow from `--ico-glow`, and its
  unselected glyph from `--ico-soft` (dark) / `--ico-deep` (light).
  **The registry — do not reuse one of these for a new button:**

  | Palette | Owner |
  | --- | --- |
  | violet → magenta (`.ico-movies`) | Movies, in the navbar |
  | magenta → crimson (`.ico-ott`) | the OTT India tab |
  | orange → rose (`.ico-theatre`) | In Theatres tab, Reviews nav |
  | teal → blue (`.ico-soon`) | Coming Soon tab, Cricket Fixtures tab |
  | green → cyan (`.ico-results`) | Cricket nav, Results tab, `.match-go` |
  | amber → pink (`.ico-adda`) | Adda nav |
  | amber → coral | all four bells (navbar, in-feed card, landing prompt, sheet) |
  | gold → orange / blue → navy | the theme toggle, sun and moon |
  | seven-stop rainbow | the brand mark — one colour per day of the week |
  | cyan → blue → navy | the mini-player launcher |
  | violet → pink → amber | the "All languages" chip |
  | crimson (`.date-cal-month`) | the date tile on release + fixture cards |
  | green → cyan (flat) | the same-day "New" flip, `.date-cal.back` |

  Rules that made those choices, and that a new surface has to obey:
  **two stops means a section, three means site-wide** (brand, mini player);
  a **section palette may never be worn by something that is not that
  section** — the mini player wore Movies' violet and read as a second Movies
  button, which is what split `.ico-movies` from `.ico-ott` in the first
  place; **unselected is a style, not an opacity** — dimming a live control
  reads as disabled, so a tile keeps its hue as tinted glass (the gradient
  under `--ico-scrim`) and lights the full gradient via `::before`; and the
  **light-theme rules must restate every lit state**, since
  `:root[data-theme='light'] .nav-ico` (0,4,0) outscores
  `.nav-link.active .nav-ico` (0,3,0). Gold is still the site's ambient accent
  — borders, text, `.share-wa`, `.india-cta` — and stays that way; these tiles
  are the exception, not a replacement.

## Gotchas

- **An `await` that never settles is worse than one that rejects.** A rejection
  reaches a `catch` and gets reported; a promise that simply never resolves
  reports nothing, leaves whatever guard flag was set still set, and kills the
  control for the rest of the visit. It reads as "the button does nothing",
  which is indistinguishable from a broken site, and it cost most of a day
  across three separate features (Aug 2026):
  - the **mini player** awaited `loadedmetadata` on a canvas `captureStream`,
    which Safari never fires — and `openingRef` never cleared, so every later
    tap returned early too;
  - **sign-in** awaited a Google callback that an installed iOS app never
    receives, because the popup opens in Safari with no opener to report back
    through, leaving the button on "Signing in…" until the app was killed;
  - the same button set `busy` before a navigation that iOS then declined to
    perform on that page.
  The rules that came out of it: **bound every wait** (`withTimeout` in
  `PipShow.tsx` is the pattern), **treat "the visitor came back" as an answer**
  (`visibilitychange`/`focus` in `auth.ts`, with a grace period so a real
  callback still wins the race), and **funnel every exit through one reporting
  path** so no early `return` can leave silently. When something "does nothing",
  suspect an unsettled promise before suspecting the event handler.

- **A Worker route nested under another route's prefix guard is dead code, and
  local dev will never tell you.** The `/api/logs*` branches were written inside
  `if (url.pathname.startsWith('/api/adda'))` — to reuse its `verifyMe` — so in
  production every log request fell past them to the Worker's final 404 and the
  whole feature answered "Not found", while working perfectly locally because
  local dev runs **Express**, which never loads `worker.ts`. The guard now names
  both prefixes. When adding a Worker route, check which enclosing `if` you are
  inside, and probe the deployed URL (`curl https://weekadda.com/api/<new>` →
  expect its own 401/400, **not** `{"error":"Not found"}`) rather than trusting
  the local app.
- **An id-shaped URL with nothing behind it must 404.** `/movie/`, `/review/` and
  `/article/` all matched their route regex, found no record, and fell through to
  `return asset` — the 200 shell. That is a soft 404: Google indexes the empty page
  and keeps returning to it. The `gone()` helper in `worker.ts` serves the same shell
  with a 404 status, so the app's not-found state still renders. Any new
  id-shaped route needs the same treatment.
- **Two CSS rules at equal specificity: the later one wins, silently.**
  `.blog-index-item:hover .blog-index-go` (fills the circle gold) and
  `.blog-index-item.write .blog-index-go` (tints the icon gold) both score 0,3,0 —
  so on hover the icon vanished into its own background. Fixed by *raising*
  specificity (`.write:hover`), not by reordering: ordering fixes hold until
  someone moves a block.
  **A media query is the nastiest version of this**, because it adds no
  specificity at all, and there are two ways to lose. To a **later base rule**:
  bit `.log-ticket-stub`, `.blog-wrap`, `.spotlight-head` and
  `.blog-input.author`, twice hidden by a shorthand, since a later `padding:`
  wipes an earlier `padding-left:` and comparing property names finds nothing.
  And to a **later, broader media block** — `max-width: 560px` written above
  `max-width: 1024px` both match on a phone and the 1024 one wins; that is how
  eight navbar and floating-button rules went dead when the nav moved to a
  bottom bar (Aug 2026), harmless but lying about the layout.
  `npm run check:css` (`frontend/scripts/check-css-shadow.js`) catches both, and
  reads the **built** stylesheet because source order is not the truth — in every
  case so far the source looked fine. Narrower media blocks must come **after**
  broader ones, and phone rules that must beat a base rule live in one block at
  the end of `index.css`.
- **A flex child will not shrink below its longest word.** The review page's title
  ran straight out of the card because `.blog-card-meta` had no `min-width: 0`.
  Any long string in a flex row needs that plus `overflow-wrap: anywhere`.
  **Unless it clips**: a flex item whose `overflow` is anything but `visible`
  already has an automatic minimum size of zero, which is why the cricket card's
  `nowrap` + `overflow: hidden` + ellipsis team names and scores shrink correctly
  with no `min-width` at all. So the ones to check are the items that *don't*
  clip. **And what an overflow looks like depends entirely on whether an
  ancestor happens to clip** — the log ticket has `overflow: hidden`, so a long
  note merely vanished; `.blog-card` has none, so an Adda email of the same
  length pushed the whole page sideways. Fix the text, not the container.

- **Verify against what is served, not what is written.** Three separate false
  readings in one day: CSS that looked correctly ordered in source and was not
  once concatenated; a `grep` of a live bundle that found nothing because
  Cloudflare serves it compressed (use `curl --compressed`); and a "fix
  verified" run that was answered by a stale process still holding the port.
  For anything that survives a build step or crosses the network, read the
  built file, the served bytes, or the cache the sweep actually wrote.
- **Google's popup only opens from a real click.** `ArticleImagePicker` asked for
  sign-in from the file input's `change` event — by then the OS file dialog had spent
  the user gesture and the browser refused with `popup_failed_to_open`. Sign-in is now
  its own button press, *then* the file picker. `auth.ts` says this in its doc comment;
  believe it.
- **Removing a team name from a series string needs word boundaries.** "India" sits
  inside "West Indies", so stripping the label's teams out of a match subtitle
  mangled it to "West es". `matchSubtitle` in `ReviewBits.tsx` matches on `\b…\b` and
  removes the longest name first, then drops the stranded connector ("in", "tour of").
  It runs at **render**, so reviews already written are fixed too.
- **JSON-LD goes in `<head>`, never inside `<div id="root">`.** React empties the
  root on mount, so structured data injected there exists in the raw HTML and is
  gone the instant the bundle boots — and Google's *rendering* pass is what
  decides rich results. This silently voided every Movie, Review, SportsEvent,
  ItemList and Person block until it was caught by a Rich Results Test reporting
  "No items detected" on a page whose markup was verifiably in the response.
  `worker.ts` now lifts every `ld+json` tag out of the injected block into
  `<head>`; keep it that way, and if a new builder emits schema it is covered
  automatically.
- **Never add a schema field just to silence a Search Console warning.** Twice in
  one day this turned a harmless suggestion into a validation error: `performer`
  (Google accepts only Person/PerformingGroup — a SportsTeam made every fixture
  invalid) and `superEvent` (Google reads nested events as items in their own
  right, so each fixture shipped an invalid twin with no startDate or venue —
  the "20 items detected" for ten fixtures was the tell). `organizer` and
  `offers` stay unanswered on cricket events on purpose: we do not know the
  governing body and we sell no tickets, and `offers` asserts something is
  purchasable here. A warning on a valid item is far cheaper than a silenced
  warning on an invalid one.
- **Reviews on title pages carry no `reviewRating`.** The five stars measure how
  useful readers found the *review*, not the writer's verdict on the film;
  mapping them would be inaccurate markup. Star snippets would need the composer
  to ask for a verdict out of five, which it does not. Whatever the pre-render
  shows must also render for people — `MovieDetail` loads the same reviews, or
  the markup is unsupported by visible content.
- **Never personalize the pre-render.** Edge HTML is cached per URL, so a
  geo-ordered block would be handed to the next visitor from anywhere and to
  crawlers. `seo.ts` keeps the canonical order; personalization happens in the
  SPA after mount. Same reason `/api/geo` is `no-store`.
- **ESPN's scoreboard feed sends `winner` as the STRING `"true"`/`"false"`** (its
  header feed sends real booleans). `Boolean("false")` is `true` — this crowned both
  teams and the UI highlighted the home side. `cricketAgent.ts` parses strictly, and
  a finished match ESPN gives two winners gets none (guard also runs over merged
  cache entries, since the cache accumulates old sweeps).
- **Canvas + CORS cache trap**: the page loads TMDB posters as plain `<img>`; a later
  `crossOrigin` request for the same URL (the mini player's canvas) gets the cached
  non-CORS response and fails. `PipShow.tsx` appends `?pip=1` so the canvas fetch has
  its own cache entry. Applies to any future canvas/WebGL use of page-loaded images.
- **Two waits that look like bugs.** A Worker deploy takes ~30–60s to propagate,
  so probing immediately after `wrangler deploy` returns the *previous* version;
  and the Worker caches Supabase reads for 5 minutes per isolate, which a URL
  cache-buster cannot bypass. Both produced false alarms today. Wait, then judge.
- Windows machine, PowerShell primary; remote is https://github.com/Hemanth2605/WeekAdda.
- **Never bulk-edit source files with PowerShell `Get-Content`/`Set-Content`.**
  It reads as ANSI and mangles non-Latin text — it corrupted the Telugu glyphs in
  `Reviews.tsx`'s letter-rain and the file had to be reverted. Use the editing
  tools.
- Port 5173 is often taken by the owner's other project (portfolio site) — Vite then
  serves WeekAdda on 5174+. Always read the actual port from Vite's startup output.
- SEO groundwork is live (Search Console verified; /sitemap.xml is generated by the
  Worker via `buildSitemap` in `backend/src/seo.ts` — static pages plus every
  /movie/:id/:slug title page; add new static routes there, favicons in
  frontend/public). The pre-render, not the SPA, is what
  crawlers see; keep its wording aligned with how people search (per-language OTT
  headings, "India cricket match today").
- `frontend/dist/` is stale build output — don't read it as source of truth.
- `backend/.env` exists and contains a real TMDB key — never print or commit it.
- **`tsx watch` restarts on source edits only, not on `.env` edits.** After adding or
  changing a variable (`OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, …) restart the backend or
  the running process keeps the old environment — which looks like a bug in the
  feature, not a config problem. Boot logs `🔒 Private /stats open to: …` (or that
  it's closed) so this is visible.
- Dates everywhere are ISO strings compared lexicographically; week math uses
  `isoDaysAgo` helpers duplicated in both routes.
