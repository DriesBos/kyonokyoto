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
