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
  (`releases.json`, `cricket.json`, `clicks.jsonl`). Deleting a cache file is safe — it
  regenerates on the next sync.
- **Two daily agents**: `releaseAgent.ts` (TMDB + Wikipedia film lists + Wikipedia OTT
  originals + optional Watchmode) and `cricketAgent.ts` (ESPN public scoreboard JSON,
  accumulating cache). Locally node-cron runs them at 6 AM (`backend/src/index.ts`);
  each keeps a POST `/refresh` route for dev convenience (no UI button).
- **Query logic is shared**: `backend/src/queries.ts` holds all filter/sort/stats logic
  and the cache types, used by both the Express routes and the Worker. Change behaviour
  there, never in just one of the two.
- **Frontend** is React 18 + Vite with two pages: `Releases.tsx` (movies/OTT/upcoming
  tabs) and `Cricket.tsx` (results/upcoming tabs). Shared week-paging pattern: week 0 =
  last 7 days, up to 13 weeks back. All API calls are relative `/api/...`.
- Without `TMDB_API_KEY` in `backend/.env` the app serves sample data from
  `backend/src/data/` — everything must keep working in that keyless mode.

## Production (live since July 2026, all free tiers)

- **Live URL**: https://weekadda.hemanth-mareedu8.workers.dev
- **Sweep**: GitHub Actions (`.github/workflows/sweep.yml`) daily at 00:30 UTC
  (6 AM IST) runs `npm run sweep` (`backend/src/sweep.ts`) — the unchanged Node agents,
  then pushes caches to Supabase. Repo secrets: `TMDB_API_KEY`, `WATCHMODE_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Manual sweep = Actions → "Daily sweep" →
  Run workflow (owner-only Sync button).
- **Serve**: Cloudflare Worker (`backend/src/worker.ts`, config `backend/wrangler.jsonc`)
  reads the Supabase `caches` table (5-min in-isolate TTL) and writes the `clicks`
  table. Built frontend ships as Worker static assets with SPA fallback. Worker
  secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) set via `wrangler secret put`.
- **Database**: Supabase (Mumbai), schema in `supabase/schema.sql` (`caches` +
  `clicks`, RLS on, no public policies — service key only).
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
- **Telugu-first sorting** in releases; **India-first sorting** in cricket (series
  featuring any team whose name starts with "india" are pinned first). Intentional.
- **Wikipedia fetches are serialized with a polite delay** — keep it that way; do not
  parallelize them.
- Optional data sources (Watchmode) must **fail silent** when their key is missing.
- A failed parse of any single source page is skipped safely — one bad page must never
  break a sweep.
- **Renamed CinePitch → WeekAdda** (July 2026) across the whole codebase. Do not
  reintroduce the old name; the GitHub repo is Hemanth2605/WeekAdda.
- Ask before making code changes when the owner is in "discussion mode" — they often
  want analysis or opinions only.

## Gotchas

- Windows machine, PowerShell primary; remote is https://github.com/Hemanth2605/WeekAdda.
- `frontend/dist/` is stale build output — don't read it as source of truth.
- `backend/.env` exists and contains a real TMDB key — never print or commit it.
- Dates everywhere are ISO strings compared lexicographically; week math uses
  `isoDaysAgo` helpers duplicated in both routes.
