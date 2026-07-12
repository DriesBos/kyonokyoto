# Source QA Todo

Update this file whenever source JSON changes or test crawls run.

## Kyoto Sources

2026-07-12: Added `art-gallery-kitano`, `galerie16`, and `gallery-take-two`; updated `sokyo-kyoto` and `issey-miyake-kyoto-kura`; added Kahitsukan to Also Visit. Live no-write probes found 4 Kitano inline exhibitions, 5 Take Two exhibitions after dropping `coming soon` placeholders, 1 Issey `ON VIEW` detail, 1 current Sokyo detail with Past excluded, and 1 current galerie16 detail. Source configs and focused extractor/web tests pass; no database crawl run.
2026-07-12: Migrated all 119 crawler sources and 9 permanent highlights from flat source types/categories to grouped `taxonomy`: `venue_category`, `display_category`, and `event_category`. Filter tokens are namespaced; multiple selections use OR within a dimension and AND across dimensions. Broad legacy `art` values were dropped instead of guessing `painting`; no crawl run.
2026-07-12: Updated public category registry: removed `mingei` and `product`, renamed `illustration` to `graphic`, and renamed `university` to `campus`. Existing Osaka/Tokyo source rows now use only registered values; no crawl run.
2026-07-12: Added beta `curation-fair-kyoto` and `curation-fair-tokyo` sources. English pages use `/en/<city>2026`; Japanese pages remove `/en/`. `url_year: "current"` advances both locale URLs to the runtime year. Public category and fair source type use `fair`. Pages require rendering and may validly remain announcement-only until fair details are published; no crawl run yet.
2026-07-12: Added `leica-gallery-kyoto` from Leica's Japan-filtered events page. Discovery follows only `/event/leica-gallery-kyoto/` links, uses native EN/JA detail pages, and normalizes Leica's English and Japanese date-range separators. Live crawl saved current Teresa Freitas and upcoming Kisshomaru Shimamura exhibitions; 2 detail URLs, 2 saved, 0 skipped, 0 missing images/translations.
2026-07-12: Renamed source to `kcua` / `KCUA`. Database source row migrated in place to preserve event IDs. Tuned discovery to follow every linked Current or Upcoming exhibition card that contains an image; image-less upcoming placeholders are ignored. Local extractor test added. Post-rename live crawl saved one current and one upcoming event with EN/JA translations; 2 detail URLs, 2 saved, 0 skipped, 0 missing images.
2026-07-07: Added `museum-of-kyoto` from Bunpaku special exhibition listings. English listing is `https://www.bunpaku.or.jp/en/exhi_special/`; Japanese listing is `https://www.bunpaku.or.jp/exhi_special/`. Config follows only special exhibition cards and reads title/date/copy/first poster image from `#single_main`. Source test added; no full crawl run yet.
2026-07-07: Added `hosomi-museum` from Hosomi current exhibition pages. English current exhibition page is `https://www.emuseum.or.jp/eng/exhibition_eng/index.html`; Japanese current exhibition page is `https://www.emuseum.or.jp/exhibition/index.html`. The current page is also the detail page. Source test added; no full crawl run yet.
2026-06-27: Added reusable `qa` metadata to selected QA-heavy Kyoto/Osaka/Tokyo source rows for listing URLs, language URL behavior, field locations, date formats, and image rules. Metadata-only change; no crawl run.
2026-06-27: Removed `is_active` and `map_visibility` from city source JSON. Sources that were `is_active: false` are now `beta: true`; no crawl run.

### `hosomi-museum`

- Added from Hosomi Museum current exhibition pages.
- Live English page on 2026-07-07 showed current `Water Sceneries： An Invitation to Cool Serenity`, 2026-06-13 to 2026-08-02.
- Local source test covers detail-url fallback to the current page, configured title/date fields, English date parsing, and main banner image selection.
- Full crawl not run yet.

### `museum-of-kyoto`

- Added from Bunpaku special exhibition pages.
- Live English listing on 2026-07-07 showed current `Marimekko: Art of Printmaking-Beauty,Dream,Love`, 2026-07-04 to 2026-09-06.
- Local source test covers listing selector, configured detail fields, dotted date parsing, and first poster image selection.
- Full crawl not run yet.

### `hakari-contemporary`

- Added from issue #11.
- Source page has empty current/upcoming sections as of 2026-06-06; latest visible exhibition ended 2026-05-17.
- Local static crawl fallback found 6 detail URLs: `ateleology`, `poc`, `re-materiality`, `waterforest`, `sec`, `floating-island`.
- Parsed all 6 with dates/images and all 6 are past as of 2026-06-06, so expected real crawl result is `events_saved: 0`, `skips.past: 6`.
- Full `npm run crawl:once -- --city=kyoto --source=hakari-contemporary --render=never --limit=1` could not run in this workspace because `apps/crawler/.env` is missing.

## Osaka Sources

### Active source tuning

- `parco-hall-shinsaibashi`: 2026-06-26 approved clean PARCO event pages and keeps only the first extracted image per event.
- `artarea-b1`: 2026-06-26 removed from Osaka source JSON by request; no crawl run.
- `kaze-art-planning`: 2026-06-26 removed from Osaka source JSON by request; no crawl run.

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
- `kouichi-fine-arts`: one clean exhibition saved.
- `suchsize`: mostly useful; inspect `Texts` leak before approval.
- `artcourt-gallery`: real events plus one index leak; small skip-pattern fix likely enough.
- `takeo-exhibitions`: one saved event; title generic, inspect before approval.

## Tokyo Sources

2026-07-12: Security pass upgraded `pola-museum-annex` and `taro-nasu-gallery` source URLs to verified HTTPS endpoints; no crawl run. `snow-contemporary` remains HTTP because its HTTPS certificate does not match the hostname. Kyoto `hakusasonso` also remains HTTP because its server offers obsolete TLS parameters; both need source-owner fixes or replacement endpoints before HTTPS-only crawling is possible.

### Active source tuning

- `artizon-museum`: 2026-06-26 source config now reads `img.objectFit--contain` so event cards use artwork-list images instead of the flyer/hero image. Local crawl saved 4 events, skipped 0, and reported 0 missing images.
- `ginza-graphic-gallery`: 2026-06-26 source config now uses Tokyo GGG schedule CGI pages (`t=1`, English `l=2`, Japanese `l=1`) instead of old `/gallery/ggg_e/` landing page. Reuses DNP schedule extractor and stores only the first image. Local crawl saved 2 Tokyo GGG events, skipped 0, and reported 0 missing translations.
- `mori-art-museum`: 2026-06-26 source config now uses `/en/exhibitions/index.html` and `/jp/exhibitions/index.html`, reads copy from `div.content-main`, and reads artwork from `div.content-img img, figure.content-img img` so flyer/banner images are skipped. Local crawl saved 6 events, skipped 0, and reported 0 missing images/translations.
- `snow-contemporary`: 2026-06-26 source config now treats `current.html` as the single detail page, extracts the quoted title from the top `<strong>`, reads the `session` line for date/time, and uses only `#resizeimage img`. Local crawl saved 1 current event, archived 2 stale rows, skipped 0, and reported 0 missing images/translations.
- `setagaya-art-museum`: 2026-06-26 source config now reads `#EXHB-WORKS-LIST img, ul.more img` so event cards use Works on Display images and skip flyer/Pickup thumbnails. Local crawl saved 7 events, skipped 1 missing-image row, and reported 0 missing translations.
- `standing-pine-tokyo`: 2026-06-26 source config now uses English `/en/exhibitions`, follows `.split-block__item-link`, reads left-column title/date rows, reads right-column copy, and trims artist names after `|`. No-write live extraction of `/en/exhibitions/402` returned `Dear Summer`, `2026-07-04` to `2026-07-25`, and a cover image.
- `tokyo-node`: 2026-06-26 source config now reads `.e-gallery_fv_thumbnail_mobile img.image-square`, which is the second event visual, and skips desktop hero plus related-event square thumbnails. Local crawl saved 3 events, skipped 0, and reported 0 missing images/translations.
- `yutaka-kikutake-gallery`: 2026-06-26 source config now follows only `ul.ex-current a, ul.ex-upcoming a`, reads date/copy from `.ex-spec`/`.ex-description`, and reads ordered artwork from `div.artwork img[src*="/wp-content/uploads/"]`. Local crawl saved 2 current events, archived 6 older rows, skipped 0, and reported 0 missing images/translations.

New Tokyo sources are `beta: true` and pending first Tokyo crawl QA.

2026-06-26 local beta crawl QA after `node scripts/sync-sources.mjs --city=tokyo`.

### 21_21 DESIGN SIGHT

- 2026-06-26: app had no events because source JSON skipped `/en/program/`, omitted Gallery 3, and generic detail extraction followed archive/tour links.
- Added Gallery 1 & 2 program listings plus Gallery 3 listings:
  - English: `/en/program/`, `/en/gallery3/`.
  - Japanese: `/program/`, `/gallery3/` (no `/en/` prefix).
- Live linked events found:
  - Gallery 1 & 2 current: `Soup as Life`, March 27-August 9, 2026.
  - Gallery 1 & 2 upcoming: `Learning from 'Hojoki': Tiny Architecture Reweaves Life`, August 28, 2026-January 11, 2027.
  - Gallery 3 current: `Gaudi: Windows on the Future`, May 16-July 12, 2026.
- Image selector reads only `img[src*="topweb"]`; this skips the first widescreen museum/header image and stores the second exhibition photo only.
- Upcoming `Theme: "Time"` is listed without a detail link; leave uncrawled until the site publishes a link.
- Synced Tokyo source table and reran `21-21-design-sight` crawl: success, 3 detail URLs, 3 saved events, 0 skips, 0 missing translations.

### SCAI split locations

- 2026-06-26: split `scai-the-bathhouse`, `scai-piramide`, and `scai-park`.
- Live homepage dropdown current/upcoming links found:
  - `scai-the-bathhouse`: current `Natsuyuki Nakanishi "A Study of the Glaringly Bright"`; upcoming `Lee Ufan: Work on Paper / Sculpture`.
  - `scai-piramide`: current `Daniel Buren "Situated Works 1966-2013"`; no upcoming link, only disabled Upcoming label.
  - `scai-park`: current `#46 Daniel Buren, Yuji Takeoka, Reijiro Wada`; no upcoming link, only disabled Upcoming label.
- Added source-specific dropdown extractor to avoid past archives and cross-location leakage.
- `scai-park` current detail page publishes `Thu. 9 April -` without an end date; extractor uses a one-year review horizon so it stays visible until a future crawl sees the dropdown change.
- Image handling now keeps only the first extracted image for all three SCAI sources; later images are often duplicate sizes, artist thumbnails, or posters. Live extractor probe confirms one image each. Reran crawls after source sync: Bathhouse 2 saved, Piramide 1 saved, Park 1 saved; all 0 missing images/translations.

### Needs JSON tuning

- `play-museum`: crawl saved 0; one detail URL skipped for missing image.
- `pola-museum-annex`: crawl saved 2, but one visible row is a staff/job news item; tighten detail URL extraction or skip latest-news routes.
- `kenji-taki-gallery`: crawl saved 1, but title/content includes Nagoya gallery copy; confirm Tokyo source scope before approval.

### Looks close

- `tokyo-photographic-art-museum`: saved 7; skipped 3 missing-image rows. Review movie/news rows before approval.
- `take-ninagawa`: saved 6; review single-day dates before approval.
- `ginza-graphic-gallery`: saved 2; first-image-only DNP schedule extraction.
- `setagaya-art-museum`: saved 7; skipped 1 missing-image row; Works on Display image selector tuned.
- `gyre-gallery`: saved 2; skipped 4 old rows.
- `tokyo-node`: saved 3; second-image-only selector tuned.
- `mitsubishi-ichigokan-museum`: saved 3; skipped 2 missing-image rows.
- `taro-nasu-gallery`: saved 1; skipped 5 old rows.

### No Current Events

- `issey-miyake-ginza-cube`: saved 0; 8 old rows skipped.
- `issey-miyake-shinjuku-shikaku`: saved 0; 8 old rows skipped.

After future crawl, add each source under one of:

- Needs JSON tuning
- Looks close
- Approved
