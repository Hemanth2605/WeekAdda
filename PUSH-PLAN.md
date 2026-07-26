# WeekAdda — release notifications (Web Push)

Design and status for the subscribe button. Written 25 July 2026.

Read with `CLAUDE.md` for the surrounding architecture. Owner decisions this
build is bound by: **no login for browsing**, and anything optional must **fail
silent** when its key is missing.

## What it does

A visitor taps **Notify me about new releases**, picks the languages they care
about, and gets a browser notification **only on days when something actually
arrives in one of those languages**. No account, no email, no app.

- **Anonymous.** A push subscription is a browser endpoint, not a person. We
  never learn who they are, and sign-in is never required.
- **Not a daily digest.** Silence on a day with nothing in their languages is
  the point — it is what stops the notification being revoked.
- **At most one per day** per subscription, however many titles land.

## Why Web Push rather than email or Telegram

Free forever with no third-party account, no per-message cost, and no personal
data stored — which keeps it clear of the consent obligations an email list
would bring under the DPDP Act. India is overwhelmingly Android, where browser
push works natively.

Email was considered and rejected for now: it needs a provider, it stores
personal data, and Adda email notifications were already built and removed once
(see `CLAUDE.md`). Telegram was rejected as a channel people must join rather
than a button on the site.

**The iOS limitation is real and unavoidable.** Safari only delivers Web Push
to sites the user has added to their Home Screen. iPhone visitors who haven't
done that will not see the subscribe button at all — feature-detected, not
broken. Roughly matches the Android/iOS split in India, so most visitors are
covered, but it is not everyone.

## Shape

```
Browser                     Worker                    Supabase           Sweep (Actions)
────────                    ──────                    ────────           ───────────────
tap Subscribe
pick languages
permission prompt
PushManager.subscribe()
   └─ POST /api/push/subscribe ──> push_subscriptions
                                                          ▲
                                   today's releases ───────┘
                                   per language, once a day
   <────────────── encrypted push ──────────────────────── web-push (VAPID)
service worker shows it
tap → /movies?language=te
```

**The sender runs in the sweep, not the Worker.** `worker.ts` must stay free of
Node-only imports, and Web Push needs VAPID signing and payload encryption that
the `web-push` package does in Node. The sweep already holds the fresh data the
moment it is written, which is exactly when a notification is due.

## Pieces

| Piece | Where |
|---|---|
| Service worker (`push`, `notificationclick`) | `frontend/public/sw.js` |
| Subscribe UI + language picker | `frontend/src/components/NotifyButton.tsx` |
| Register / permission / subscribe | `frontend/src/push.ts` |
| `POST /api/push/subscribe` + `/unsubscribe` | `worker.ts` and `routes/push.ts` |
| Table | `supabase/schema.sql` → `push_subscriptions` |
| Sender | `backend/src/pushSender.ts`, called from `sweep.ts` |

### Table

```sql
create table if not exists push_subscriptions (
  endpoint text primary key,        -- the browser's push URL; identity and dedupe key
  p256dh text not null,             -- client public key, for payload encryption
  auth text not null,               -- client auth secret
  languages text[] not null,        -- ['te','ml'] — what they asked for
  created_at timestamptz not null default now(),
  last_sent_on date                 -- IST day, so at most one notification a day
);
```

No user id, no email, no visitor id. The endpoint is the only identifier and it
is issued by the browser vendor, not by us.

### Keys

| Name | Where | Secret? |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | `frontend/.env`, baked into the bundle | No — public by design |
| `VAPID_PRIVATE_KEY` | GitHub Actions secret + `backend/.env` | **Yes** |
| `VAPID_SUBJECT` | same | No (a `mailto:`) |

Generated once with `npx web-push generate-vapid-keys`. Rotating them
invalidates every existing subscription, so generate once and keep them.

**Fails silent without them**, like Watchmode: no keys → no subscribe button,
no send step, everything else works untouched.

## Rules the send step follows

1. **Only today's arrivals.** A title counts if its release date is today in
   **IST** — the same `istDay` reasoning as the stats dashboard.
2. **Only their languages.** No match, no send. This is the whole feature.
3. **One a day.** `last_sent_on` is checked and set in the same pass.
4. **410 and 404 mean gone.** A browser returns those for an expired
   subscription; delete the row rather than retrying it forever.
5. **A failed send never fails the sweep.** Notifications are the least
   important thing the sweep does.

Copy: `3 new Telugu releases today` / `Kingdom, Vaari, Anaganaga — on Netflix
and ZEE5`. Tapping opens `/movies?language=te`.

## Prompt timing

Never on page load. Browsers penalise it, and a blocked permission is
permanent — the user has to dig through site settings to undo it, which nobody
does. The prompt fires only from an explicit tap on the button, after the
language picker, so consent is given twice before the browser ever asks.

## Deploy order

Schema first, always — the Worker 500s on a table that does not exist yet.

1. Run the `push_subscriptions` block in the Supabase SQL Editor
2. `npx wrangler secret put VAPID_PRIVATE_KEY` is **not** needed — the Worker
   only stores subscriptions, it never sends
3. Add `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` as **GitHub repo secrets** (the
   sweep sends), and `VITE_VAPID_PUBLIC_KEY` to `frontend/.env` before building
4. Build the frontend, deploy the Worker
5. Subscribe on a real Android phone and wait for a sweep

## Status

Built 25 July 2026; not yet deployed.

- [x] Table added to `schema.sql` — **still to be run in the Supabase SQL Editor**
- [x] Service worker (`public/sw.js`), `push.ts`, `NotifyButton.tsx`, styles
- [x] `POST /api/push/subscribe` + `/unsubscribe` in the Worker and Express
- [x] Sender (`pushSender.ts`) wired into `sweep.ts`, workflow passes the keys
- [x] VAPID keys generated into `backend/.env` and `frontend/.env`
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` added as GitHub
      repo secrets
- [ ] Verified end to end on a real Android device

Endpoint validation is tested: a subscription with no languages, an unknown
language code, or a non-https endpoint is rejected; re-subscribing replaces the
row rather than duplicating it; unsubscribing removes it. Targeting and copy are
tested against real cache data across one, two and many languages, including the
singular case.

**One thing the data showed:** OTT arrivals cluster — 13 titles on 24 July, then
nothing on the 25th or 26th. So a subscriber should expect a few notifications a
week, not one a day, and long quiet stretches are the feature working rather
than something broken.

## Deliberately not doing

- **A daily digest regardless of content.** The fastest way to get uninstalled.
- **Cricket notifications.** Match alerts are a different rhythm and would need
  their own frequency rules. Revisit once releases prove out.
- **Per-title alerts** ("tell me when *this* film streams"). Better feature,
  more moving parts, and it needs an audience first.
- **A web app manifest for iOS.** Only worth it if iPhone traffic turns out to
  matter; check Cloudflare Web Analytics before building for it.
