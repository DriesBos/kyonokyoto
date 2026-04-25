# Crawl4AI

Use this note when working on the crawler stack, especially when adding or tuning a future `Crawl4AI` worker for Kyoto event sources.

This repo does not check in tool-managed skill packages. Keep this note human-readable and update it as the crawler matures.

## Why this skill exists

`Crawl4AI` is a strong fit here because the product depends on repeatedly crawling event-heavy sites with inconsistent markup, mixed navigation patterns, and occasional JavaScript rendering.

It is worth having explicit guardrails because crawler work drifts easily:

- crawl scope gets too broad
- extraction logic gets mixed with source discovery
- one noisy source can dominate tuning time
- dynamic rendering gets used before simpler HTML paths are exhausted

## Project fit

Current repo state:

- `apps/crawler/src/run-once.mjs` is the active local crawler pipeline
- `data/sources/kyoto-sources.json` is the main source registry
- `PLAN.md` calls for a future `Crawl4AI` worker hosted separately

Treat `Crawl4AI` as an execution layer, not a reason to rewrite the normalization rules that already belong to this repo.

## Default workflow

1. Start with source config, not code.
2. Prove the source has stable event URLs.
3. Crawl the smallest useful slice first.
4. Save raw page output before overfitting extraction.
5. Promote only recurring problem sources into custom extraction logic.

For this project, that usually means:

- tighten `start_urls`
- keep `allowed_domains` narrow
- make `event_page_patterns` specific before adding custom logic
- use generic extraction for initial QA
- add source-specific detail URL and event extractors only for important noisy sources

## Best practices

### 1. Minimize crawl scope aggressively

Prefer missing a few pages during tuning over crawling the wrong surface area.

Good defaults:

- start from event, exhibition, program, or news listing pages
- exclude asset URLs, tag pages, search pages, and pagination loops unless needed
- cap candidate detail pages during tuning
- normalize and dedupe URLs before fetching detail pages

### 2. Separate discovery from extraction

Treat these as separate jobs:

- discovery: find likely event detail URLs
- extraction: turn one detail page into one normalized event record

Do not bury discovery heuristics inside the final event mapper unless the source is highly bespoke.

### 3. Prefer static fetches before browser rendering

Use dynamic or browser-assisted crawling only when the site actually requires it.

Escalation order:

1. plain HTML fetch
2. stronger selectors or cleaner page targeting
3. browser rendering for JS-dependent pages
4. source-specific logic for edge cases

If browser rendering becomes the default for a source, document why in source notes or code comments.

Current lazy-image policy:

- `apps/crawler/src/run-once.mjs` still uses static HTML as the first pass.
- With `CRAWL4AI_RENDER_MODE=auto`, detail pages that extract no image are retried through `apps/crawler/src/crawl4ai-fetch.py`.
- With `CRAWL4AI_RENDER_MODE=auto`, listing or detail pages classified as `js_shell` or `empty_or_suspicious` are retried through Crawl4AI before extraction continues.
- The Crawl4AI retry uses `wait_for_images`, `scan_full_page`, and `scroll_delay` by default, then appends `result.media.images` to the rendered HTML as hidden image tags so the existing event extractors can keep doing deterministic image selection.
- Use `--render=always` or `CRAWL4AI_RENDER_MODE=always` only when discovery itself needs browser rendering, such as JavaScript-built listing pages.
- Use `CRAWL4AI_RENDER_MODE=never` for local static-only tuning or when Crawl4AI is not installed.

Current image filtering policy:

- Event media is capped at four stored image URLs per event.
- The shared image finalizer rejects known UI/social/logo images and images whose known width or height is under 100px.
- If a source still leaks icons without useful HTML dimensions, set `measure_image_dimensions: true` on that source in `data/sources/kyoto-sources.json` or `data/sources/source-overrides.json`. The crawler will download only the selected image candidates, measure their natural dimensions from the image bytes, and reject measured images under the same 100px threshold.

Current static fetch resilience policy:

- Static fetches use browser-compatible `Accept`, `Accept-Language`, and `Cache-Control` headers while keeping the project user agent explicit.
- Static fetches time out via `CRAWLER_FETCH_TIMEOUT_MS`.
- Fetch results are classified as `ok`, `timeout`, `network_error`, `rate_limited`, `transient_error`, `forbidden`, `http_error`, `not_html`, `bot_challenge`, `js_shell`, or `empty_or_suspicious`.
- Only transient classifications are retried: `timeout`, `network_error`, `rate_limited`, and `transient_error`.
- Retries use exponential backoff with jitter and honor `Retry-After` when a server provides it.
- Source-page requests are spaced per domain with a random delay between `CRAWLER_MIN_DELAY_MS` and `CRAWLER_MAX_DELAY_MS`; Supabase and Netlify API calls are not part of this delay path.
- Each source run records structured diagnostics in `crawl_runs.logs`, including static fetch count, Crawl4AI fetch count, retry count, challenge/shell counts, skip counts, and Crawl4AI budget usage.
- `CRAWL4AI_MAX_RENDERS_PER_SOURCE` caps browser renders so one broken source cannot dominate a scheduled crawl.
- Each completed run gets a source outcome such as `source_ok`, `source_degraded`, `source_blocked`, `source_empty`, `source_no_current_events`, `source_needs_review`, or `source_failed`.

Current extractor test policy:

- Keep small saved HTML fixtures under `apps/crawler/test/fixtures`.
- Use `node --test apps/crawler/test/*.test.mjs` for extractor and classifier tests.
- Add a fixture before changing important source-specific extraction logic when possible.

### 4. Keep extraction deterministic

Favor explicit parsing over broad summarization when fields matter to downstream UX.

For event pages, prioritize stable extraction of:

- title
- subtitle if truly distinct
- date text
- normalized start and end date
- venue
- image
- canonical source URL
- short description

When a field is uncertain, keep the raw text and leave the normalized field empty instead of guessing.

### 5. Preserve raw evidence

For hard sources, keep enough raw output to debug later:

- fetched URL
- canonical URL if different
- raw date text
- raw venue text
- snippet or markdown used for extraction

This is especially important before adding LLM-assisted extraction on top of Crawl4AI output.

### 6. Tune config before adding bespoke code

The expected order of operations in this repo is:

1. adjust `data/sources/kyoto-sources.json`
2. rerun one source locally
3. inspect false positives and misses
4. only then add source-specific extractor logic

Rule of thumb:

- config fix if the source is mostly right but noisy
- custom extractor if the source is important and structurally unique
- shared schema change only if multiple sources need the same new field

### 7. Optimize for repeat runs

Crawl jobs here should be cheap to rerun.

Prefer:

- small source-by-source test runs
- deterministic timeouts and limits
- stable output shapes
- clear logging for fetch failures, empty extracts, and parse misses

Avoid:

- huge exploratory crawls during daily tuning
- hiding errors behind empty arrays
- mixing database writes into early extraction experiments

### 8. Respect publisher boundaries

Use source pages that are clearly intended for public browsing. Avoid patterns that look like search abuse or unnecessary deep traversal.

Be especially conservative with:

- calendars with infinite pagination
- faceted search URLs
- language or preview variants
- duplicate mobile and desktop paths

## Crawl4AI-specific guidance

When implementing with `Crawl4AI`, prefer features that improve reliability and traceability:

- deterministic URL filtering before deep crawling
- markdown or cleaned content output for extraction review
- page metadata capture alongside content
- caching or session reuse when available for local tuning
- browser rendering only for proven JS-heavy sources

Do not let `Crawl4AI` become a black box. We should still be able to explain why a page was crawled and how a field was produced.

## What good looks like

A good source integration for this repo usually has these properties:

- one source can be tuned in isolation
- listing-page discovery is explainable
- detail-page extraction is testable from saved page output
- normalized fields map cleanly into the shared event schema
- rerunning the crawl produces near-identical results when the source has not changed

## When to update this note

Update this note when any of these become true:

- we add a real `Crawl4AI` worker under `apps/crawler`
- we standardize a browser-rendering policy
- we add raw-page storage or crawl logs
- we define source notes, fixtures, or test cases for extractors
