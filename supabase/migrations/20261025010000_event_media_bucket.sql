-- Public bucket for event images the crawler copies from origins that block
-- image fetches from outside Japan (sources with `rehost_images: true`).
-- Public buckets serve reads without RLS; only the service role uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  12582912,
  array['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
