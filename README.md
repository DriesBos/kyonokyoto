# kyo-no-kyoto

Multi-city cultural events app for Kyoto, Osaka, and Tokyo.

Source JSON defines venue truth. VPS crawler fetches event pages, stores normalized events and raw evidence in Supabase, and Astro serves city/locale routes from Netlify SSR with CDN revalidation.

## Structure

- `apps/web` — Astro SSR frontend
- `apps/crawler` — Node crawler plus Crawl4AI bridge
- `data/sources` — authoritative city source config
- `packages/shared` — shared event schedule/dedupe helpers
- `supabase/migrations` — database change history
- `supabase/schema.sql` — current idempotent schema snapshot
- `ops` — VPS deploy and systemd templates

## Requirements

- Node `22.22.0` or a newer Node 22 release
- npm
- Python 3.12 for Crawl4AI
- Supabase project

## Install

```bash
npm ci
npm ci --prefix apps/crawler
npm ci --prefix apps/web
```

Use committed npm lockfiles. Do not regenerate pnpm metadata.

## Environment

Copy committed examples; never commit real secrets.

Web requires:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
PUBLIC_GOOGLE_MAPS_API_KEY=
PUBLIC_GOOGLE_MAPS_MAP_ID_KYOTO=
PUBLIC_GOOGLE_MAPS_MAP_ID_OSAKA=
PUBLIC_GOOGLE_MAPS_MAP_ID_TOKYO=
```

Crawler requires:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRAWL4AI_RENDER_MODE=auto
CRAWL_HEARTBEAT_URL=
CRAWL_ALERT_WEBHOOK_URL=
```

Production systemd sets `CRAWL4AI_PYTHON` and `CRAWL4_AI_BASE_DIRECTORY` to paths under `/srv/kyo-no-kyoto/apps/crawler`.

## Database

Create schema changes with Supabase CLI migrations:

```bash
npx supabase migration new change_name
```

Test locally with `supabase db reset`, then coordinate one remote `supabase db push`. Do not edit live schema first. Keep `supabase/schema.sql` aligned with migrations.

Apply database migrations before deploying crawler or web code. Current code requires `events.city` and translation provenance columns from the tracked migration.

Current migration also provides:

- authoritative `events.city`, derived from `sources.city`
- validated published-event date rules
- service-role-only `prune_sources` and `prune_raw_pages` RPCs
- raw-page cleanup capped at 1,000 rows per default call, retaining referenced pages and latest three captures per source URL

## Source Sync

Normal sync only upserts configured sources:

```bash
node scripts/sync-sources.mjs --city=kyoto
```

Missing config rows appear as prune candidates but stay untouched. Removal requires explicit count confirmation:

```bash
node scripts/sync-sources.mjs --city=kyoto --prune --confirm-prune=1
```

Removing at least five rows or 25% of city rows also requires `--allow-large-prune`. Empty config can never prune.

## Crawl

Tune one source:

```bash
npm --prefix apps/crawler run crawl:once -- --city=kyoto --source=<slug>
```

Run production-style city cycle from repo root:

```bash
node scripts/run-crawl-cycle.mjs --city=kyoto
```

Cycle updates clean `main`, syncs without pruning, crawls, checks translations, and reports status. Web reads Supabase through SSR/cache revalidation; crawl cycles do not trigger Netlify deploys.

See `docs/adding-sources.md`, `docs/source-config.md`, and `QA-routine.md` for source tuning.

## Checks

```bash
npm run format:check
npm --prefix apps/crawler test
npm --prefix apps/web test
npm --prefix apps/web run build
node scripts/source-sync-safety.mjs
```

`.github/workflows/deploy-vps.yml` runs these gates for pull requests and `main`. Only verified non-PR runs invoke restricted VPS SSH deploy. Netlify builds web changes from Git using root `netlify.toml`.
