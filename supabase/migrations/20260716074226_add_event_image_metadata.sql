alter table public.events
  add column if not exists image_metadata jsonb not null default '[]'::jsonb;

alter table public.events
  drop constraint if exists events_image_metadata_array_check;

alter table public.events
  add constraint events_image_metadata_array_check
  check (jsonb_typeof(image_metadata) = 'array');
