begin;

with candidates as (
  select
    event.id,
    lower(split_part(event.source_url, '#', 2)) as external_id,
    'url:' || regexp_replace(split_part(event.source_url, '#', 1), '/+$', '') || '#' ||
      lower(split_part(event.source_url, '#', 2)) as dedupe_key
  from public.events as event
  join public.sources as source on source.id = event.source_id
  where source.slug in (
    'art-gallery-kitano',
    'chushin-bijutsu',
    'gallery-take-two',
    'hyogo-prefectural-museum-of-art'
  )
    and event.external_id is null
    and split_part(event.source_url, '#', 2) ~ '^[A-Za-z0-9-]+$'
)
update public.events as event
set
  external_id = candidate.external_id,
  dedupe_key = candidate.dedupe_key
from candidates as candidate
where event.id = candidate.id
  and not exists (
    select 1
    from public.events as existing
    where existing.id <> candidate.id
      and existing.dedupe_key = candidate.dedupe_key
  );

commit;
