# Source QA Routine

Use this routine when adding or approving crawler sources.

## Default State

New sources should start as beta:

```json
{
  "beta": true
}
```

Beta sources are crawled and stored, but hidden from production. In dev they can show as beta/dimmed. When a source is approved, set `"beta": false` or remove the `beta` field.

## Add Or Edit Source JSON

Safe manual edits:

- `name`
- `names`
- `address_text`
- `directions_query`
- `lat`
- `lng`
- `base_url`
- `start_urls`
- `locales`
- `event_page_patterns`
- `crawl_hints.skip_patterns`
- `crawl_hints.max_detail_pages`
- `qa.listing_urls`
- `qa.language_url_pattern`
- `qa.field_sources`
- `qa.date_format`
- `qa.image_rules`
- `beta`

Use these first for routine source cleanup: venue name, map location, language URLs, current/future listing pages, archive/news/shop filters.
Put repeated review facts in `qa`; keep this file for unresolved issues and crawl results.

Ask Codex for more complex tuning:

- `selectors.listing_links`
- `selectors.title`
- `selectors.date`
- `selectors.description`
- `selectors.images`
- image filtering
- source-specific extractors
- encoding fixes
- JavaScript/render issues
- deleting bad crawled events from the database

## Cheap Validation

Run structural checks after JSON edits:

```bash
node --test apps/web/test/cities.test.mjs
node - <<'NODE'
import { loadAllSourcesConfig, validateSourceConfig } from './data/sources/source-config.mjs';
const warnings = (await loadAllSourcesConfig()).flatMap(validateSourceConfig);
if (warnings.length) { console.error(warnings.join('\n')); process.exit(1); }
console.log('source config ok');
NODE
```

Optional touched-file format check:

```bash
npx prettier --check data/sources/osaka-sources.json
```

## Crawl QA

Sync city sources before crawling new source rows:

```bash
node scripts/sync-sources.mjs --city=osaka
```

Crawl one source:

```bash
node apps/crawler/src/run-once.mjs --city=osaka --source=osaka-ukiyoe-museum --generic-limit=6
```

Crawl all Osaka sources:

```bash
npm --prefix apps/crawler run crawl:osaka
```

Production-style cycle without deploy:

```bash
node scripts/run-crawl-cycle.mjs --city=osaka --skip-deploy
```

## What To Inspect

For each crawled source, check:

- correct event title
- real exhibition date range, not opening hours
- clean image, not logo/social/share icon
- source URL points to event/detail page
- venue/map pin is correct
- no old archive events
- no category, language, shop, news, schedule, or index pages saved as events
- Japanese/English behavior is sane

If one of these checks produces reusable facts, move it into the source row:

- listing/exhibition URLs -> `qa.listing_urls`
- language URL behavior -> `qa.language_url_pattern`
- title/date/body/image locations -> `qa.field_sources`
- observed date shape -> `qa.date_format`
- first/second/skip image rule -> `qa.image_rules`

## Approval

Keep source beta while any issue remains:

```json
{
  "beta": true
}
```

Approve by changing to:

```json
{
  "beta": false
}
```

or deleting the `beta` field.

Approved sources should only produce real current or upcoming events.
