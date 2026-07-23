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
  kind text not null,        -- watch | book | score
  platform text not null,    -- e.g. Netflix, BookMyShow, ESPN
  title_id text,
  title text not null,
  language text
);

-- Replaces backend/cache/blog.json — one row per visitor blog post about a
-- tagged movie or cricket match, inserted by the Worker.
create table if not exists posts (
  id text primary key,
  ts timestamptz not null default now(),
  author text not null,
  title text not null,
  body text not null,
  tag jsonb not null          -- { kind, id, label, sub, poster }
);

alter table caches enable row level security;
alter table clicks enable row level security;
alter table posts enable row level security;
