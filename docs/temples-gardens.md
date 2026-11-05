# Temples & Gardens beta

Kyoto collection includes dated temple/shrine openings, garden access and exhibitions at historic sites throughout Kyoto Prefecture. Permanent visiting hours and general foliage forecasts are excluded.

## Sources

All four use `source_kind: "aggregator"`, `beta: true`, Japanese extraction and missing-locale translation.

| Slug                        | Listing                                                                                      | Priority (lower wins) |
| --------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| `kyoto-kobunka`             | https://www.kobunka.com/map/                                                                 | 10                    |
| `kyoto-shunju`              | https://kyotoshunju.com/?post_type=temple                                                    | 20                    |
| `kyoto-tourism-openings`    | https://ja.kyoto.travel/event/search.php?category_id=5&display_type=list&page=1&search_flg=1 | 50                    |
| `kyoto-prefecture-openings` | https://www.kyoto-kankou.or.jp/event                                                         | 60                    |

Publisher configuration supplies crawl scope and priority. Events supply actual venue, address, directions, coordinates and taxonomy. Missing coordinates omit map pin. No fallback to publisher office. `collection:temples-gardens` enables localized collection filter.

## Identity and evidence

`event_sources` stores one current observation per publisher listing/edition. Canonical events retain stable IDs across known-listing corrections. Exact cross-source matches require verified venue/address, distinctive title, season/year, matching date bounds and programme distinctions. Generic opening titles require an event-specific official URL. Different publishers and beta/public cohorts never overwrite one another accidentally. Ambiguous matches stay separate and enter private `event_duplicate_candidates` queue. No fuzzy automatic merge.

Database RPC writes canonical facts, provenance and schedule in one transaction, serialized per collection/city. Translations are prepared without mutating records, then published atomically only if primary source and canonical revision still match. A slower crawl cannot overwrite a newer publisher's translations. Lower-priority observations add evidence without overwriting trusted content. Hidden/archived editorial status survives recrawls. Missing listings deactivate only their source evidence after a complete successful scan; events expire from display by verified schedule, not publisher disappearance. Partial/failed/truncated scans do not deactivate evidence.

`node scripts/temples-qa.mjs` prints a read-only source/beta audit and up to 200 pending duplicate pairs, including addresses, dates and provenance URLs. Uses crawler `.env`; never prints credentials. Mark a reviewed pair `separate` through database admin tooling to retain that decision; known source observations continue updating their own canonical events. Confirmed merges currently require a deliberate admin data correction; report does not merge or delete records.

## Validation and rollout

1. Apply tracked `temple_event_sources` migration before syncing sources or deploying changed crawler. `supabase/schema.sql` includes same definitions for fresh databases.
2. Sync Kyoto sources without pruning.
3. Run explicit beta crawls for four slugs, inspect skip reasons and duplicate report.
4. Use a deploy preview or local web development view for beta cards. Production excludes all beta sources before deduplication and generates filter options only from visible cards.
5. Approve content, maps, calendar and images before separately promoting any source.

Netlify deploy previews set `BETA_EVENTS_QA=1`. Next.js inlines beta visibility only for
`CONTEXT=deploy-preview`; production ignores that flag and keeps beta hidden. Developer admin
pages remain disabled in preview production builds. Source sync can target only this batch:
`node scripts/sync-sources.mjs --city=kyoto --source=kyoto-kobunka,kyoto-shunju,kyoto-tourism-openings,kyoto-prefecture-openings`.
Scoped sync rejects pruning and unknown slugs.

Kobunka currently lacks per-entry addresses/images; sampled Prefecture entries can lack years/images. Those fail existing required-field gates. They need verified enrichment/source tuning before full coverage. No borrowed publisher logos or invented current-year dates. Weekday/holiday restrictions that cannot be resolved stay in review. Shortened opening hours remain in date text; calendar records remain all-day.

Tests use public HTML excerpts and an isolated PostgreSQL database. `supabase/tests/temple_event_sources.sql` runs transactionally and rolls back fixtures; run only against a disposable database. No production crawl is implied by passing fixtures.

## First live beta crawl: 2026-11-05

Migration applied and exactly four sources synced without pruning. Sequential VPS crawls completed under the existing crawl lock; all returned `source_needs_review`, with no fatal errors or archived events.

| Source           | Candidates | Saved | Run ID                                 |
| ---------------- | ---------: | ----: | -------------------------------------- |
| Kobunka          |         32 |     0 | `903bfb85-5d4a-4ef3-87b6-bf3f630ddd11` |
| Shunju           |          6 |     4 | `a53a3b33-777e-43c0-b869-faf7af062890` |
| Kyoto Tourism    |        101 |     2 | `d84205f7-2778-4010-b7a0-011a393eb056` |
| Kyoto Prefecture |         80 |     1 | `02cf8ba8-dc94-42da-89b0-a86543898429` |

Seven saved events have verified event-level venue/address, valid date ranges and both EN/JA translations. Three have publisher-provided map coordinates; Shunju's four use temple address searches without guessed map pins. Duplicate audit found seven observations, no pending pairs and all four sources still beta. Cross-source merge behavior is covered by isolated database regressions; this first live batch did not produce a merge.

- Needs tuning: Kobunka skipped all 32 for missing images; entries also lack verified postal addresses. Shunju skipped one missing title and one unverifiable date. Tourism skipped 71 missing verified locations, 18 unverifiable dates, nine missing images and one outside collection scope. Prefecture skipped 76 unverifiable dates and three missing images. Review-only rows remain absent from cards.
- Looks close: Shunju's four Daitoku-ji openings, Tourism's Hōkyō-ji and Reikan-ji, and Prefecture's Jōruri-ji opening in Kizugawa. Review split closure dates, labels, descriptions, images and calendar links before approval.
- Media delivery: Shunju's actual nested WordPress upload path is allowed by Netlify CDN. Tourism event photos use direct HTTPS publisher delivery because CDN requests return 403 while publisher requests return 200.
- QA preview: https://deploy-preview-62--kyonokyoto.netlify.app/kyoto/en/ (Japanese: `/kyoto/ja/`). All beta; explicit promotion still required after QA.

Validation after rollout fixes: 306 crawler JavaScript tests, six Python tests, 84 web tests, source validation, formatting and production build pass in CI. Database security advisors report only informational RLS-with-no-policy findings for intentionally private crawler tables.
