# Source QA Todo

Update this file whenever source JSON changes or test crawls run.

## Osaka Sources

These sources need more JSON tuning before approval. Keep `beta: true` until fixed and re-crawled cleanly.

### `hyogo-prefectural-museum-of-art`

- Problem: archive and old pages saved as events.
- Crawl leak examples: `i_backnum.html`, `j_2504`, old year collection pages.
- Likely fix: tighten `event_page_patterns`, add `crawl_hints.skip_patterns` for archive/backnumber and old year pages, or add listing selector for current/special exhibition cards only.

### `i-gallery-osaka`

- Problem: saved `Archive` as event.
- Crawl leak examples: `/archive-2026`.
- Likely fix: needs render/slider handling or tighter `selectors.listing_links`; add skip for archive pages unless detail pages are known-current.

### `itsuo-art-museum`

- Problem: saved year index pages with generic title.
- Crawl leak examples: `/exhibition/2026/`, `/exhibition/2025/`.
- Likely fix: add detail selector for real exhibition entries inside year pages, or source-specific detail URL extraction.

### `new-pure-plus`

- Problem: saved category/index pages.
- Crawl leak examples: `/exhibition/past`, generic `past exhibition`.
- Likely fix: add skip for `/past`; tune selectors for current/upcoming detail content.

### `artarea-b1`

- Problem: saved calendar/list/archive pages.
- Crawl leak examples: `イベント アーカイブ`, list/month routes, `?eventDisplay=past`.
- Likely fix: skip list/month/archive paths and past query params; target concrete `/program/<id>/` pages only.

### `hitoto`

- Problem: saved category pages.
- Crawl leak examples: `カテゴリー: Art`, `カテゴリー: これからの展覧`, `カテゴリー: これまでの展覧`.
- Likely fix: skip category pages; target individual post/event URLs only.

### `jitsuzaisei`

- Problem: saved blog/news index pages.
- Crawl leak examples: `Blog`, `NEWS&TOPICS`, `/blog/categories/past-exhibitions`.
- Likely fix: skip `/blog/categories/` and `/news-topics`; keep concrete `/post/...` exhibition pages.

### `plus-y-gallery`

- Problem: saved utility/index pages.
- Crawl leak examples: `Mail News`, `schedule`, `Top/coming soon`.
- Likely fix: skip mail/news/schedule/archive pages; use listing selector for real exhibition pages.

### `tezukayama-gallery`

- Problem: saved status index pages.
- Crawl leak examples: `/exhibitions/status/current`, `/exhibitions/status/past`.
- Likely fix: skip `/exhibitions/status/`; keep `/exhibition/<slug>` pages.

### `masaki-art-museum`

- Problem: mojibake title from older page; current page also mixed with old news.
- Crawl leak examples: garbled title from `event/news/202110.html`.
- Likely fix: encoding handling or skip old news pages; target current exhibition page only.

### `osaka-nihon-mingeikan`

- Problem: mixed exhibition/news/event pages.
- Crawl leak examples: `みんげい市`, news posts, event index.
- Likely fix: focus on `/exhibition/special/`; skip news posts unless intentionally included.

### `osaka-ukiyoe-museum`

- Problem: saved language/shop pages as events.
- Crawl leak examples: `/en/language.html`, `/museumshop/museumshop.html`.
- Likely fix: change start URL/patterns to actual exhibition page; skip language/shop routes.

## Osaka Sources That Look Close

Review manually, then remove `beta` when approved:

- `osaka-geidai-whatsnew`: tag filter worked; 6 tagged items saved.
- `kaze-art-planning`: multiple event pages saved.
- `kouichi-fine-arts`: one clean exhibition saved.
- `parco-hall-shinsaibashi`: clean PARCO event pages saved.
- `suchsize`: mostly useful; inspect `Texts` leak before approval.
- `artcourt-gallery`: real events plus one index leak; small skip-pattern fix likely enough.
- `takeo-exhibitions`: one saved event; title generic, inspect before approval.

## Tokyo Sources

New Tokyo sources are `beta: true` and pending first Tokyo crawl QA.

After crawl, add each source under one of:

- Needs JSON tuning
- Looks close
- Approved
