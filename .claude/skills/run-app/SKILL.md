---
name: run-app
description: Launch the WeekAdda dev environment — backend API and frontend web app — and verify a change in the running site. Use when asked to run, start, preview, or screenshot the app.
---

# Running WeekAdda locally

Two dev servers, started independently (no root package.json):

1. **Backend API** — from `backend/`, run `npm run dev` **in the background** (tsx watch,
   long-running). Serves http://localhost:4000. Ready when the log shows
   `🎬 WeekAdda API running`. Health check: GET http://localhost:4000/api/health →
   `{"status":"ok"}`.
2. **Frontend** — from `frontend/`, run `npm run dev` **in the background** (Vite,
   long-running). Serves http://localhost:5173 and calls the API on :4000, so start the
   backend first.

Routes to verify: `/movies` (default; `/` redirects there), `/cricket`, and `/blog`
(visitor posts; local store is `backend/cache/blog.json`).

## Notes

- If `node_modules` is missing in either folder, `npm install` there first.
- Without `TMDB_API_KEY` in `backend/.env`, the app intentionally serves built-in sample
  data — that is not a bug.
- On boot the backend may kick off an agent sync (TMDB/Wikipedia/ESPN sweeps take a
  minute or two and log progress with 🎬/🏏 emoji). The UI works immediately from cache;
  don't wait for the sweep to finish.
- Port conflicts: backend port comes from `PORT` env (default 4000); Vite picks 5174+ if
  5173 is busy — read the actual URL from Vite's startup output.
- Both servers are watch-mode; after code edits just reload the browser, no restart
  needed (backend restarts itself via tsx watch).
