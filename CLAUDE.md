# WeekAdda — instructions for Claude Code

Weekly entertainment portal: movie releases, OTT arrivals in India, upcoming films, and
cricket results/fixtures. See `README.md` for the full feature and API overview.

## Commands

```bash
# Backend dev server (http://localhost:4000)
cd backend && npm run dev

# Frontend dev server (http://localhost:5173, proxies expect API on :4000)
cd frontend && npm run dev

# Typecheck (no test suite exists)
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Production frontend build
cd frontend && npm run build
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
  `/api/blog` GET/POST (+ `/mine`, `/rate`, `/ratings`), shared `buildPost`
  sanitizer in `queries.ts`; local store `backend/cache/blog.json` (+ `ratings.json`),
  production Supabase `posts` / `post_ratings` tables.
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
  `clicks`, `posts`, `post_ratings`, `listings`, `listing_interests`; RLS on, no
  public policies — service key only). New tables/columns must be added to
  schema.sql AND run manually in the Supabase SQL Editor before the Worker code
  that uses them is deployed (schema.sql ships idempotent `add column if not exists`
  migrations for the auth/ratings/Adda additions).
- **`GOOGLE_CLIENT_ID` is a Worker var** (plaintext in wrangler.jsonc, not a secret —
  OAuth client IDs are public), so it deploys with the Worker; no `wrangler secret
  put` needed for it.
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
  was deliberately removed — don't add ratings anywhere else unless asked.
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

## Gotchas

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
