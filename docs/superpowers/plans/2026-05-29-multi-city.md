# Multi-City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kyoto, Osaka, and Tokyo route-based city support with city-scoped data, theme colors, map config, crawler runs, and staggered VPS timer instances.

**Architecture:** Add a shared city registry, split source/permanent data by city, and route pages by `/[city]/[locale]/`. Keep one crawler codebase with city-scoped source loading and systemd instance timers protected by a global lock.

**Tech Stack:** Astro, TypeScript, Sass, Node ESM, Supabase REST, systemd timer units, Node test runner.

---

### Task 1: Shared city registry and data split

**Files:**

- Create: `apps/web/src/lib/cities.ts`
- Modify: `data/sources/source-config.mjs`
- Move/create: `data/permanent/kyoto-permanent.json`
- Create: `data/permanent/osaka-permanent.json`
- Create: `data/permanent/tokyo-permanent.json`
- Create: `data/sources/osaka-sources.json`
- Create: `data/sources/tokyo-sources.json`
- Create: `data/sources/overrides/kyoto-overrides.json`
- Create: `data/sources/overrides/osaka-overrides.json`
- Create: `data/sources/overrides/tokyo-overrides.json`
- Test: `apps/web/test/cities.test.mjs`
- Test: `apps/web/test/sources.test.mjs`

- [ ] Add city registry with slug, label, theme color, center, source/permanent filenames, and map ID env names.
- [ ] Split permanent venue JSON into `data/permanent/kyoto-permanent.json`; leave compatibility import only if needed.
- [ ] Add empty Osaka/Tokyo source and permanent JSON payloads.
- [ ] Update source config loader to accept `{ city }`, load city source file, load city override file, inject `city`.
- [ ] Keep `loadSourcesConfig()` defaulting to Kyoto for current callers.
- [ ] Add tests for valid city lookup, city cycle, global slug uniqueness, empty city config validity, and per-city source validation.

### Task 2: City routes, redirects, theme, header, landing, and map config

**Files:**

- Create: `apps/web/src/pages/[city]/[locale]/index.astro`
- Modify: `apps/web/src/pages/[locale]/index.astro`
- Modify: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/layouts/BaseLayout.astro`
- Modify: `apps/web/src/components/Header.astro`
- Modify: `apps/web/src/components/Landing.astro`
- Modify: `apps/web/src/components/GoogleMapCanvas.astro`
- Modify: `apps/web/src/scripts/googleMap.ts`
- Modify: `apps/web/src/scripts/landingScroll.ts`
- Modify: `apps/web/src/scripts/localeToggle.ts`
- Modify: `apps/web/public/sw.js`

- [ ] Move main route implementation to `/[city]/[locale]/`.
- [ ] Convert old `/[locale]/` route into redirect to `/kyoto/[locale]/`.
- [ ] Root redirect uses remembered city and resolved locale.
- [ ] `BaseLayout` sets `data-city`, root theme variable, and city-aware `theme-color`.
- [ ] Header city toggle sits between map and language and preserves language.
- [ ] Landing label and aria copy use active city label.
- [ ] Map center and map ID come from city registry/env fallback.
- [ ] Locale toggle preserves city route.
- [ ] Service worker cache name bumps to v3.

### Task 3: Database and crawler city scoping

**Files:**

- Modify: `supabase/schema.sql`
- Modify: `scripts/sync-sources.mjs`
- Modify: `scripts/seed-sources.mjs`
- Modify: `scripts/run-crawl-cycle.mjs`
- Modify: `apps/crawler/src/run-once.mjs`
- Modify: `apps/crawler/package.json`
- Test: `apps/crawler/test/extractors.test.mjs`

- [ ] Add `sources.city text not null default 'kyoto'` schema migration and index.
- [ ] `sync-sources --city=<city>` only upserts/deletes that city and includes `city` in payload.
- [ ] `seed-sources --city=<city>` includes `city`.
- [ ] `run-crawl-cycle --city=<city>` syncs and crawls that city, then runs translation check and rebuild.
- [ ] `run-crawl-cycle` uses a global lock and exits cleanly if lock exists.
- [ ] `run-once --city=<city> --source=all` uses only that city's source config and returns success for zero sources.
- [ ] Add package scripts for `crawl:kyoto`, `crawl:osaka`, and `crawl:tokyo`.

### Task 4: Ops docs and systemd templates

**Files:**

- Delete: `ops/systemd/kyo-no-kyoto-crawl.service.example`
- Delete: `ops/systemd/kyo-no-kyoto-crawl.timer.example`
- Create: `ops/systemd/kyo-no-kyoto-crawl@.service.example`
- Create: `ops/systemd/kyo-no-kyoto-crawl@kyoto.timer.example`
- Create: `ops/systemd/kyo-no-kyoto-crawl@osaka.timer.example`
- Create: `ops/systemd/kyo-no-kyoto-crawl@tokyo.timer.example`
- Modify: `ops/cron/kyo-no-kyoto-crawl.cron.example`
- Modify: `README.md`
- Modify: `docs/source-config.md`
- Modify: `docs/adding-sources.md`
- Modify: `docs/crawler-roadmap.md`

- [ ] Add systemd instance service using `%i` as city.
- [ ] Add 36h city timers with 2h30m stagger slots.
- [ ] Update cron example as fallback only.
- [ ] Update targeted docs for multi-city source files and `--city`.

### Task 5: Verification

**Commands:**

- `node --test apps/web/test/cities.test.mjs apps/web/test/sources.test.mjs apps/web/test/permanentExhibitions.test.mjs`
- `node --test apps/crawler/test/extractors.test.mjs`
- `npm --prefix apps/web run build`
- `git diff --check`
- Optional local smoke: `npm --prefix apps/web run dev -- --host 127.0.0.1`

- [ ] Run city/data tests.
- [ ] Run crawler tests.
- [ ] Run web build.
- [ ] Run whitespace check.
- [ ] Start local dev server and inspect routes if build succeeds.
