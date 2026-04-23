create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  source_type text not null,
  language text not null default 'ja',
  base_url text not null,
  start_urls jsonb not null default '[]'::jsonb,
  allowed_domains jsonb not null default '[]'::jsonb,
  crawl_strategy text not null default 'listing-and-detail-pages',
  event_page_patterns jsonb not null default '[]'::jsonb,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'partial_success', 'failed')),
  trigger_type text not null default 'manual' check (trigger_type in ('manual', 'scheduled', 'retry', 'backfill')),
  started_at timestamptz,
  finished_at timestamptz,
  pages_queued integer not null default 0,
  pages_fetched integer not null default 0,
  pages_parsed integer not null default 0,
  events_created integer not null default 0,
  events_updated integer not null default 0,
  error_message text,
  logs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.raw_pages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  crawl_run_id uuid references public.crawl_runs(id) on delete set null,
  url text not null,
  canonical_url text,
  page_kind text not null default 'unknown' check (page_kind in ('listing', 'detail', 'unknown')),
  http_status integer,
  content_type text,
  title text,
  raw_html text,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_id, url, content_hash)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  raw_page_id uuid references public.raw_pages(id) on delete set null,
  external_id text,
  dedupe_key text not null,

  -- Core list item content
  title text not null,
  artist_name text,
  categories text[] not null default '{}',
  description text,

  -- Institute / venue context
  institution_name text not null,
  venue_name text,
  address_text text,
  directions_query text,

  -- Human-facing date text plus machine-readable dates for sorting/calendar
  date_text text not null,
  start_date date,
  end_date date,
  schedule_type text not null default 'unknown' check (schedule_type in ('range', 'occurrence_set', 'unknown')),
  occurrence_dates jsonb not null default '[]'::jsonb,
  start_time_text text,
  end_time_text text,
  is_all_day boolean not null default true,
  timezone text not null default 'Asia/Tokyo',
  calendar_starts_at timestamptz,
  calendar_ends_at timestamptz,

  -- Media and source links
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  source_url text not null,

  -- Editorial / pipeline metadata
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'archived')),
  extraction_confidence numeric(4, 3),
  last_seen_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_date_presence_check check (
    date_text <> '' or start_date is not null or calendar_starts_at is not null
  )
);

create unique index if not exists sources_slug_idx on public.sources (slug);
create index if not exists crawl_runs_source_id_idx on public.crawl_runs (source_id, created_at desc);
create index if not exists raw_pages_source_id_idx on public.raw_pages (source_id, fetched_at desc);
create index if not exists raw_pages_crawl_run_id_idx on public.raw_pages (crawl_run_id);
create index if not exists raw_pages_url_idx on public.raw_pages (url);

create index if not exists events_source_id_idx on public.events (source_id);
create index if not exists events_status_idx on public.events (status);
create index if not exists events_start_date_idx on public.events (start_date);
create index if not exists events_last_seen_at_idx on public.events (last_seen_at desc);
create index if not exists events_institution_name_idx on public.events (institution_name);
create index if not exists events_categories_gin_idx on public.events using gin (categories);
create unique index if not exists events_dedupe_key_idx on public.events (dedupe_key);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sources_updated_at on public.sources;
create trigger set_sources_updated_at
before update on public.sources
for each row
execute function public.set_updated_at();

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row
execute function public.set_updated_at();

alter table public.events enable row level security;

drop policy if exists "Public can read published events" on public.events;
create policy "Public can read published events"
on public.events
for select
to anon, authenticated
using (status = 'published');
