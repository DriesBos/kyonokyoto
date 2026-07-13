# Crawler Roadmap

Order matters.

## Option A: Stabilize Current Model

Status: active.

- Keep `events` as canonical shared data table.
- Keep `event_translations` as title/description-only at app/crawler level.
- Keep legacy translation metadata nullable; required identity/title fields are enforced.
- Use source JSON as source truth for venue identity, categories, address, directions, and coordinates.
- Add source config exceptions for predictable quirks:
  - `capabilities`
  - `selectors`
  - `crawl_hints`
  - `venue_locations`
- Require valid title, verified date, valid description, and final accepted media before persistence.
- Keep the shared final media pass as the boundary for generic, configured, and source-specific images.
- Use per-source `skip_og_image: true` when generic Open Graph media is not event media.
- Emit crawl QA report into `crawl_runs.logs`.

Exit criteria:

- Full crawl succeeds.
- Translation check passes for published events.
- Web build succeeds.
- Spot QA confirms dates, maps, images, and cards.

VPS crawl command:

```bash
cd /srv/kyo-no-kyoto
node scripts/run-crawl-cycle.mjs --city=kyoto
```

For production-style city runs from the repo root, use:

```bash
node scripts/run-crawl-cycle.mjs --city=kyoto
node scripts/run-crawl-cycle.mjs --city=osaka
node scripts/run-crawl-cycle.mjs --city=tokyo
```

`docs/dashboard.md` is the pre-refactor baseline. Compare extractor changes without fetching new pages:

```bash
npm --prefix apps/crawler run crawl:replay -- --city=kyoto
```

Replace `kyoto` with `osaka` or `tokyo`. Replay reads latest stored detail HTML and does not write events.

## Option B: Schedule Truth Rollout

Status: database migration applied 2026-07-13; application deploy pending.

Implemented contract:

- `event_schedule_segments` is canonical schedule truth.
- Crawler dual-writes legacy event schedule fields and ordered segment rows.
- Crawler preflights segment storage, stages each event as `draft`, writes segments and translations, then publishes. Partial writes stay non-public.
- Web reads segment rows first and falls back to legacy fields while rollout is incomplete.
- Legacy timed rows are not backfilled because existing timestamps may represent venue opening hours, not event moments.
- Legacy fields remain until production crawl and web QA pass.

Rollout order:

1. Applied `supabase/migrations/20260713003650_event_schedule_segments.sql` remotely on 2026-07-13.
2. Deploy crawler dual-write. Do not deploy or run updated crawler before migration exists.
3. Run city crawls and verify segment rows against legacy envelopes.
4. Deploy web segment-first read with legacy fallback. Do not deploy updated web before migration exists because event query joins the new table.
5. Compare crawl outcomes with `docs/dashboard.md`; run web build and spot QA dates/cards.
6. Retire legacy schedule fields only after stable production evidence.

Migration is applied and verified remotely. Application deploy has not run yet.

## Option C: Clean Translation Schema

Status: wait until Option A and schedule rollout exit criteria pass.

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

## Option D: Split Crawler Internals

Status: started; continue after schedule truth rollout.

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
