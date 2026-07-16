# Source QA Todo

Update this file whenever source JSON changes or test crawls run.

## Hong Kong Sources

2026-07-16: Landing slider hardening now measures every configured landing-source image during crawls and persists dimensions for viewport-specific quality gating. Fullscreen slides require at least 1.5 source pixels per rendered CSS pixel, target up to 2x density, and use exact-size Netlify Image CDN cover transforms. Images can qualify on mobile while being rejected on desktop; undersized/unknown candidates fall back to the solid landing. Database migration and targeted recrawls of the nine landing sources are required before visual QA.

2026-07-16: Targeted media tuning for six Hong Kong sources. White Cube now decodes HTML-escaped signed image query strings before persistence; Palace Museum removes its shared map thumbnail regardless of image order; David Zwirner skips duplicate OG media; Asia Society rejects the `/exhibitions/upcoming` pseudo-event (`Plan Your Visit`); Whitestone uses HTTPS hero/artwork media instead of its HTTP OG image; Galerie du Monde drops its first poster when alternate media exists. Focused tests added and read-only replay checks run; clean recrawls and card/media QA pending.

2026-07-16: Added beta `kiang-malingue-hong-kong` from the official present/future exhibition listings. Discovery keeps only cards whose venue is `10 Sik On Street, Wanchai, Hong Kong`, excluding New York rows; detail extraction handles the publisher's two-digit dotted date ranges. VPS deploy `4f6598d` synced all 36 Hong Kong rows without pruning. Targeted crawl `ae24bb71-64a5-4efc-8567-38bb9031a66d` returned `source_ok`: one Hong Kong detail found, `Dwelling in Mirrors` saved for 2026-06-26 through 2026-08-22, zero skips/errors, and complete English/Japanese translations. Post-crawl global audit passed 401 events with 0 missing translations. Card/media QA remains pending. `tai-kwun` remains excluded because its current `robots.txt` declares `User-agent: *` and `Disallow: /`, including `/en/programme`.

2026-07-16: Full 35-source Hong Kong VPS cycle completed on `346b672`: 9 sources succeeded, 26 degraded/review/blocked, 0 failed, followed by a clean translation audit of 399 events with 0 missing translations. Exit 2 reflected degraded source outcomes, not a cycle crash. Use individual crawl notes below for remaining beta-source QA and tuning.

2026-07-16: First targeted VPS pass began after deploy `c37ee0f`. Source sync upserted all 35 rows without pruning. `hong-kong-palace-museum` followed 14 navigation pages and saved 0; `oi-art-space` followed broad site links and saved invalid `Web Content Display` / `Lightbox Prompt` rows; `para-site` found real exhibition pages but hit its detail cap and included ended shows. Tuned Palace Museum discovery to its official inline `eventData` current/upcoming records, scoped Oi! to programme cards with exact title/date/copy/media selectors, and scoped Para Site to exhibition cards with ended-show rejection. Targeted recrawls pending. Manual VPS loop stopped when scheduled Kyoto cycle acquired shared production lock.

2026-07-16: Static individual probes covered the remaining 16 new sources while the VPS lock was occupied. Added narrow, site-backed discovery for Videotage, 1a space, PMQ, Gallery EXIT, Sin Sin, 13A, JPS Hong Kong, Villepin, Grotto, and Kwai Fung Hin; forced rendered capture for HKAC and PMQ; rejected Galerie du Monde Taipei rows. `10-chancery-lane-gallery`, `hanart-tz-gallery`, `ora-ora`, and `soluna-fine-art` already returned plausible or old-only rows and remain unchanged. All 19 stay beta. Targeted VPS reruns and final card/media QA still required; 1a space may need a dedicated multi-event year-page extractor after rendered verification.

2026-07-16: First tuned individual VPS loop attempted all 19 sources on deploy `752f41e`. Clean: Gallery EXIT saved 1 real current show and archived 9 numeric-title rows; Kwai Fung Hin saved 3 Hong Kong shows and skipped 1 old; Soluna had no current event. Plausible but partial: PMQ saved 1, Videotage 1, Hong Kong Palace Museum 1, Sin Sin 7, Hanart 4, Galerie du Monde 3, Ora-Ora 3, and Villepin 3. Still tuning-needed: Para Site and JPS returned no details; Oi!, 1a space, HKAC, and 13A saved none; 10 Chancery followed old archive rows; Grotto selected section headings as titles. Follow-up narrows Palace dates, Para cards, Villepin current section, 10 Chancery current grid, Grotto headings, and ended Sin Sin rows. All remain beta pending card/media QA.

2026-07-16: Repair reruns on `60dcb92`: 10 Chancery saved its one current show cleanly and archived one stale row; Sin Sin kept only current `FORM` and rejected seven ended shows; Para Site found 12 real exhibition details and rejected all as past; Grotto now uses exhibition heading/date text but still needs title cleanup and current-only filtering. JPS remained fetch-blocked. Villepin reached only its current detail but needed its date paragraph. Palace Museum found nine official details but required `data-start`/`data-end` extraction instead of visible schedule labels. Final focused extractor/date patch added; full Hong Kong cycle pending.

2026-07-16: Synced all 35 configured Hong Kong sources after source-batch and date-parser commits reached `main`. Upserted 35 rows. Sync identified five obsolete prune candidates (`tai-kwun`, `de-sarthe-gallery`, `jockey-club-creative-arts-centre`, `perrotin-hong-kong`, and `pace-gallery-hong-kong`) but removed nothing because `--prune` was not requested. New 19-source crawl and card/media QA remain pending.

2026-07-16: Fixed shared English date parsing for same-month shorthand such as Hong Kong Art School's live `8 - 29 August 2026`; it now resolves to `2026-08-08` through `2026-08-29` instead of collapsing to one date. Focused regression added; database row still needs targeted recrawl.

2026-07-16: Added 19 beta Hong Kong sources from `docs/hong-kong-art-design.md`: Hong Kong Palace Museum, Para Site, Oi!, Videotage, 1a space, Hong Kong Arts Centre, PMQ, Gallery EXIT, Sin Sin Fine Art, 13A New Street Art Gallery, JPS Gallery, Villepin, 10 Chancery Lane Gallery, Hanart TZ Gallery, Galerie du Monde, Ora-Ora, Grotto Fine Art, Soluna Fine Art, and Kwai Fung Hin. Rows use official English programme pages, verified venue addresses/map coordinates, grouped taxonomy, and machine translation for Japanese. Robots policies allow configured public routes. Config validation, 164 crawler tests, 3 Python tests, and 87 web tests pass. No sync, live crawl, database write, or card/media approval yet.

- First-crawl risks: Wix/Squarespace rendering for `one-a-space`, `13a-new-street-art-gallery`, `villepin`, `grotto-fine-art`, and `soluna-fine-art`; mixed venue/city feeds for `jps-gallery-hong-kong`, `galerie-du-monde`, and `kwai-fung-hin`; broad programme types at `oi-art-space`, `videotage`, `hong-kong-arts-centre`, and `pmq`.
- Approval note: keep all 19 additions `beta: true` until targeted crawl and visual/card QA pass.

2026-07-14: Explicit approval promoted `hong-kong-art-school-gallery`, `david-zwirner-hong-kong`, and `white-cube-hong-kong` to public (`beta: false`) after their clean first live run. Focused config coverage locks this exact allowlist and keeps nearby Hong Kong rows beta. Production deploy passed. Targeted Art School crawl `e645a7f4-aa89-496a-b7a3-f40ab757d815` saved 2 events with 0 skips and complete English/Japanese translations; all three sources appeared in repeated live-route checks. Follow-up found its shorthand English date range was misparsed; shared parser fixed 2026-07-16, targeted recrawl pending.

2026-07-13: Added 21 beta Hong Kong sources from the Google My Maps purple art layer. All rows use official English exhibition/programme pages, grouped taxonomy, map coordinates, `Asia/Hong_Kong`, and machine translation for Japanese. Config validation, 164 crawler tests, 86 web tests, Python tests, formatting, and the Astro build pass. No Supabase sync or live crawl run yet; no source is approved for public display.

2026-07-13: First live Hong Kong cycle synced 21 sources and completed all attempts: 3 clean, 14 degraded/review, and 4 robots-blocked. Translation audit passed 326/326 events. Exit 2 correctly marked the cycle degraded while preserving successful rows. All sources remain beta.

- Removed from scheduled config: `tai-kwun` and `jockey-club-creative-arts-centre` explicitly disallow this crawler; `de-sarthe-gallery` has no reachable robots policy; `pace-gallery-hong-kong` ignores its Hong Kong filter and returned global shows; `perrotin-hong-kong` has no current Hong Kong programme. Re-add only with an official allowed city-scoped feed.
- Tuned after first crawl: `blue-lotus-gallery` skips Squarespace `format=ical` links; `hkdi-gallery` uses the canonical trailing-slash index and scoped exhibition cards; `whitestone-gallery-hong-kong` uses its official current Hong Kong feed and HK detail pattern.
- Needs extractor/config tuning: `gagosian-hong-kong` detail pages exposed related global exhibitions as primary titles/dates; `chat-the-mills`, `m-plus`, `asia-society-hong-kong`, `rossi-and-rossi`, `asia-art-archive`, and archive-only `contemporary-by-angela-li` need stored-result review. `blindspot-gallery` was blocked during fetch. Keep all beta.
- Clean first-run sources: `hong-kong-art-school-gallery`, `david-zwirner-hong-kong`, and `white-cube-hong-kong`; approved for public display on 2026-07-14.
- Marker decisions: obsolete `M+ Pavilion` became `m-plus`; closed `AfricArt Gallery Hong Kong` was omitted. H Queen's and Pedder Building are tenant containers. Graffiti Wall of Fame and ArtLane are places without recurring official event feeds. Curator Cafe, Blue Bottle, RealDeal, and Omotesando Koffee are not crawler sources.
- Approval note: keep remaining Hong Kong rows `beta: true` until targeted VPS crawls and card/media QA pass.

2026-07-12: Fixed shared identity collapse for inline exhibitions. `art-gallery-kitano`, `gallery-take-two`, `chushin-bijutsu`, and `hyogo-prefectural-museum-of-art` now persist their stable inline fragment as `external_id`, and URL identity keys include that explicit ID while still discarding arbitrary fragments. A data migration is prepared to preserve each existing legacy row under its current fragment before corrected crawls insert the other events. Focused and full crawler tests pass; no migration or database crawl run yet.

2026-07-12: Added structural description resolution. Extraction now ranks configured/source-specific copy, Crawl4AI cleaned/pruned body prose, raw-page prose, JSON-LD, then metadata; title/date/location/hours/caption/boilerplate candidates are rejected. Crawl QA records description provenance, recoveries, rejections, and misses. Read-only comparison against 24 suspect published rows recovered real Pola Museum prose and correctly removed multiple date/label-only descriptions. Added live-HTML description selectors for Yamatane Museum of Art, the National Museum of Modern Art Tokyo, and KOUICHI FINE ARTS. Crawl4AI pin updated to 0.8.9 and VPS deploy now syncs Python requirements. Focused tests added; no crawl run.

2026-07-12: Added structural title quality guardrails. Generic extraction now prefers configured selectors, JSON-LD Event names, and scoped headings before OG/document titles; generic labels, source-name titles, and date/location-only titles are skipped. Title provenance and render retries now appear in crawl QA. Tuned +Y Gallery, ARTCOURT Gallery, Tokyo Metropolitan Art Museum, and Tokyo Opera City Art Gallery title/discovery config from current official HTML. Focused tests added; no crawl run.

2026-07-12: Shared date hardening now skips every event without a machine-verifiable start/occurrence date, records raw/normalized date provenance and parser IDs in crawl diagnostics, and stores all-day exhibitions as date-only instead of invented timestamps. Frontend hides legacy unknown-date rows, removes date reparsing, formats ISO ranges for English/Japanese, and renders semantic `<time datetime>` endpoints. Static and Crawl4AI requests now respect cached robots rules. Schema blocks future invalid published writes without deleting existing rows. Focused tests added; no crawl or live schema deployment run.

2026-07-12: Generic date extraction now normalizes full-width Japanese text, Japanese/English weekdays, era years, and common range separators; parses validated Japanese, English, and numeric ranges through one shared path; and prefers JSON-LD or semantic event-date blocks over publication dates and whole-page text. Existing source-specific parsers remain as fallbacks. Focused regression coverage added; no crawl run.

2026-07-12: Complete sequential VPS crawl on `main` commit `900398c` synced and attempted all 119 sources: Kyoto 49/50, Osaka 29/29, Tokyo 40/40. Outcomes were 100 `source_ok`, 11 `source_no_current_events`, 4 `source_needs_review`, 3 `source_empty`, and 1 `source_failed`. `taka-ishii-gallery` failed because its listing returned no Kyoto detail URLs. Empty sources were `imura-art`, `yod-gallery`, and `congres-square-grand-green-osaka`. Review sources were `hill-top-gallery`, `atelier-muji-ginza`, `ota-fine-arts`, and `play-museum`. Translation audit checked 320 events and found 9 existing gaps: 7 English rows on `purple-purple`, 1 English row on `sokyo-kyoto`, and 1 Japanese row on `kuramonzen`. Crawls ran one source at a time under one VPS lock with five-minute city cooldowns; peak observed swap stayed below 500 MiB. One final Netlify rebuild returned 200 and the crawl lock was released. Enabled city timers are queued to reactivate before the next 36-hour cycle instead of immediately repeating this crawl.

## Kyoto Sources

2026-07-12: Post-audit VPS cycle on merged `main` commit `2e7ee9c` attempted all 50 Kyoto sources. Run totals: 22 success, 27 partial success, 1 failed; outcomes were 20 `source_ok`, 23 `source_needs_review`, 2 `source_blocked`, 2 `source_no_current_events`, 1 `source_empty`, 1 `source_degraded`, and 1 failed before an outcome. The crawler fetched 288 pages, saved 123 event results, skipped 66, inserted 1 event, updated 112 existing events, and archived 0. Translation writes inserted 1 and updated 212; the cycle-end audit found 13 gaps: 8 English on `purple-purple`, 4 Japanese on `kuramonzen`, and 1 English on `sokyo-kyoto`.

- Needs JSON/extractor tuning: `taka-ishii-gallery` failed discovery; `kyoto-art-center` was degraded by unhealthy fetches; `artro` was empty; `curation-fair-kyoto` and `imura-art` returned rendered shells; `galerie16` could not verify all 3 dates; `gallery-morning-kyoto` saved 0/6 after a rendered shell; `nonaka-hill` saved 0/6; `art-gallery-kitano` and `gallery-take-two` still reused one event ID across multiple inline events; `the-terminal-kyoto` saved 1/6 with missing images.
- Looks close; visual approval needed: `dnp-foundation-for-cultural-promotion-gallery-ddd`, `gallery-baiken`, `gallery-unfold`, `hakusasonso`, `hosomi-museum`, `huko`, `kcua`, `kojin`, `kyoto-art-month`, `kyoto-national-museum`, `kyotoba`, `miho-museum`, `museum-of-kyoto`, `oscaar-mouligne`, `oyamazaki-villa-museum`, `purple-purple`, `samac`, and `sokyo-kyoto` saved plausible events but emitted review diagnostics.

2026-07-12: Kusakabe Gallery now reads homepage event info before the slideshow, extracts its dates/hours, uses the original Wix feature asset instead of the `blur_2` LQIP, and takes description paragraphs after the slideshow. Focused test added; no crawl run.

2026-07-12: CURATION⇄FAIR Kyoto/Tokyo now use their city NEWS indexes instead of annual landing pages. Discovery accepts only current-year titles containing `Announcement of CURATION⇄FAIR` plus the matching city. Kyoto uses the detailed 2026 release and extracts November 6–8; Tokyo currently yields no event because no qualifying announcement exists. Focused tests added; no crawl run.

2026-07-12: Chushin Art Museum date parser now normalizes full-width Japanese dates before parsing. This gives the frontend standard `YYYY.MM.DD - YYYY.MM.DD` output and lets the next crawl archive the stale 2024 Ceramic Sight event. Focused extractor test added; no crawl run.

2026-07-12: QA tuning: SAMAC now keeps only the first event image. Hakari Contemporary now extracts exhibition prose separately from event/related-event information and skips its first two poster variants so media begins with installation/artwork imagery. Focused extractor tests added; no crawl run.

2026-07-12: Full Kyoto VPS cycle on `main` commit `b15c2f6` synced 50 sources and completed 49/50 crawls; `taka-ishii-gallery` failed because no Kyoto detail URLs were found. Translation check found 9 gaps: 7 English on `purple-purple`, 1 English on `sokyo-kyoto`, and 1 Japanese on `kuramonzen`. Art Collaboration Kyoto skipped its event for a missing image; Imura Art returned anti-bot shells. Hash-fragment inline sources (`art-gallery-kitano`, `gallery-take-two`, `chushin-bijutsu`) returned repeated event IDs and need identity/upsert QA. Netlify rebuild hook returned 200.
2026-07-12: Updated `art-collaboration-kyoto` extraction to explicitly keep its 1200×630 homepage OG image. This bypasses the generic WordPress-theme asset rejection only for ACK. Focused regression coverage added; no database crawl run.
2026-07-12: Updated Kyoto source taxonomy, added `cafe` to venue categories, and removed `craft` from display categories. Removed stale `craft` tokens from permanent highlights and Osaka/Tokyo sources without guessing replacements; aligned category fixtures and CURATION FAIR expectations. No crawl run for these taxonomy changes.
2026-07-12: Promoted `issey-miyake-kyoto-kura` from beta and added full event-extraction coverage for its ON VIEW date window and KURA images. Database crawl `232885b1-5346-4385-a634-9c4b02924ee2` saved current event `「WALL WHITE HEM」`; 1 detail URL, 1 saved, 0 skipped, 0 missing images/translations.
2026-07-12: Updated `leica-gallery-kyoto` taxonomy to gallery / photography / exhibition. Replaced stale fancy-slider image selector with event-page `<picture>` images so exhibition media wins over Leica metadata images, including every image inside sliders. Live extraction found all 5 images on Kisshomaru Shimamura. Database crawl `20ddc506-ce05-404c-a18a-909c89c924d7` saved Kisshomaru Shimamura and Teresa Freitas; 2 detail URLs, 2 saved, 0 skipped, 0 missing images/translations.
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

2026-07-13: Generic-title source leaks were tightened without a crawl or database write. NEW PURE+ now follows titled detail anchors only inside live `#current-section` and `#upcoming-section` containers, rejects exhibition category indexes, and reads `h1.post-title`. JITSUZAISEI now follows only concrete `/post/` links, rejects `/blog/categories/` and `/news-topics`, and reads Wix `h1[data-hook="post-title"]`. Nakanoshima Kosetsu reads the event title from Japanese `.single__info__txtwrap--ttl` or English `.info__content--ttl`, avoiding the later `みどころ` heading. Clean recrawl and stale-row cleanup remain pending.

2026-07-13: Abeno Harukas titles now come from `p.name[itemprop="name"]`, removing the museum-name document-title suffix; media comes only from `.exhibition .figure img`, excluding ticket-sale banners and other images inside `#ticket`. Live structure was checked across all six event pages; focused extractor coverage added, no crawl or database write run.

2026-07-13: Explicit approval promoted `suchsize`, `tezukayama-gallery`, `hitoto`, `new-pure-plus`, and `hyogo-prefectural-museum-of-art` to public (`beta: false`). Focused config coverage locks this exact allowlist and guards nearby beta sources. No crawl or database write run.

2026-07-12: Post-audit VPS cycle on merged `main` commit `2e7ee9c` attempted all 29 Osaka sources. Run totals: 5 success and 24 partial success; outcomes were 5 `source_ok`, 22 `source_needs_review`, 1 `source_blocked`, and 1 `source_empty`. The crawler fetched 126 pages, saved 44 event results, skipped 48, inserted 4 events, updated 39 existing events, and archived 7. All archival came from healthy complete discovery: `hyogo-prefectural-museum-of-art` saved 9 and archived 5; `tezukayama-gallery` saved 2 and archived 2. Translation writes inserted 8 and updated 64; the cycle-end global audit still reported the same 13 Kyoto gaps.

- Needs JSON/extractor tuning: `yod-gallery` was blocked; `congres-square-grand-green-osaka` was empty; `abeno-harukas-art-museum` hit rendered shells and missed 2 dates; `artcourt-gallery` saved 0/3; `hill-top-gallery` saved 0/1; `i-gallery-osaka` saved 0/2 with invalid titles/rendered shells; `itsuo-art-museum` saved 0/6 with missing dates; `koji-kinutani-tenku-art-museum` saved 0/1; `masaki-art-museum` saved 0/4; `osaka-nihon-mingeikan` saved 1/6 with image/title/date skips; `osaka-ukiyoe-museum` saved 0/2; `takeo-exhibitions` and `wa-gallery-osaka` each saved 0/1.
- Looks close; visual approval needed: `jitsuzaisei`, `kouichi-fine-arts`, `nakanoshima-kosetsu-museum`, `national-museum-of-art-osaka`, `plus-y-gallery`, and `yoshimi-arts` saved plausible events but emitted review diagnostics. `gallery-nomart` and `issey-miyake-semba-creation-space` returned only old events.

2026-07-12: Tezukayama Gallery now discovers detail pages only from current/future status listings. Detail extraction reads title, date, description, then full-resolution gallery hrefs in page order. Japanese and English status pages are native. Focused test added; no crawl run.

2026-07-12: Hitoto now discovers only current/upcoming posts from `/next-exhibition/`. Detail extraction follows its actual order: featured image, title/date, then lower description content. Focused config/extractor test added; no crawl run.

2026-07-12: Hyogo Prefectural Museum of Art now treats each Japanese annual-schedule card as an inline event, infers omitted years from the schedule heading, and excludes passed cards by parsed end date. Current official schedule resolves to 2 ongoing and 7 upcoming exhibitions; English is machine-translated because its schedule omits an announced date. Focused test added; no crawl run.

2026-07-12: Yoshimi Arts dates now parse from the event block after the featured image; shared English date detection strips parenthesized weekday abbreviations such as `(sat)` and `(sun)`. Focused test added; no crawl run.

2026-07-12: NAKKA now keeps only the first event image. Focused extractor test added; no crawl run.

2026-07-12: Osaka University of Arts now keeps only the first event image and is public (`beta: false`). Focused extractor/config test updated; no crawl run.

### Active source tuning

- `parco-hall-shinsaibashi`: 2026-06-26 approved clean PARCO event pages and keeps only the first extracted image per event.
- `artarea-b1`: 2026-06-26 removed from Osaka source JSON by request; no crawl run.
- `kaze-art-planning`: 2026-06-26 removed from Osaka source JSON by request; no crawl run.

These sources need more JSON tuning before approval. Keep `beta: true` until fixed and re-crawled cleanly unless an explicit approval note below says otherwise.

### `i-gallery-osaka`

- Problem: saved `Archive` as event.
- Crawl leak examples: `/archive-2026`.
- Likely fix: needs render/slider handling or tighter `selectors.listing_links`; add skip for archive pages unless detail pages are known-current.

### `itsuo-art-museum`

- Problem: saved year index pages with generic title.
- Crawl leak examples: `/exhibition/2026/`, `/exhibition/2025/`.
- Likely fix: add detail selector for real exhibition entries inside year pages, or source-specific detail URL extraction.

### `new-pure-plus`

- Approval note: promoted to public on 2026-07-13 by explicit request.
- JSON tuned: current/upcoming event-detail anchors only; current/upcoming/past category pages skipped.
- Pending: clean recrawl and removal of stale generic-title rows.

### `jitsuzaisei`

- JSON tuned: concrete `/post/` exhibition pages only; blog-category and news indexes skipped.
- Pending: clean recrawl and visual approval; source remains beta.

### `plus-y-gallery`

- Problem: saved utility/index pages.
- Crawl leak examples: `Mail News`, `schedule`, `Top/coming soon`.
- Likely fix: skip mail/news/schedule/archive pages; use listing selector for real exhibition pages.

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
- `artcourt-gallery`: real events plus one index leak; small skip-pattern fix likely enough.
- `takeo-exhibitions`: one saved event; title generic, inspect before approval.

## Tokyo Sources

2026-07-13: Tokyo Metropolitan Art Museum now extracts only `.exhibition-poster` and skips its duplicate Open Graph poster. Web cards cap existing stored rows to one image immediately. Focused crawler and web tests added; no crawl or database write run.

2026-07-13: Explicit approval promoted `sumida-hokusai-museum`, `yayoi-kusama-museum`, `what-museum`, `university-art-museum-tokyo-geidai`, `yamatane-museum-of-art`, `national-museum-of-modern-art-tokyo`, `tokyo-node`, `tokyo-metropolitan-art-museum`, `take-ninagawa`, and `perrotin-tokyo` to public (`beta: false`). Focused config coverage locks this exact allowlist and guards nearby beta sources. No crawl or database write run.

2026-07-13: Museum of Contemporary Art Tokyo now extracts media only from `.l-exhibitions-entry-main__image`; National Art Center Tokyo now extracts only `.main_v` hero and `.mt-image-none` editorial art. Both skip Open Graph defaults and probe final image dimensions. Representative regression fixtures exclude MOCA chevrons/X icons/default OG and NACT shared red-arrow SVG. MOCA still needs separate discovery tuning; no crawl run.

2026-07-13: Yutaka Kikutake Gallery publisher upload URLs return 403 when third-party display omits the publisher Referer. Web display now rewrites only exact HTTPS `www.yutakakikutakegallery.com/ykgg/wp-content/uploads/` raster URLs through a bounded, cached server proxy that sends the required root Referer; other hosts, paths, protocols, redirects, non-images, and oversized responses are rejected. Existing event rows are fixed at display time after deploy; crawler storage remains unchanged. No crawl or database write run; source remains beta pending visual approval.

2026-07-12: Post-audit VPS cycle on merged `main` commit `2e7ee9c` attempted all 40 Tokyo sources. Run totals: 4 success and 36 partial success; outcomes were 4 `source_ok`, 32 `source_needs_review`, 2 `source_empty`, 1 `source_blocked`, and 1 `source_degraded`. The crawler fetched 271 pages, saved 105 event results, skipped 71, inserted 3 events, updated 102 existing events, and archived 0. Translation writes inserted 6 and updated 204; the cycle-end global audit still reported the same 13 Kyoto gaps. A post-cycle backfill wrote all 13 missing translations with 0 skips; verification then passed all 274 published events with 0 gaps.

- Needs JSON/extractor tuning: `curation-fair-tokyo` was blocked by a JavaScript shell; `museum-of-contemporary-art-tokyo` and `tokyo-opera-city-art-gallery` returned empty discovery; `21-21-design-sight` saved 4 but had degraded fetch health; `artizon-museum` saved 0/4 and `atelier-muji-ginza` saved 0/1 because dates were missing; `nanzuka` saved 0/1 after rendered shells and a missing date; `ota-fine-arts` saved 0/6 because all titles were invalid; `perrotin-tokyo` saved 0/1 for a missing date; `play-museum` saved 0/1 for a missing image; `kenji-taki-gallery` saved 1/3 with two missing images; `setagaya-art-museum` saved 6/7 with one missing image; `sumida-hokusai-museum` saved 3/7 with three missing dates and one missing image; `tokyo-photographic-art-museum` saved 7/10 with three missing images. `pola-museum-annex` still followed news/staff URLs. `national-museum-of-modern-art-tokyo`, `taro-nasu-gallery`, and `university-art-museum-tokyo-geidai` emitted missing/rejected-description diagnostics.
- No current rows survived the review window: `issey-miyake-ginza-cube`, `issey-miyake-shinjuku-shikaku`, `japan-folk-crafts-museum`, and `maho-kubota-gallery` returned only old events.
- Healthy complete discovery: `ginza-graphic-gallery`, `scai-piramide`, and `snow-contemporary` each saved 1; `standing-pine-tokyo` saved 7 and skipped 1 old row. All four returned `source_ok` and archived 0.
- Looks close; visual approval needed: `lurf-museum` saved 4, `mori-art-museum` 6, `national-art-center-tokyo` 2, and `yutaka-kikutake-gallery` 2 with no skips. `scai-park` and `scai-the-bathhouse` each saved 1 but lacked descriptions. Other plausible rows with old-only skips came from `gyre-gallery`, `pola-museum-annex`, and `taro-okamoto-memorial-museum`.

2026-07-12: Corrected `pola-museum-annex` from the unrelated Hakone Pola Museum domain to the official Ginza current-exhibition page. Discovery now treats that page as the single detail, reads only the exhibition block, removes commented-out title text, and spans both published phases of split exhibitions. Focused test added; no database crawl run yet.

2026-07-12: Security pass upgraded `pola-museum-annex` and `taro-nasu-gallery` source URLs to verified HTTPS endpoints; no crawl run. `snow-contemporary` remains HTTP because its HTTPS certificate does not match the hostname. Kyoto `hakusasonso` also remains HTTP because its server offers obsolete TLS parameters; both need source-owner fixes or replacement endpoints before HTTPS-only crawling is possible.

### Active source tuning

- `artizon-museum`: 2026-06-26 source config now reads `img.objectFit--contain` so event cards use artwork-list images instead of the flyer/hero image. Local crawl saved 4 events, skipped 0, and reported 0 missing images.
- `ginza-graphic-gallery`: 2026-06-26 source config now uses Tokyo GGG schedule CGI pages (`t=1`, English `l=2`, Japanese `l=1`) instead of old `/gallery/ggg_e/` landing page. Reuses DNP schedule extractor and stores only the first image. Local crawl saved 2 Tokyo GGG events, skipped 0, and reported 0 missing translations.
- `mori-art-museum`: 2026-06-26 source config now uses `/en/exhibitions/index.html` and `/jp/exhibitions/index.html`, reads copy from `div.content-main`, and reads artwork from `div.content-img img, figure.content-img img` so flyer/banner images are skipped. Local crawl saved 6 events, skipped 0, and reported 0 missing images/translations.
- `snow-contemporary`: 2026-06-26 source config now treats `current.html` as the single detail page, extracts the quoted title from the top `<strong>`, reads the `session` line for date/time, and uses only `#resizeimage img`. Local crawl saved 1 current event, archived 2 stale rows, skipped 0, and reported 0 missing images/translations.
- `setagaya-art-museum`: 2026-06-26 source config now reads `#EXHB-WORKS-LIST img, ul.more img` so event cards use Works on Display images and skip flyer/Pickup thumbnails. Local crawl saved 7 events, skipped 1 missing-image row, and reported 0 missing translations.
- `standing-pine-tokyo`: 2026-06-26 source config now uses English `/en/exhibitions`, follows `.split-block__item-link`, reads left-column title/date rows, reads right-column copy, and trims artist names after `|`. No-write live extraction of `/en/exhibitions/402` returned `Dear Summer`, `2026-07-04` to `2026-07-25`, and a cover image.
- `tokyo-node`: 2026-06-26 source config now reads `.e-gallery_fv_thumbnail_mobile img.image-square`, which is the second event visual, and skips desktop hero plus related-event square thumbnails. Local crawl saved 3 events, skipped 0, and reported 0 missing images/translations.
- `yutaka-kikutake-gallery`: 2026-06-26 source config now follows only `ul.ex-current a, ul.ex-upcoming a`, reads date/copy from `.ex-spec`/`.ex-description`, and reads ordered artwork from `div.artwork img[src*="/wp-content/uploads/"]`. Local crawl saved 2 current events, archived 6 older rows, skipped 0, and reported 0 missing images/translations. 2026-07-13 web delivery added bounded Referer proxy for exact publisher upload URLs; no recrawl needed for existing rows.

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
- `ginza-graphic-gallery`: saved 2; first-image-only DNP schedule extraction.
- `setagaya-art-museum`: saved 7; skipped 1 missing-image row; Works on Display image selector tuned.
- `gyre-gallery`: saved 2; skipped 4 old rows.
- `mitsubishi-ichigokan-museum`: saved 3; skipped 2 missing-image rows.
- `taro-nasu-gallery`: saved 1; skipped 5 old rows.

### No Current Events

- `issey-miyake-ginza-cube`: saved 0; 8 old rows skipped.
- `issey-miyake-shinjuku-shikaku`: saved 0; 8 old rows skipped.

After future crawl, add each source under one of:

- Needs JSON tuning
- Looks close
- Approved
