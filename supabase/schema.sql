-- WeekAdda Supabase schema.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Leave Row Level Security ON with no public policies: only the backend
-- (GitHub Actions sweep + Cloudflare Worker) talks to these tables, using
-- the service_role key which bypasses RLS. Nothing is publicly readable.

-- Replaces backend/cache/*.json — the daily sweep upserts one row per cache
-- ('releases' and 'cricket'), the Worker reads them.
create table if not exists caches (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Replaces backend/cache/clicks.jsonl — one row per outbound
-- Watch/Book/Scorecard click, inserted by the Worker.
create table if not exists clicks (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,        -- watch | book | score | share
  platform text not null,    -- e.g. Netflix, BookMyShow, ESPN
  title_id text,
  title text not null,
  language text,
  visitor_id text,           -- anonymous per-browser id (localStorage UUID)
  user_email text            -- verified Google account when signed in
);

-- Migration for databases created before visitor/user identity (July 2026):
alter table clicks add column if not exists visitor_id text;
alter table clicks add column if not exists user_email text;

-- Replaces backend/cache/blog.json — one row per visitor blog post about a
-- tagged movie or cricket match, inserted by the Worker.
create table if not exists posts (
  id text primary key,
  ts timestamptz not null default now(),
  author text not null,       -- self-chosen display name
  author_email text,          -- verified Google account (moderation only;
                              -- never returned by the public API)
  title text not null,
  body text not null,
  tag jsonb not null,         -- { kind, id, label, sub, poster }
  official boolean not null default false  -- published by the site itself;
                              -- shown as the ✓ stamp instead of a byline
);

-- Migration for databases created before Google sign-in (July 2026):
alter table posts add column if not exists author_email text;

-- The ✓ WeekAdda stamp on a review (Aug 2026), the same one articles carry.
-- Set server-side from the verified email and never from the request body, so
-- the column is only ever written by code that has already checked who is
-- asking. Default false: every existing review keeps its own byline.
alter table posts add column if not exists official boolean not null default false;

-- Articles (July 2026): the writing with no release to hang on — the 1983
-- final, a top-ten list, an old film revisited. Deliberately its own table
-- rather than a kind column on posts: an article has no tag, and keeping the
-- shapes apart is what stops one ever being served in the reviews feed.
create table if not exists articles (
  id text primary key,
  ts timestamptz not null default now(),
  author text not null,       -- self-chosen display name
  author_email text,          -- verified Google account (moderation only;
                              -- never returned by the public API)
  topic text not null,        -- movie | match — drives the related panel
  title text not null,
  body text not null,
  official boolean not null default false,  -- published by the site itself;
                              -- set server-side from OWNER_EMAIL, never from
                              -- the request body
  films jsonb not null default '[]'::jsonb,  -- movie articles: [{ id?, title,
                              -- platforms[] }] for the where-to-watch block
  image text,                 -- cover, stored in the article-images bucket
  image_position text,        -- focal point, e.g. "50% 30%" (CSS object-position)
  image_fit text              -- 'contain' shows the whole picture; null = cover
);

-- Migration for an articles table created before the cover could be re-framed:
alter table articles add column if not exists image_position text;
alter table articles add column if not exists image_fit text;

-- Article covers need a PUBLIC Storage bucket named article-images. Buckets are
-- not created by SQL — do it once in the dashboard: Storage → New bucket →
-- name "article-images" → tick Public → Create. The Worker uploads with the
-- service key; readers fetch the public object URL directly.

-- Migrations for an articles table created before these were added:
alter table articles add column if not exists official boolean not null default false;
alter table articles add column if not exists films jsonb not null default '[]'::jsonb;

-- A heart on an article: one per Google account, removed by tapping again.
-- Deliberately a like and not a rating — an article is liked or not, and a
-- single count can never be mistaken for a verdict on the film it discusses.
create table if not exists article_likes (
  article_id text not null,
  user_email text not null,   -- verified Google account (never served publicly)
  ts timestamptz not null default now(),
  primary key (article_id, user_email)
);

-- Blog post ratings: one rating per Google account per post, upserted by the
-- Worker (sign-in required; authors cannot rate their own posts).
create table if not exists post_ratings (
  post_id text not null,
  user_email text not null,   -- verified Google account (never served publicly)
  rating int not null check (rating between 1 and 5),
  ts timestamptz not null default now(),
  primary key (post_id, user_email)
);

-- The Adda community board: listings anyone can read; posting and responding
-- require Google sign-in. Contact details live only here and are revealed
-- mutually on interest.
create table if not exists listings (
  id text primary key,
  ts timestamptz not null default now(),
  author text not null,        -- self-chosen display name
  author_email text not null,  -- verified Google account
  whatsapp text,               -- optional, poster's wish
  title text not null,
  details text not null,
  status text not null default 'open'  -- open | closed
);

create table if not exists listing_interests (
  listing_id text not null,
  user_email text not null,    -- verified Google account of the responder
  name text not null,
  ts timestamptz not null default now(),
  primary key (listing_id, user_email)
);

-- Web Push subscribers (July 2026). Anonymous by construction: the endpoint is
-- issued by the browser vendor, not by us, and there is no email, account or
-- visitor id here. A subscriber hears from us only on days something arrives in
-- one of their languages, at most once a day — see PUSH-PLAN.md.
create table if not exists push_subscriptions (
  endpoint text primary key,     -- browser push URL: identity and dedupe key
  p256dh text not null,          -- client public key, for payload encryption
  auth text not null,            -- client auth secret
  languages text[] not null,     -- e.g. {te,ml} — what they asked to hear about
  timezone text,                 -- IANA zone from the browser; null = Asia/Kolkata
  created_at timestamptz not null default now(),
  last_sent_on date              -- the subscriber's OWN local day, not ours
);

-- Migration for tables created before per-subscriber send times (July 2026):
alter table push_subscriptions add column if not exists timezone text;

alter table caches enable row level security;
alter table clicks enable row level security;
alter table posts enable row level security;
alter table articles enable row level security;
alter table article_likes enable row level security;
alter table post_ratings enable row level security;
alter table listings enable row level security;
alter table listing_interests enable row level security;
alter table push_subscriptions enable row level security;

-- ---------------------------------------------------------------- watch log
-- The private log: what someone watched, where and when. Nothing public ever
-- reads this table — there is no endpoint that returns another account's rows,
-- and the Worker filters on user_email inside every query rather than after it.
create table if not exists watch_logs (
  id text primary key,
  ts timestamptz not null default now(),
  -- The day they watched, which is not the day they logged it
  watched_on date not null,
  user_email text not null,
  -- 'movie' or 'match' — the log covers both, so a night out is a cinema
  -- for one and a stadium for the other
  kind text not null default 'movie',
  -- "where" is reserved in SQL; this is 'out' (cinema/stadium) or 'home'
  where_kind text not null default 'out',
  title text not null,
  -- Set when the film was picked from the release cache, absent for older ones
  title_id text,
  -- Theatre or stadium name, or the platform when watched at home
  venue text,
  -- Cinema only: a platform has no city
  city text,
  note text,
  -- A photo, as a PATH in the PRIVATE log-images bucket — never a URL. The
  -- Worker signs a short-lived one when the owner opens the entry; there is no
  -- URL that works without that. Article covers are the opposite case and live
  -- in a public bucket, because a social crawler has to fetch them.
  image text,
  -- How the photo is framed, chosen after upload — the bytes are never touched
  image_position text,
  image_fit text
);

-- Every read is "this account's log, newest watch first"
create index if not exists watch_logs_user_idx on watch_logs (user_email, watched_on desc);

alter table watch_logs enable row level security;
