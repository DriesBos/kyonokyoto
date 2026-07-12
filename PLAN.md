# Plan

## Product

Publish reliable current cultural events for Kyoto, Osaka, and Tokyo from venue-owned sources.

## Current Architecture

- Source JSON owns venue identity, taxonomy, location, and crawl scope.
- VPS systemd timers run city crawls through `scripts/run-crawl-cycle.mjs`.
- Supabase stores sources, crawl evidence, normalized events, and translations.
- Astro SSR queries published events by city and locale.
- Netlify CDN caches SSR responses and revalidates them; crawls need no rebuild hook.
- GitHub Actions verifies repository before restricted VPS fast-forward deploy.

## Current Work

1. Stabilize source extraction and translation provenance.
2. Apply and verify first tracked Supabase migration.
3. Tune sources listed in `QA-todo.md`.
4. Run full city crawls and approve beta sources after visual QA.
5. Monitor raw-page growth; call bounded retention RPC when needed.

## Release Gates

- source config validates
- crawler tests pass
- web tests and build pass
- published events have machine-readable dates
- no unexpected source prune candidates
- city crawl failures return non-zero status
- map, image, locale, and calendar spot checks pass

## Later

- split crawler internals only where repeated source work benefits
- automate raw-page retention after observing safe production batches
- add new cities only after current three stay healthy
