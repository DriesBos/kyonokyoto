-- Website-facing source details (names, taxonomy, address, map pin, flags), written by
-- scripts/sync-sources.mjs on every crawl cycle. apps/web-next reads them at ISR time, so a new
-- source shows on the site after the next scheduled crawl, without a Netlify deploy.
alter table public.sources
  add column if not exists display jsonb not null default '{}'::jsonb;

-- public.sources keeps no anon policy (crawl internals). This view exposes only the display
-- column. It runs with the owner's rights (security_invoker off) on purpose, so anon can read
-- these three columns and nothing else of public.sources.
create or replace view public.source_profiles
with (security_invoker = false) as
select slug, city, display as profile
from public.sources
where display <> '{}'::jsonb;

revoke all on public.source_profiles from public, anon, authenticated;
grant select on public.source_profiles to anon, authenticated, service_role;
