begin;

-- Publisher identity is separate from an event's actual venue.
alter table public.sources
  add column if not exists source_kind text not null default 'venue'
    check (source_kind in ('venue', 'aggregator')),
  add column if not exists beta boolean not null default false,
  add column if not exists source_priority integer not null default 100
    check (source_priority >= 0);

create table public.event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  source_event_key text not null check (btrim(source_event_key) <> ''),
  source_url text not null,
  raw_page_id uuid references public.raw_pages(id) on delete set null,
  match_key text,
  review_key text,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  schedule_segments jsonb not null check (jsonb_typeof(schedule_segments) = 'array'),
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  unique (source_id, source_event_key)
);
create index event_sources_event_id_idx on public.event_sources(event_id);
create index event_sources_raw_page_id_idx on public.event_sources(raw_page_id);
create index event_sources_match_key_idx on public.event_sources(match_key) where match_key is not null;
create index event_sources_review_key_idx on public.event_sources(review_key) where review_key is not null;

-- Uncertain matches remain separate cards in beta, with a durable QA decision.
create table public.event_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  other_event_id uuid not null references public.events(id) on delete cascade,
  reason text not null default 'same venue and season; identity needs review',
  status text not null default 'pending' check (status in ('pending', 'separate', 'merged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_id < other_event_id),
  unique(event_id, other_event_id)
);
create index event_duplicate_candidates_other_event_idx on public.event_duplicate_candidates(other_event_id);

alter table public.event_sources enable row level security;
alter table public.event_duplicate_candidates enable row level security;
-- Evidence and review decisions are crawler/admin-only, never anonymously exposed.
revoke all on public.event_sources, public.event_duplicate_candidates from anon, authenticated;
grant select, insert, update, delete on public.event_sources, public.event_duplicate_candidates to service_role;

create function public.ingest_temple_event(
  p_source_id uuid,
  p_raw_page_id uuid,
  p_source_event_key text,
  p_match_key text,
  p_review_key text,
  p_event jsonb,
  p_segments jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  publisher public.sources;
  target public.events;
  incoming public.events;
  preferred public.event_sources;
  observed public.event_sources;
  matches uuid[];
  candidate_id uuid;
  pending_count integer;
  changed boolean := false;
  new_id uuid;
begin
  select * into strict publisher from public.sources where id = p_source_id;
  if publisher.source_kind <> 'aggregator' or publisher.city <> 'kyoto' then
    raise exception 'Temple ingestion requires a Kyoto aggregator source';
  end if;
  if p_source_event_key is null or btrim(p_source_event_key) = '' then
    raise exception 'Missing stable source event identity';
  end if;
  if coalesce(jsonb_typeof(p_segments), 'null') <> 'array' or coalesce(jsonb_array_length(p_segments), 0) = 0 then
    raise exception 'Temple ingestion requires verified schedule segments';
  end if;
  -- Serialize small Kyoto aggregator ingestion transactions, including date corrections.
  -- Prevents two publishers racing to create the same canonical event.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('temple-ingest:' || publisher.city, 0));
  select event.* into target
  from public.event_sources as observation
  join public.events as event on event.id = observation.event_id
  where observation.source_id = p_source_id and observation.source_event_key = p_source_event_key;

  if target.id is null and p_match_key is not null then
    select array_agg(distinct event.id) into matches
    from public.event_sources as observation
    join public.events as event on event.id = observation.event_id
    join public.sources as primary_publisher on primary_publisher.id = event.source_id
    where observation.match_key = p_match_key and observation.is_active
      and event.city = publisher.city and event.event_kind = 'event'
      and primary_publisher.beta = publisher.beta
;
    if cardinality(matches) = 1 then
      select * into target from public.events where id = matches[1];
    end if;
  end if;

  incoming := jsonb_populate_record(null::public.events, p_event);
  if incoming.venue_name is null or btrim(incoming.venue_name) = ''
     or incoming.address_text is null or btrim(incoming.address_text) = ''
     or incoming.title is null or btrim(incoming.title) = ''
     or not coalesce('collection:temples-gardens' = any(incoming.categories), false) then
    raise exception 'Temple event requires actual venue, address, title, and collection';
  end if;
  if target.id is null then
    new_id := gen_random_uuid();
    insert into public.events (
      id, source_id, city, raw_page_id, dedupe_key, status,
      external_id, title, categories, description, institution_name, venue_name, address_text, directions_query, lat, lng, date_text, start_date, end_date, schedule_type, occurrence_dates, start_time_text, end_time_text, is_all_day, timezone, calendar_starts_at, calendar_ends_at, primary_image_url, image_urls, image_metadata, source_url, extraction_confidence
    ) values (
      new_id, p_source_id, publisher.city, p_raw_page_id, 'temple:' || new_id::text, 'draft',
      incoming.external_id, incoming.title, coalesce(incoming.categories, '{}'::text[]), incoming.description, incoming.institution_name, incoming.venue_name, incoming.address_text, incoming.directions_query, incoming.lat, incoming.lng, incoming.date_text, incoming.start_date, incoming.end_date, coalesce(incoming.schedule_type, 'range'), coalesce(incoming.occurrence_dates, '[]'::jsonb), incoming.start_time_text, incoming.end_time_text, coalesce(incoming.is_all_day, true), coalesce(incoming.timezone, 'Asia/Tokyo'), incoming.calendar_starts_at, incoming.calendar_ends_at, incoming.primary_image_url, coalesce(incoming.image_urls, '[]'::jsonb), coalesce(incoming.image_metadata, '[]'::jsonb), incoming.source_url, incoming.extraction_confidence
    ) returning * into target;
  end if;

  insert into public.event_sources (
    event_id, source_id, source_event_key, source_url, raw_page_id,
    match_key, review_key, facts, schedule_segments
  ) values (
    target.id, p_source_id, p_source_event_key, incoming.source_url, p_raw_page_id,
    p_match_key, p_review_key, p_event, p_segments
  ) on conflict (source_id, source_event_key) do update set
    source_url = excluded.source_url, raw_page_id = excluded.raw_page_id,
    match_key = excluded.match_key, review_key = excluded.review_key,
    facts = excluded.facts, schedule_segments = excluded.schedule_segments,
    is_active = true, last_seen_at = now()
  returning * into observed;

  if p_review_key is not null then
    for candidate_id in
      select distinct event.id
      from public.event_sources as observation
      join public.events as event on event.id = observation.event_id
      join public.sources as primary_publisher on primary_publisher.id = event.source_id
      where observation.review_key = p_review_key and observation.event_id <> target.id
        and observation.is_active and event.city = publisher.city
        and primary_publisher.beta = publisher.beta
    loop
      insert into public.event_duplicate_candidates(event_id, other_event_id)
      values (least(target.id, candidate_id), greatest(target.id, candidate_id))
      on conflict(event_id, other_event_id) do nothing;
    end loop;
  end if;

  select observation.* into strict preferred
  from public.event_sources as observation
  join public.sources as source on source.id = observation.source_id
  where observation.event_id = target.id and observation.is_active and source.is_active
    and source.beta = publisher.beta
  order by source.source_priority asc, source.slug asc, observation.last_seen_at desc
  limit 1;
  -- Lower-priority publishers add evidence without replacing trusted facts or translations.
  if preferred.id = observed.id then
    update public.events set
      source_id = p_source_id, raw_page_id = p_raw_page_id,
      status = case when status in ('hidden', 'archived') then status else 'draft' end,
      external_id = incoming.external_id,
      title = incoming.title,
      categories = coalesce(incoming.categories, '{}'::text[]),
      description = incoming.description,
      institution_name = incoming.institution_name,
      venue_name = incoming.venue_name,
      address_text = incoming.address_text,
      directions_query = incoming.directions_query,
      lat = incoming.lat,
      lng = incoming.lng,
      date_text = incoming.date_text,
      start_date = incoming.start_date,
      end_date = incoming.end_date,
      schedule_type = coalesce(incoming.schedule_type, 'range'),
      occurrence_dates = coalesce(incoming.occurrence_dates, '[]'::jsonb),
      start_time_text = incoming.start_time_text,
      end_time_text = incoming.end_time_text,
      is_all_day = coalesce(incoming.is_all_day, true),
      timezone = coalesce(incoming.timezone, 'Asia/Tokyo'),
      calendar_starts_at = incoming.calendar_starts_at,
      calendar_ends_at = incoming.calendar_ends_at,
      primary_image_url = incoming.primary_image_url,
      image_urls = coalesce(incoming.image_urls, '[]'::jsonb),
      image_metadata = coalesce(incoming.image_metadata, '[]'::jsonb),
      source_url = incoming.source_url,
      extraction_confidence = incoming.extraction_confidence,
      last_seen_at = now()
    where id = target.id returning * into target;
    delete from public.event_schedule_segments where event_id = target.id;
    insert into public.event_schedule_segments(event_id, ordinal, is_all_day, start_date, end_date, starts_at, ends_at, timezone)
    select target.id, (entry.ordinality - 1)::integer,
      coalesce((entry.value->>'is_all_day')::boolean, true),
      (entry.value->>'start_date')::date, (entry.value->>'end_date')::date,
      (entry.value->>'starts_at')::timestamptz, (entry.value->>'ends_at')::timestamptz,
      coalesce(entry.value->>'timezone', 'Asia/Tokyo')
    from jsonb_array_elements(p_segments) with ordinality as entry(value, ordinality);
    changed := true;
  end if;
  select count(*) into pending_count from public.event_duplicate_candidates
    where status = 'pending' and target.id in (event_id, other_event_id);
  return jsonb_build_object('event', to_jsonb(target), 'canonical_updated', changed,
    'duplicate_candidates', pending_count, 'observation_id', observed.id);
end;
$$;
revoke all on function public.ingest_temple_event(uuid,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_temple_event(uuid,uuid,text,text,text,jsonb,jsonb) to service_role;

create function public.finish_temple_source_scan(p_source_id uuid, p_seen_keys text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sources where id = p_source_id and source_kind = 'aggregator') then
    raise exception 'Expected aggregator source';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('temple-ingest:kyoto', 0));
  update public.event_sources set is_active = false
    where source_id = p_source_id and not (source_event_key = any(coalesce(p_seen_keys, '{}'::text[])));
  -- Disappearance is evidence, not cancellation. Canonical events expire by their verified
  -- dates; a missing or paginated listing can never withdraw another publisher's event.
end;
$$;
revoke all on function public.finish_temple_source_scan(uuid,text[]) from public, anon, authenticated;
grant execute on function public.finish_temple_source_scan(uuid,text[]) to service_role;

create function public.finalize_temple_event(
  p_event_id uuid, p_source_id uuid, p_revision timestamptz, p_translations jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_event public.events;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('temple-ingest:kyoto', 0));
  select * into current_event from public.events where id = p_event_id for update;
  if current_event.id is null or current_event.source_id <> p_source_id
     or current_event.updated_at is distinct from p_revision
     or current_event.status in ('hidden', 'archived') then
    return false;
  end if;
  if not exists (select 1 from public.sources where id = p_source_id and source_kind = 'aggregator') then
    raise exception 'Expected aggregator source';
  end if;
  if coalesce(jsonb_typeof(p_translations), 'null') <> 'array' or jsonb_array_length(p_translations) = 0 then
    raise exception 'At least one verified translation is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_translations) as item(value)
    where coalesce(item.value->>'source_content_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(btrim(item.value->>'title'), '') = ''
  ) then
    raise exception 'Invalid translation provenance';
  end if;
  delete from public.event_translations where event_id = p_event_id;
  insert into public.event_translations(event_id, locale, title, description, source_content_hash)
    select p_event_id, value->>'locale', value->>'title', value->>'description', value->>'source_content_hash'
    from jsonb_array_elements(p_translations);
  update public.events set status = 'published', published_at = coalesce(published_at, now()) where id = p_event_id;
  return true;
end;
$$;
revoke all on function public.finalize_temple_event(uuid,uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_temple_event(uuid,uuid,timestamptz,jsonb) to service_role;

commit;
