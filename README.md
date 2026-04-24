# kyo-no-kyoto

Kyoto cultural events app.

The goal is to crawl museums, galleries, festival pages, and venue sites in Kyoto, normalize that data, store it in Supabase, and publish it through an Astro frontend.

## Structure

- `apps/web` - Astro frontend
- `apps/crawler` - crawler runtime env and future crawler code
- `packages/shared` - shared types and utilities
- `supabase` - database schema and migrations
- `docs` - project notes and skill references

## Requirements

- Node `>= 22.12.0`
- npm
- Supabase project

## Environment

Root:
- `.env` for shared local infra values
- `.env.example` as the template

App-specific:
- `apps/web/.env`
- `apps/crawler/.env`

Do not commit real secrets. Commit only `*.env.example`.

## Web Setup

Install dependencies:

```bash
cd apps/web
npm install
```

Run the Astro dev server:

```bash
npm run dev
```

Motion note:
- Motion behavior is managed manually in app code and styles.
- There are no built-in `prefers-reduced-motion` checks wired into the web app right now.

Current public env vars used by the web app:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Crawler Setup

Crawler env lives in:

```bash
apps/crawler/.env
```

Current crawler config expects:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
CRAWLER_TIMEZONE=Asia/Tokyo
CRAWLER_SCHEDULE=15 3 * * *
NETLIFY_BUILD_HOOK_URL=
CRAWL4AI_RENDER_MODE=auto
```

Current automation recommendation:
- sync sources to Supabase
- crawl all active sources
- archive previously published events that were not seen in a successful source crawl
- trigger a Netlify rebuild hook

For the current production plan, use a daily cron job on the VPS.

## Git

This project uses one root repository for both apps.

Recommended future deployment split:
- one workflow for `apps/web`
- one workflow for `apps/crawler`

## Current Status

Done:
- Supabase project initialized
- Astro app scaffolded
- web Supabase client dependency installed
- root git repo initialized

Next:
- define source batch
- define event schema
- scaffold crawler code
- connect data flow from crawler to Supabase to Astro

## Crawler Tuning

Best quick loop for finetuning the crawler:

1. Seed sources:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" node scripts/sync-sources.mjs
```

2. Crawl one source while tuning:

```bash
cd apps/crawler
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run crawl:once -- --source=<slug>
```

3. Crawl everything for QA:

```bash
cd apps/crawler
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run crawl:all -- --generic-limit=6
```

4. Run the full production-style cycle locally:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" node scripts/run-crawl-cycle.mjs
```

Create or reuse the Netlify build hook and write it into `apps/crawler/.env`:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" node scripts/create-netlify-build-hook.mjs
```

Useful flags:

```bash
node scripts/run-crawl-cycle.mjs --skip-deploy
node scripts/run-crawl-cycle.mjs --skip-sync
node scripts/run-crawl-cycle.mjs --generic-limit=8
cd apps/crawler && npm run crawl:once -- --source=<slug> --render=always
node scripts/create-netlify-build-hook.mjs --name="Daily crawler deploy"
```

Run crawler tests without touching live sites:

```bash
node --test apps/crawler/test/*.test.mjs
```

How to tune effectively:

- Start with `data/sources/kyoto-sources.json`:
  tighten `start_urls`, `allowed_domains`, and especially `event_page_patterns`.
- If a source is noisy, narrow the generic candidate set first by making `event_page_patterns` more specific.
- If a source is important and recurring, add a source-specific pair in `apps/crawler/src/run-once.mjs`:
  one detail URL extractor and one event extractor.
- Use generic mode for broad QA, then promote the noisiest sources to custom extractors one by one.
- When a source fetch fails entirely, test the homepage manually first; common causes are blocking, redirects, or bad start URLs.
- Lazy-loaded images are handled as a second pass when `CRAWL4AI_RENDER_MODE=auto`: the crawler keeps the normal static fetch first, then asks Crawl4AI to render and scroll detail pages whose extracted event has no image.
- JavaScript shell pages are also handled in `auto` mode: listing or detail pages classified as `js_shell` or `empty_or_suspicious` are retried with Crawl4AI before extraction continues.
- Source-page requests are paced per domain with `CRAWLER_MIN_DELAY_MS` and `CRAWLER_MAX_DELAY_MS`.
- Crawl4AI browser renders are capped per source with `CRAWL4AI_MAX_RENDERS_PER_SOURCE`.
- Each crawl run records structured diagnostics and a source outcome in `crawl_runs.logs`.
- Use `--render=always` only for sources whose listing or detail pages genuinely require JavaScript rendering.

Rule of thumb:
- Fix source config first.
- Add custom extraction second.
- Touch schema only when many sources need the same new field.

## Scheduler

Recommended production path:

1. Put the repo on the VPS.
2. Keep `apps/crawler/.env` populated with:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NETLIFY_BUILD_HOOK_URL`
3. Copy the example cron file from `ops/cron/`.
4. Adjust the repo path and Node path.
5. Install the cron entry:

```bash
crontab ops/cron/kyo-no-kyoto-crawl.cron.example
crontab -l
```

The example job runs daily at `03:15` server time.

Important:
- Supabase does not trigger a rebuild by itself here.
- The rebuild happens because `scripts/run-crawl-cycle.mjs` calls the Netlify build hook after a successful crawl.
- If you want Japan-local timing on a Europe-based VPS, either set the VPS timezone to JST or shift the cron time accordingly.
