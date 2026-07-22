# CinePitch — instructions for Claude Code

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
- **No database.** Agents write JSON caches to `backend/cache/` (`releases.json`,
  `cricket.json`, `clicks.jsonl`). Deleting a cache file is safe — it regenerates on the
  next sync.
- **Two daily agents** (cron `0 6 * * *` in `backend/src/index.ts`, plus stale-check on
  boot): `releaseAgent.ts` (TMDB + Wikipedia film lists + Wikipedia OTT originals +
  optional Watchmode) and `cricketAgent.ts` (ESPN public scoreboard JSON, accumulating
  cache). Each has a POST `/refresh` route wired to a "Sync now" button.
- **Frontend** is React 18 + Vite with two pages: `Releases.tsx` (movies/OTT/upcoming
  tabs) and `Cricket.tsx` (results/upcoming tabs). Shared week-paging pattern: week 0 =
  last 7 days, up to 13 weeks back.
- Without `TMDB_API_KEY` in `backend/.env` the app serves sample data from
  `backend/src/data/` — everything must keep working in that keyless mode.

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
- **Rebrand pending:** the owner is considering renaming CinePitch → WeekAdda. Do not
  rename anything in code until told to.
- Ask before making code changes when the owner is in "discussion mode" — they often
  want analysis or opinions only.

## Gotchas

- Windows machine, PowerShell primary; no git repository is initialized in this project.
- `frontend/dist/` is stale build output — don't read it as source of truth.
- `backend/.env` exists and contains a real TMDB key — never print or commit it.
- Dates everywhere are ISO strings compared lexicographically; week math uses
  `isoDaysAgo` helpers duplicated in both routes.
