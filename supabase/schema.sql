begin;

create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  city text not null default 'kyoto',
  name text not null,
  source_type text not null,
  language text not null default 'ja',
  base_url text not null,
  start_urls jsonb not null default '[]'::jsonb,
  allowed_domains jsonb not null default '[]'::jsonb,
  crawl_strategy text not null default 'listing-and-detail-pages',
  event_page_patterns jsonb not null default '[]'::jsonb,
  locales jsonb not null default '{}'::jsonb,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sources
  add column if not exists locales jsonb not null default '{}'::jsonb;

alter table public.sources
  add column if not exists city text not null default 'kyoto';

update public.sources
set locales = '{}'::jsonb
where locales is null;

update public.sources
set city = 'kyoto'
where city is null or city = '';

alter table public.sources
  alter column locales set default '{}'::jsonb,
  alter column locales set not null;

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

update public.crawl_runs
set
  status = 'failed',
  finished_at = now(),
  error_message = 'Recovered stale crawl run older than 6 hours'
where status = 'running'
  and coalesce(started_at, created_at) < now() - interval '6 hours';

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
  city text not null,
  raw_page_id uuid references public.raw_pages(id) on delete set null,
  external_id text,
  dedupe_key text not null,

  -- Core list item content
  title text not null,
  categories text[] not null default '{}',
  description text,

  -- Institute / venue context
  institution_name text not null,
  venue_name text,
  address_text text,
  directions_query text,
  lat double precision,
  lng double precision,

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
  image_metadata jsonb not null default '[]'::jsonb,
  source_url text not null,

  -- Editorial / pipeline metadata
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'archived')),
  extraction_confidence numeric(4, 3),
  last_seen_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_date_presence_check check (
    status <> 'published'
    or start_date is not null
    or calendar_starts_at is not null
    or jsonb_array_length(occurrence_dates) > 0
  ),
  constraint events_occurrence_dates_array_check check (
    jsonb_typeof(occurrence_dates) = 'array'
  ),
  constraint events_image_metadata_array_check check (
    jsonb_typeof(image_metadata) = 'array'
  )
);

create table if not exists public.event_schedule_segments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ordinal integer not null,
  is_all_day boolean not null,
  start_date date,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Tokyo',

  constraint event_schedule_segments_event_id_ordinal_key unique (event_id, ordinal),
  constraint event_schedule_segments_ordinal_check check (ordinal >= 0),
  constraint event_schedule_segments_timezone_check check (btrim(timezone) <> ''),
  constraint event_schedule_segments_shape_check check (
    (
      is_all_day
      and start_date is not null
      and starts_at is null
      and ends_at is null
    )
    or
    (
      not is_all_day
      and start_date is null
      and end_date is null
      and starts_at is not null
    )
  ),
  constraint event_schedule_segments_end_check check (
    (
      is_all_day
      and (end_date is null or end_date >= start_date)
    )
    or
    (
      not is_all_day
      and (ends_at is null or ends_at >= starts_at)
    )
  )
);

comment on table public.event_schedule_segments is
  'Canonical ordered all-day or timed schedule segments for an event.';
comment on column public.event_schedule_segments.ordinal is
  'Stable nonnegative display order within one event.';
comment on column public.event_schedule_segments.timezone is
  'IANA timezone used to interpret and display this segment.';

-- Explicit occurrence dates are authoritative over legacy envelope fields.
with raw_occurrences as (
  select
    event.id as event_id,
    event.timezone,
    occurrence.value as raw_date
  from public.events as event
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(event.occurrence_dates) = 'array' then event.occurrence_dates
      else '[]'::jsonb
    end
  ) as occurrence(value)
  where nullif(btrim(event.timezone), '') is not null
    and not exists (
      select 1
      from public.event_schedule_segments as existing
      where existing.event_id = event.id
    )
), parsed_occurrence_parts as (
  select
    event_id,
    timezone,
    raw_date,
    case when raw_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then substring(raw_date from 1 for 4)::integer end as year,
    case when raw_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then substring(raw_date from 6 for 2)::integer end as month,
    case when raw_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then substring(raw_date from 9 for 2)::integer end as day
  from raw_occurrences
), validated_occurrences as (
  select
    event_id,
    timezone,
    case
      when year between 1 and 9999
        and month between 1 and 12
        and day between 1 and case
          when month = 2 and (year % 400 = 0 or (year % 4 = 0 and year % 100 <> 0)) then 29
          when month = 2 then 28
          when month in (4, 6, 9, 11) then 30
          else 31
        end
      then make_date(year, month, day)
      else null
    end as occurrence_date
  from parsed_occurrence_parts
), valid_occurrences as (
  select distinct
    event_id,
    timezone,
    occurrence_date
  from validated_occurrences
  where occurrence_date is not null
), ordered_occurrences as (
  select
    event_id,
    (row_number() over (partition by event_id order by occurrence_date) - 1)::integer as ordinal,
    occurrence_date,
    timezone
  from valid_occurrences
)
insert into public.event_schedule_segments (
  event_id,
  ordinal,
  is_all_day,
  start_date,
  end_date,
  timezone
)
select
  event_id,
  ordinal,
  true,
  occurrence_date,
  occurrence_date,
  timezone
from ordered_occurrences
on conflict (event_id, ordinal) do nothing;

-- Backfill only complete all-day legacy envelopes. Timed legacy rows are
-- ambiguous because old extractors also used timestamps for venue opening hours.
-- Nonempty occurrence arrays suppress envelope fallback even when entries are invalid.
insert into public.event_schedule_segments (
  event_id,
  ordinal,
  is_all_day,
  start_date,
  end_date,
  starts_at,
  ends_at,
  timezone
)
select
  event.id,
  0,
  true,
  event.start_date,
  event.end_date,
  null,
  null,
  event.timezone
from public.events as event
where event.is_all_day
  and event.start_date is not null
  and event.end_date is not null
  and event.end_date >= event.start_date
  and nullif(btrim(event.timezone), '') is not null
  and jsonb_array_length(
    case
      when jsonb_typeof(event.occurrence_dates) = 'array' then event.occurrence_dates
      else '[]'::jsonb
    end
  ) = 0
  and not exists (
    select 1
    from public.event_schedule_segments as existing
    where existing.event_id = event.id
  );

create table if not exists public.event_translations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  locale text not null check (locale in ('en', 'ja')),
  title text not null,
  description text,
  institution_name text,
  venue_name text,
  address_text text,
  date_text text,
  source_url text,
  source_content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, locale)
);

alter table public.events
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists city text,
  add column if not exists schedule_type text default 'unknown',
  add column if not exists occurrence_dates jsonb default '[]'::jsonb;

update public.events as event
set city = coalesce(nullif(source.city, ''), 'kyoto')
from public.sources as source
where source.id = event.source_id
  and event.city is distinct from coalesce(nullif(source.city, ''), 'kyoto');

update public.events
set schedule_type = 'unknown'
where schedule_type is null
  or schedule_type not in ('range', 'occurrence_set', 'unknown');

update public.events
set occurrence_dates = '[]'::jsonb
where occurrence_dates is null
  or jsonb_typeof(occurrence_dates) <> 'array';

alter table public.events
  alter column city set not null,
  alter column schedule_type set default 'unknown',
  alter column schedule_type set not null,
  alter column occurrence_dates set default '[]'::jsonb,
  alter column occurrence_dates set not null;

alter table public.events drop constraint if exists events_schedule_type_check;
alter table public.events
  add constraint events_schedule_type_check
  check (schedule_type in ('range', 'occurrence_set', 'unknown'));

alter table public.events drop constraint if exists events_occurrence_dates_array_check;
alter table public.events
  add constraint events_occurrence_dates_array_check
  check (jsonb_typeof(occurrence_dates) = 'array');

update public.events
set status = 'archived'
where status = 'published'
  and start_date is null
  and calendar_starts_at is null
  and jsonb_array_length(occurrence_dates) = 0;

alter table public.events drop constraint if exists events_date_presence_check;
alter table public.events
  add constraint events_date_presence_check check (
    status <> 'published'
    or start_date is not null
    or calendar_starts_at is not null
    or jsonb_array_length(occurrence_dates) > 0
  ) not valid;
alter table public.events validate constraint events_date_presence_check;

alter table public.event_translations
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists event_id uuid,
  add column if not exists locale text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists institution_name text,
  add column if not exists venue_name text,
  add column if not exists address_text text,
  add column if not exists date_text text,
  add column if not exists source_url text,
  add column if not exists source_content_hash text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.event_translations
set id = gen_random_uuid()
where id is null;

update public.event_translations as translation
set title = event.title
from public.events as event
where event.id = translation.event_id
  and (translation.title is null or btrim(translation.title) = '');

delete from public.event_translations as translation
where translation.event_id is null
  or translation.locale not in ('en', 'ja')
  or translation.title is null
  or btrim(translation.title) = ''
  or not exists (
    select 1
    from public.events as event
    where event.id = translation.event_id
  );

with ranked as (
  select
    id,
    row_number() over (
      partition by event_id, locale
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.event_translations
)
delete from public.event_translations as translation
using ranked
where ranked.id = translation.id
  and ranked.row_number > 1;

alter table public.event_translations
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column event_id set not null,
  alter column locale set not null,
  alter column title set not null,
  alter column institution_name drop not null,
  alter column date_text drop not null,
  alter column source_url drop not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_translations'::regclass
      and contype = 'p'
  ) then
    alter table public.event_translations
      add constraint event_translations_pkey primary key (id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_translations'::regclass
      and conname = 'event_translations_event_id_fkey'
  ) then
    alter table public.event_translations
      add constraint event_translations_event_id_fkey
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_translations'::regclass
      and conname = 'event_translations_locale_check'
  ) then
    alter table public.event_translations
      add constraint event_translations_locale_check
      check (locale in ('en', 'ja'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sources'::regclass
      and conname = 'sources_slug_key'
  ) then
    if to_regclass('public.sources_slug_idx') is not null then
      alter table public.sources
        add constraint sources_slug_key unique using index sources_slug_idx;
    else
      alter table public.sources add constraint sources_slug_key unique (slug);
    end if;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_translations'::regclass
      and conname = 'event_translations_event_id_locale_key'
  ) then
    if to_regclass('public.event_translations_event_id_locale_idx') is not null then
      alter table public.event_translations
        add constraint event_translations_event_id_locale_key
        unique using index event_translations_event_id_locale_idx;
    else
      alter table public.event_translations
        add constraint event_translations_event_id_locale_key unique (event_id, locale);
    end if;
  end if;
end;
$$;

drop index if exists public.sources_slug_idx;
drop index if exists public.event_translations_event_id_locale_idx;
drop index if exists public.event_translations_event_id_idx;

create index if not exists sources_city_idx on public.sources (city);
create index if not exists crawl_runs_source_id_idx on public.crawl_runs (source_id, created_at desc);
create index if not exists raw_pages_source_id_idx on public.raw_pages (source_id, fetched_at desc);
create index if not exists raw_pages_crawl_run_id_idx on public.raw_pages (crawl_run_id);
create index if not exists raw_pages_url_idx on public.raw_pages (url);

create index if not exists events_source_id_idx on public.events (source_id);
create index if not exists events_raw_page_id_idx on public.events (raw_page_id);
drop index if exists public.events_city_status_start_date_idx;
create index if not exists events_published_city_start_date_idx
  on public.events (city, start_date)
  where status = 'published';
create index if not exists events_status_idx on public.events (status);
create index if not exists events_start_date_idx on public.events (start_date);
create index if not exists events_last_seen_at_idx on public.events (last_seen_at desc);
create index if not exists events_institution_name_idx on public.events (institution_name);
create index if not exists events_categories_gin_idx on public.events using gin (categories);
create unique index if not exists events_dedupe_key_idx on public.events (dedupe_key);
create index if not exists event_translations_locale_idx on public.event_translations (locale);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
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

create or replace function public.set_event_city()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select source.city
  into new.city
  from public.sources as source
  where source.id = new.source_id;

  if new.city is null then
    raise exception 'No source city found for source_id %', new.source_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_events_city on public.events;
create trigger set_events_city
before insert or update of source_id, city on public.events
for each row
execute function public.set_event_city();

create or replace function public.propagate_source_city()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.events
  set city = new.city
  where source_id = new.id
    and city is distinct from new.city;
  return new;
end;
$$;

drop trigger if exists propagate_source_city on public.sources;
create trigger propagate_source_city
after update of city on public.sources
for each row
when (old.city is distinct from new.city)
execute function public.propagate_source_city();

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row
execute function public.set_updated_at();

drop trigger if exists set_event_translations_updated_at on public.event_translations;
create trigger set_event_translations_updated_at
before update on public.event_translations
for each row
execute function public.set_updated_at();

alter table public.sources enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.raw_pages enable row level security;
alter table public.events enable row level security;
alter table public.event_translations enable row level security;
alter table public.event_schedule_segments enable row level security;

-- Internal crawler tables intentionally have no anon/authenticated policies.
-- The crawler uses the service role, which bypasses RLS.

drop policy if exists "Public can read published events" on public.events;
create policy "Public can read published events"
on public.events
for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Public can read published event translations" on public.event_translations;
create policy "Public can read published event translations"
on public.event_translations
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.events
    where events.id = event_translations.event_id
      and events.status = 'published'
  )
);

drop policy if exists "Public can read published event schedule segments"
on public.event_schedule_segments;
create policy "Public can read published event schedule segments"
on public.event_schedule_segments
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.events
    where events.id = event_schedule_segments.event_id
      and events.status = 'published'
  )
);

create or replace function public.prune_sources(p_city text, p_slugs text[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_ids uuid[];
  requested_count integer;
  source_count integer;
  removed_event_count integer;
  removed_source_count integer;
begin
  if nullif(btrim(p_city), '') is null
    or p_slugs is null
    or cardinality(p_slugs) = 0
    or array_position(p_slugs, null) is not null
  then
    raise exception 'city and non-null source slugs are required';
  end if;

  select count(distinct slug)
  into requested_count
  from unnest(p_slugs) as slug;

  if requested_count <> cardinality(p_slugs) then
    raise exception 'duplicate source slugs are not allowed';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]), count(*)
  into source_ids, source_count
  from public.sources
  where city = p_city
    and slug = any(p_slugs);

  if source_count <> requested_count then
    raise exception 'prune source set changed; expected %, found %', requested_count, source_count;
  end if;

  delete from public.events
  where source_id = any(source_ids);
  get diagnostics removed_event_count = row_count;

  delete from public.sources
  where id = any(source_ids);
  get diagnostics removed_source_count = row_count;

  return jsonb_build_object(
    'removed_sources', removed_source_count,
    'removed_events', removed_event_count
  );
end;
$$;

create or replace function public.prune_raw_pages(
  p_older_than interval default interval '14 days',
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if p_older_than is null or p_older_than < interval '1 day' then
    raise exception 'p_older_than must be at least one day';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'p_limit must be between 1 and 10000';
  end if;

  with ranked as (
    select
      raw_page.id,
      raw_page.fetched_at,
      row_number() over (
        partition by raw_page.source_id, raw_page.url
        order by raw_page.fetched_at desc, raw_page.id desc
      ) as retention_rank
    from public.raw_pages as raw_page
  ), candidates as (
    select ranked.id
    from ranked
    where ranked.retention_rank > 3
      and ranked.fetched_at < now() - p_older_than
      and not exists (
        select 1
        from public.events as event
        where event.raw_page_id = ranked.id
      )
    order by ranked.fetched_at
    limit p_limit
  ), deleted as (
    delete from public.raw_pages as raw_page
    using candidates
    where raw_page.id = candidates.id
    returning raw_page.id
  )
  select count(*)
  into removed_count
  from deleted;

  return removed_count;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_event_city() from public, anon, authenticated;
revoke execute on function public.propagate_source_city() from public, anon, authenticated;
revoke execute on function public.prune_sources(text, text[]) from public, anon, authenticated;
revoke execute on function public.prune_raw_pages(interval, integer)
  from public, anon, authenticated;

grant execute on function public.prune_sources(text, text[]) to service_role;
grant execute on function public.prune_raw_pages(interval, integer) to service_role;

do $$
declare
  target record;
begin
  for target in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'rls_auto_enable'
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      target.schema_name,
      target.function_name,
      target.arguments
    );
  end loop;
end;
$$;

commit;
