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
  tag jsonb not null          -- { kind, id, label, sub, poster }
);

-- Migration for databases created before Google sign-in (July 2026):
alter table posts add column if not exists author_email text;

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

alter table caches enable row level security;
alter table clicks enable row level security;
alter table posts enable row level security;
alter table post_ratings enable row level security;
alter table listings enable row level security;
alter table listing_interests enable row level security;
