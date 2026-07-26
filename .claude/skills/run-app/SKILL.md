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

Routes to verify: `/movies` (default; `/` redirects there), `/movies/theatres`,
`/movies/upcoming`, `/cricket`, `/cricket/results`, `/reviews`
(visitor reviews + star ratings; local store `backend/cache/blog.json`, ratings in
`ratings.json`), `/adda` (community board; store `backend/cache/adda.json`), `/about`,
`/privacy`, and a per-title detail page at `/movie/:id/:slug` (open any release's
modal → "Full page", or fetch an id from GET `/api/title/<id>` — ids come from the
release caches, e.g. `tmdb-…`/`ott-…`).

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
- **Google sign-in** (needed to publish/rate a review or post/respond on the Adda)
  works locally only if `GOOGLE_CLIENT_ID` is in `backend/.env` and
  `VITE_GOOGLE_CLIENT_ID` in `frontend/.env` (both already set). Without them,
  anonymous posting still works. The sign-in popup is a real Google flow — it can't be
  driven by a headless browser, so verify it by hand. You can't rate/interest on your
  own posts by design (needs a second Google account to see the full flow).
