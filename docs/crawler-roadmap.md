# Crawler Roadmap

Order matters.

## Option A: Stabilize Current Model

Status: active.

- Keep `events` as canonical shared data table.
- Keep `event_translations` as title/description-only at app/crawler level.
- Leave legacy translation columns nullable until after successful recrawl.
- Use source JSON as source truth for venue identity, categories, address, directions, and coordinates.
- Add source config exceptions for predictable quirks:
  - `capabilities`
  - `selectors`
  - `crawl_hints`
  - `venue_locations`
- Emit crawl QA report into `crawl_runs.logs`.

Exit criteria:

- Full crawl succeeds.
- Translation check passes for published events.
- Web build succeeds.
- Spot QA confirms dates, maps, images, and cards.

VPS crawl command, when repo path is known:

```bash
cd /home/ubuntu/kyo-no-kyoto/apps/crawler && \
git pull && \
npm install && \
npm run crawl:all -- --city=kyoto && \
npm run translations:check
```

If repo path is unknown, find `apps/crawler` first:

```bash
find /home/ubuntu -maxdepth 5 -type d -path "*/apps/crawler"
```

If nothing shows:

```bash
find / -type d -path "*/apps/crawler" 2>/dev/null | head -20
```

Then run the crawl from the returned path:

```bash
cd /returned/path/apps/crawler && \
git pull && \
npm install && \
npm run crawl:all -- --city=kyoto && \
npm run translations:check
```

For production-style city runs from the repo root, use:

```bash
node scripts/run-crawl-cycle.mjs --city=kyoto
node scripts/run-crawl-cycle.mjs --city=osaka
node scripts/run-crawl-cycle.mjs --city=tokyo
```

## Option C: Split Crawler Internals

Status: started.

First split:

- `src/crawl-qa.mjs` owns crawl health summaries.
- `data/sources/source-config.mjs` owns config normalization and validation.

Next split:

- `src/fetching.mjs`: static fetch, Crawl4AI fetch, retry/rate-limit logic.
- `src/source-options.mjs`: capabilities, crawl hints, URL skips.
- `src/generic-selectors.mjs`: config selector extraction.
- `src/translations.mjs`: native alternate lookup + Google Translate fallback.
- `src/persistence.mjs`: Supabase REST upserts.
- `src/extractors/*.mjs`: source-specific extractors.

Keep `run-once.mjs` as orchestration only.

## Option B: Clean Schema

Status: wait until Option A exit criteria pass.

Target table:

```sql
create table public.event_translations_v2 (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  locale text not null check (locale in ('en', 'ja')),
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, locale)
);
```

Migration path:

1. Backfill from current `event_translations`.
2. Switch crawler/web to slim table.
3. Run full crawl + build.
4. Drop old locale metadata columns or rename v2 table.

Do not drop legacy columns before one successful production crawl.
