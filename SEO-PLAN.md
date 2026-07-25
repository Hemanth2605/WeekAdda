# WeekAdda — SEO URL taxonomy plan

Working plan for growing WeekAdda's organic surface beyond the seven pages it has
today. Written 25 July 2026. **Step 1 is implemented; steps 2–4 are not started.**

Read this with the SEO bullets in `CLAUDE.md` — this file is the roadmap, CLAUDE.md
is the description of what already exists.

## Why this exists

Every browse state on the site was a React `useState` tab, so the whole catalogue
lived on two URLs: `/movies` and `/cricket`. Google ranks URLs, not tabs, so:

- there was no page to return for "upcoming movies in india" — only `/movies`,
  whose title says **this week**, which is the wrong intent;
- someone landing from "upcoming web series" arrived on the OTT tab and had to
  find Coming Soon themselves, and that bounce is itself a ranking signal;
- "cricket fixtures" and "cricket results" both pointed at one URL.

The pre-render already contained upcoming titles (`seo.ts`, the two "Upcoming …"
sections), so the *content* was never the problem. The addressing was.

## Principles

Borrowed from how JustWatch, Flipkart and Amazon structure browse surfaces. These
are the rules to hold to when adding anything below.

1. **One URL per search intent, not per UI state.** Ask "what do people type?",
   not "what components do I have?". `/ott/netflix` exists because people search
   it, not because a filter chip exists.
2. **Programmatic, from the data model.** One template, many pages — exactly how
   `/movie/:id/:slug` already produces ~1,200 URLs from the release cache.
3. **Index hygiene over page count.** A page with two titles on it is thin
   content and drags the whole domain down. Gate on a content threshold; generate
   the page but `noindex` it and keep it out of the sitemap until it qualifies.
4. **Canonicalise filters and sorts.** Week paging, language filters and search
   must never become indexable URLs. That is how sites drown in index bloat.
5. **Crawl depth ≤ 3** from the homepage, via real `<a href>` links. A tab that
   only exists after a JS click is not internal linking.

## The taxonomy

### Tier 1 — tab URLs (**done**, step 1)

Every browse state addressable. No new content, no duplication: each URL is a
state the app already had.

| URL | Intent |
|---|---|
| `/movies` | OTT arrivals this week *(default, unchanged)* |
| `/movies/theatres` | new movies in theatres this week |
| `/movies/upcoming` | upcoming movies, upcoming OTT releases, upcoming web series |
| `/cricket` | fixtures *(default, unchanged)* |
| `/cricket/results` | cricket results this week |

Deliberately **no** `/cricket/fixtures` and no `/movies/ott` — those would be a
second URL for content the default already serves, which is duplication, not
coverage.

### Tier 2 — per-platform hubs (**not started**)

`/ott/<platform>` for each tracked platform:

```
/ott/netflix   /ott/prime-video   /ott/jiohotstar   /ott/zee5
/ott/sun-nxt   /ott/apple-tv      /ott/aha
```

Targets "new movies on netflix india", "zee5 new release", "sun nxt latest
movies". Seven pages from one template.

**Threshold applies.** As of 25 Jul 2026 Aha has 1 title and Sun NXT 2 across
weeks 0–3 — `/ott/aha` would be a thin page on day one. Require **≥ 3 titles**
before a hub is indexed and sitemapped; below that, serve it with
`X-Robots-Tag: noindex` and omit it from `buildSitemap`.

### Tier 3 — per-language hubs (**not started**)

`/movies/telugu`, `/movies/hindi`, `/movies/tamil`, `/movies/malayalam`,
`/movies/kannada`, `/movies/english`. Telugu first — it is the core audience and
the sort order already favours it. Same threshold rule.

### Tier 4 — cross products (**deliberately deferred**)

`/ott/zee5/telugu` and similar. Do **not** build these until Tier 2 and Tier 3
have proven they earn impressions. The combinatorics are where index bloat and
thin content come from.

Also deferred: splitting the Coming Soon sub-toggle (theatres vs OTT) into
`/movies/upcoming/ott`. "upcoming movies" and "upcoming ott releases" are
genuinely different queries, so this is worth revisiting — but only after
`/movies/upcoming` shows it ranks at all.

## Adding a route — the four-place coupling

**A route added in only one place breaks silently.** Since the soft-404 change,
an unknown path returns 404 at the edge, so a React route with no Worker entry is
invisible to everyone including Google.

1. `frontend/src/App.tsx` — the `<Route>` table
2. `backend/src/worker.ts` — `SPA_ROUTES` (else the edge 404s it) **and**
   `SEO_PAGES` (else no pre-render)
3. `backend/src/seo.ts` — `routeMeta` (title/description), the `seoBlockFor`
   branch in `worker.ts`, and the static list in `buildSitemap`
4. The page's `usePageMeta` call — `PAGE_META` in `Releases.tsx`, `RESULTS_META`
   in `Cricket.tsx`

**Point 4 is the one that looks fine and is not.** Two systems set the meta
tags: the Worker writes `routeMeta` into the HTML, which is what social
scrapers and non-rendering crawlers read, and then `usePageMeta` overwrites
them on mount, which is what Google's rendering pass reads. If the strings
differ, one URL advertises two different titles depending on who is asking —
and the React one usually wins in search results. Keep them byte-identical.

For the same reason, never key a title on state that is not in the URL (the
week, the theatres/OTT sub-toggle): the same address would then present several
titles depending on where the visitor had clicked.

## Measuring whether it worked

Per URL, in Search Console:

1. **Day 0** — URL Inspection → Test live URL. Confirm the pre-rendered content
   is in the returned HTML, then Request Indexing.
2. **3–14 days** — Indexing → Pages. Look for **Indexed**, not "Crawled/Discovered
   – currently not indexed", which means Google saw it and declined.
3. **2–4 weeks** — Performance → Search results → filter Page contains the URL →
   **QUERIES** tab. That tab is the answer: it shows which searches the page
   surfaced for.

Read the outcome honestly: indexed with impressions for the target queries = keep
going. Indexed with only brand ("weekadda") impressions after ~6 weeks = the
title/description do not match the query. Not indexed = Google judged it too thin
or too similar to its parent, which means the tier below it needs more distinct
content before expanding further.

Data lags 2–3 days; nothing shows same-day.

## Status

- [x] **Tier 1** — tab URLs, pre-render, meta, sitemap
- [ ] **Tier 2** — `/ott/<platform>` hubs + threshold gating
- [ ] **Tier 3** — `/movies/<language>` hubs
- [ ] **Tier 4** — cross products (only if 2 and 3 earn impressions)
- [ ] Submit the updated sitemap and request indexing for the Tier 1 URLs
- [ ] Add a Search Console **Domain property** so `www`/http history is included
