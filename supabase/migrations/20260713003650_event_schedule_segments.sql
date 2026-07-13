begin;

create table public.event_schedule_segments (
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

alter table public.event_schedule_segments enable row level security;

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

commit;
