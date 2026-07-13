# Crawler Dashboard

Snapshot: **2026-07-13 09:33 JST**

Method: latest stored `crawl_runs` row for each configured source. Counts below combine those 119 latest runs; they do not represent one synchronized city cycle.

## Current Situation

### Latest Stored Run per Source

| Metric                    | Count |
| ------------------------- | ----: |
| Configured sources        |   119 |
| Sources with a stored run |   119 |
| Successful runs           |    31 |
| Partial-success runs      |    87 |
| Failed runs               |     1 |

### Source Outcomes

| Outcome                    | Count |
| -------------------------- | ----: |
| `source_ok`                |    29 |
| `source_no_current_events` |     2 |
| `source_needs_review`      |    77 |
| `source_blocked`           |     4 |
| `source_empty`             |     4 |
| `source_degraded`          |     2 |
| `source_failed`            |     1 |

### Pages

| Metric                   | Count |
| ------------------------ | ----: |
| Pages queued             |   585 |
| Pages fetched            |   682 |
| Pages parsed into events |   269 |
| Static fetches recorded  |   724 |
| Crawl4AI renders         |     4 |
| Retries                  |     5 |
| JavaScript shells        |    12 |

### Event Quality

| Diagnostic             | Count |
| ---------------------- | ----: |
| Missing dates          |    41 |
| Missing images         |    16 |
| Invalid titles         |    10 |
| Missing descriptions   |    40 |
| Rejected descriptions  |    20 |
| Recovered descriptions |     4 |
| Old events skipped     |   107 |
| Past events skipped    |     7 |
| Other events skipped   |     4 |

### Date Extraction

454 date extraction diagnostics were retained. Six inferred a missing year.

| Origin                    | Count |
| ------------------------- | ----: |
| Source-specific extractor |   149 |
| Semantic element          |   105 |
| Full-page fallback        |    96 |
| Article content           |    43 |
| Configured selector       |    35 |
| Metadata                  |    16 |
| `<time>` element          |    10 |

| Parser                    | Count |
| ------------------------- | ----: |
| `parseBilingualDateRange` |   406 |
| No parser recorded        |    43 |
| Source-specific parser    |     5 |

## Interpretation

- Generic extraction still carries too much responsibility.
- Full-page date fallback is common enough to create false-positive risk.
- Date and description failures are the largest field-quality gaps.
- Image-dimension checks are too narrowly enabled to guarantee media quality.
- `source_needs_review` currently mixes expected beta QA debt with operational failure.

This file is a point-in-time baseline for crawler refactor comparisons. Replace snapshot values only after a comparable latest-run-per-source query.
