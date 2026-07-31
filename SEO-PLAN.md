# WeekAdda — SEO URL taxonomy plan

Working plan for growing WeekAdda's organic surface beyond the seven pages it has
today. Written 25 July 2026. **Tiers 1 and 2 are implemented; tiers 3–4 are not
started.**

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

### Tier 2 — per-platform hubs (**done**, 30 July 2026)

`/ott/<slug>` for each tracked platform — **eight**, not the seven first listed
here; Sony LIV was an omission, not a decision:

```
/ott/netflix   /ott/prime-video   /ott/jiohotstar   /ott/sonyliv
/ott/zee5      /ott/sun-nxt       /ott/apple-tv     /ott/aha
```

Targets "new movies on netflix india", "zee5 new release", "sun nxt latest
movies". Eight pages from one template.

Slugs are what people type, not what the platform calls itself — `prime-video`
and `sun-nxt`, not `amazon-prime-video` or `sunnxt`. `OTT_PLATFORMS` in
`queries.ts` is the authority: its `name` must equal the label `releaseAgent`
writes into `platforms`, which is the join between the two halves of the
feature. `frontend/src/platforms.ts` mirrors it — keep them in step.

**Not week-paged**, unlike every other movies block. A hub answers "what is on
Netflix", which is a standing question; `/movies` answers "what arrived this
week". Sharing the paging would have made them the same page twice.

**Threshold applies and is live.** `PLATFORM_MIN_TITLES = 3` in `queries.ts`;
`queryPlatform` returns `indexable`. Below it the page still serves — someone
following a link gets something that works — but the Worker sends
`X-Robots-Tag: noindex, follow` and `buildSitemap` omits it. At the time of
writing all eight qualify, Aha only just (2 streaming + 1 upcoming).

**Orphan check, which is the part that would have wasted the tier.** Eight pages
only the sitemap knows about earn nothing. `/movies` carries a real `<a href>`
row in both the pre-render (`PLATFORM_NAV`) and the app (`PlatformLinks.tsx`),
and every hub cross-links the other seven, so a hub is depth 2 from the
homepage. Those links are text, not filter chips, deliberately: the toolbar's
chips filter in place, these leave the page, and giving both the same shape
promises the wrong thing.

### Tier 2b — a page per piece of writing (**done**, 31 July 2026)

`/review/:id/:slug` and `/article/:id/:slug`. Not a hub tier — these are leaf
pages — but they follow the same rules and are worth recording here because
they are the first routes whose **id is not in any release cache**.

Shape, both built the same way as `buildTitlePage`:

- `buildReviewPage` / `buildArticlePage` in `seo.ts` return
  `{ block, title, description, canonical, image? }`; the Worker injects the
  block and stamps the meta.
- Matched by **regex**, not by a `SPA_ROUTES` entry — `REVIEW_ROUTE` and
  `ARTICLE_ROUTE`, the same trick `MOVIE_ROUTE` uses, because the id is
  unbounded. This is the one exception to point 2 of the coupling below.
- `Article` / `Review` + `BreadcrumbList` JSON-LD, `og:type: article`, the
  article's cover as `og:image` when it is an absolute URL. A *relative* upload
  path is meaningless to a scraper fetching from another host, so it is omitted
  rather than advertised.
- Listed in `buildSitemap`, dated by the piece's own `ts`. A take written three
  weeks ago did not change because the release cache refreshed this morning.
- An id that resolves to nothing returns a **404**, not the 200 shell. See the
  soft-404 note below — this was missed on the first pass for all three of
  `/movie/`, `/review/` and `/article/`.

**Every article page is reachable without the sitemap**: `/reviews` lists them
in its pre-render, and each article links its related ones. Principle 5 applies
to leaf pages exactly as it does to hubs.

Not indexed, deliberately: `/my-reviews`, `/my-articles` and `/stats` are real
pages that are empty for anyone but their owner. They are in `NOINDEX_PAGES` in
`worker.ts`, served `noindex, nofollow`, and absent from `buildSitemap`.

### Tier 3 — per-language hubs (**not started**)

`/movies/telugu`, `/movies/hindi`, `/movies/tamil`, `/movies/malayalam`,
`/movies/kannada`, `/movies/english`. Telugu first — it is the core audience and
the sort order already favours it. Same threshold rule.

Tier 2 is the template: `queryPlatform` + `buildPlatformSeo` + one route in the
four places below. Watch the collision — `/movies/:tab` already matches
`/movies/telugu`, so the tab table and the language table have to be resolved in
one place rather than by route order.

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
   `SEO_PAGES` (else no pre-render). A route with an **unbounded id** cannot be
   a `SPA_ROUTES` string: add a regex beside `MOVIE_ROUTE` / `REVIEW_ROUTE` /
   `ARTICLE_ROUTE`, include it in `isKnownRoute`, and give it a branch in the
   pre-render `if` — three edits, not one. A page nobody should index goes in
   `NOINDEX_PAGES` instead of `SEO_PAGES`.
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

Shipped 25–26 July 2026, all live and verified:

- [x] **Tier 1** — tab URLs, per-URL pre-render blocks, meta, sitemap
- [x] One host, one scheme — `www`, workers.dev and `http` all 301 to the apex
- [x] Real 404s for paths the app does not have
- [x] `/blog` → `/reviews`, 301 in place, sitemap swapped
- [x] Reviews on `/movie/:id/:slug` with `Review` schema, rendered as well as
      pre-rendered
- [x] Event fields on cricket fixtures, and the two invalid ones removed again
- [x] JSON-LD lifted into `<head>` — see the Gotchas in CLAUDE.md, this one
      silently voided every schema block on the site

Shipped 30 July 2026:

- [x] **Tier 2** — eight `/ott/<slug>` hubs, threshold gating, `noindex` below
      it, sitemap entries, cross-links from `/movies` and between hubs

Shipped 31 July 2026, deployed and verified in production:

- [x] **Tier 2b** — `/review/:id/:slug` and `/article/:id/:slug`, pre-rendered,
      in the sitemap, cross-linked; `og:type: article`; `Article` schema carries
      the cover
- [x] Soft-404 closed for **ids that resolve to nothing** — `/movie/`,
      `/review/` and `/article/` were all serving a 200 empty page. Verified in
      production over six consecutive polls; the flapping before that was a
      half-propagated deploy, not a bug
- [x] `/reviews` meta rewritten — the page hosts articles now, and its title
      still said reviews only. Changed in **both** places (`routeMeta` and the
      page's `usePageMeta`), per point 4 above
- [x] The stale static `frontend/public/sitemap.xml` deleted. A July snapshot
      with no articles in it, shipped as a real asset, invisible only because
      the Worker intercepts `/sitemap.xml` before assets are served. If that
      ordering ever changed it would have served a sitemap missing everything,
      and nothing would have errored

Not started:

- [ ] **Tier 3** — `/movies/<language>` hubs
- [ ] **Tier 4** — cross products (only if 2 and 3 earn impressions)
- [ ] A verdict-out-of-five field in the review composer, which is what would
      make `reviewRating` honest and unlock star snippets
- [ ] `dateModified` on articles — deliberately absent: edits record no
      timestamp, and a field with nothing real behind it costs more than the
      warning it silences

### Owner actions still outstanding

1. Purge the Cloudflare cache (required after any HTML-changing deploy)
2. Search Console: resubmit `sitemap.xml`; Request Indexing for `/reviews`,
   `/movies/upcoming`, `/movies/theatres`, `/cricket/results`, and once Tier 2
   is deployed the three hubs worth the quota — `/ott/netflix`,
   `/ott/prime-video`, `/ott/jiohotstar`. Leave the small ones to the sitemap
3. Search Console → Enhancements → Events → **Validate Fix on "image" and
   "address" only**. Not `performer`, `organizer` or `offers` — all three are
   deliberate absences now and validation would fail
4. Bing Webmaster Tools: same sitemap and URLs
5. Re-subscribe to notifications on a phone so the timezone is recorded

`/blog` showing as "URL is on Google" is expected until Google re-crawls; it
moves to *Page with redirect* on its own in 1–3 weeks. Do not use the Removals
tool — it hides the URL for months and passes no signal to `/reviews`.

### When to judge it

Nothing before **2–4 weeks**, and then on Performance → filter by page →
**QUERIES**, not on the overview. Head terms like "movie reviews" are not
winnable and were never the target; `"<title> review"` and `"<title> OTT release
date"` are.
