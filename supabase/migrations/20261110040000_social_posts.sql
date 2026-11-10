-- Instagram auto poster (docs/instagram-autopost.md).
-- social_posts: posts Dries approved on the Socials tab (local + preview builds). The VPS
-- publisher (apps/crawler/src/social-publish.mjs, service role) posts one approved row a day and
-- marks it published / failed / expired.
-- Anyone may read the queue (titles and captions are public anyway). Writes from the browser go
-- only through social_approve / social_cancel, which check a passphrase whose bcrypt hash sits in
-- private.social_settings, so the public preview URL cannot queue posts.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.social_settings (
  id boolean primary key default true check (id),
  passphrase_hash text not null
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  city text not null,
  event_id text not null,
  event_title text not null,
  venue text,
  event_date_text text,
  -- packages/shared/social-post.mjs: box inset in the post, or flush with its left/right edges
  layout text not null default 'inset' check (layout in ('inset', 'flush')),
  image_url text not null check (image_url ~ '^https?://'),
  caption text not null check (char_length(caption) between 1 and 2200),
  event_start_date date,
  event_end_date date,
  status text not null default 'approved'
    check (status in ('approved', 'published', 'failed', 'cancelled', 'expired')),
  published_at timestamptz,
  instagram_media_id text,
  composed_url text,
  error text
);

-- An event is queued or posted at most once.
create unique index if not exists social_posts_one_live_per_event
  on public.social_posts (city, event_id)
  where status in ('approved', 'published');

create index if not exists social_posts_queue
  on public.social_posts (status, event_end_date, created_at);

alter table public.social_posts enable row level security;

drop policy if exists social_posts_public_read on public.social_posts;
create policy social_posts_public_read on public.social_posts
  for select to anon, authenticated using (true);

grant select on public.social_posts to anon, authenticated;
revoke insert, update, delete on public.social_posts from anon, authenticated;

create or replace function private.social_passphrase_ok(passphrase text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.social_settings settings
    where coalesce(passphrase, '') <> ''
      and settings.passphrase_hash = extensions.crypt(passphrase, settings.passphrase_hash)
  );
$$;

create or replace function public.social_approve(passphrase text, post jsonb)
returns public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.social_posts;
begin
  if not private.social_passphrase_ok(passphrase) then
    raise exception 'wrong passphrase' using errcode = '28P01';
  end if;
  insert into public.social_posts (
    city, event_id, event_title, venue, event_date_text, layout, image_url, caption,
    event_start_date, event_end_date
  )
  values (
    post ->> 'city',
    post ->> 'event_id',
    post ->> 'event_title',
    post ->> 'venue',
    post ->> 'event_date_text',
    coalesce(post ->> 'layout', 'inset'),
    post ->> 'image_url',
    post ->> 'caption',
    nullif(post ->> 'event_start_date', '')::date,
    nullif(post ->> 'event_end_date', '')::date
  )
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.social_cancel(passphrase text, post_id uuid)
returns public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.social_posts;
begin
  if not private.social_passphrase_ok(passphrase) then
    raise exception 'wrong passphrase' using errcode = '28P01';
  end if;
  update public.social_posts
  set status = 'cancelled', updated_at = now()
  where id = post_id and status = 'approved'
  returning * into saved;
  if saved.id is null then
    raise exception 'post not found or already posted';
  end if;
  return saved;
end;
$$;

revoke all on function private.social_passphrase_ok(text) from public, anon, authenticated;
revoke all on function public.social_approve(text, jsonb) from public;
revoke all on function public.social_cancel(text, uuid) from public;
grant execute on function public.social_approve(text, jsonb) to anon, authenticated;
grant execute on function public.social_cancel(text, uuid) to anon, authenticated;

-- Set or change the passphrase (SQL editor; not part of the migration):
-- insert into private.social_settings (passphrase_hash)
-- values (extensions.crypt('<long passphrase>', extensions.gen_salt('bf')))
-- on conflict (id) do update set passphrase_hash = excluded.passphrase_hash;
