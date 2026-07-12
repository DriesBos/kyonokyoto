# Source Config Reference

Use this for city source files:

- `data/sources/kyoto-sources.json`
- `data/sources/osaka-sources.json`
- `data/sources/tokyo-sources.json`

City-specific overrides live in `data/sources/overrides/<city>-overrides.json`.

## `name` / `names`

`name` is required and is the canonical/default source name.

`names` is optional for locale-specific source names:

```json
{
  "name": "Kyoto Art Center",
  "names": {
    "en": "Kyoto Art Center",
    "ja": "京都芸術センター"
  }
}
```

Crawler uses `names[locale]` for event card institution/venue text when extracting that locale. Map/source labels still use `name`.

## Source-Owned Venue Fields

Source JSON is authoritative for venue identity:

- `name`
- `source_categories`
- `address_text`
- `directions_query`
- `lat`
- `lng`

Crawler extracts event-specific title, dates, description, images, and source URLs. It should not let scraped page venue/brand text replace canonical source fields.

Locale-specific event rows only localize title and description. Dates, venue/source names, addresses, links, categories, coordinates, and media remain shared on the canonical event.

## `venue_locations`

Optional. Use when one source has events at multiple venues or rooms and the map marker needs event-level coordinates.

```json
{
  "venue_locations": [
    {
      "name": "The Triangle",
      "match": ["The Triangle", "Kyoto City KYOCERA Museum of Art"],
      "address_text": "The Triangle, Kyoto City KYOCERA Museum of Art",
      "lat": 35.0123,
      "lng": 135.7834
    }
  ]
}
```

Crawler matches these strings against event venue, address, directions query, source URL, institution, and title. First matching location wins. If none match, source `lat`/`lng` are used.

## `capabilities`

Optional. Use this for language exceptions and translation behavior.

```json
{
  "capabilities": {
    "native_locales": ["ja"],
    "machine_translate_missing_locales": true
  }
}
```

- `native_locales` declares which real language versions the source has. Use `["ja"]`, `["en"]`, or `["ja", "en"]`.
- If a source has a language toggle instead of separate listing URLs, set both native locales here. The crawler can then discover alternate detail-page links from page header/menu links.
- `machine_translate_missing_locales` defaults to `true`. Set `false` only when missing translations should stay missing.

## `selectors`

Optional. Use for predictable simple pages before writing custom extractor code.

Supported keys:

- `listing_links`
- `title`
- `description`
- `date`
- `images`

```json
{
  "selectors": {
    "listing_links": "#events a.event-link",
    "title": "h1.event-title",
    "description": ".event-body",
    "date": ".event-date",
    "images": ".event-body img"
  }
}
```

Selector support is intentionally small: IDs, classes, tags, and descendant selectors such as `#events a.event-link`. Complex pseudo-selectors need source-specific extractor code.

## `qa`

Optional. Human QA metadata for source rows. Use this when you would otherwise repeat the same QA note in `QA-todo.md`.

```json
{
  "qa": {
    "listing_urls": {
      "ja": ["https://example.jp/exhibitions/"],
      "en": ["https://example.jp/en/exhibitions/"]
    },
    "language_url_pattern": "English adds /en/; Japanese has no locale prefix.",
    "field_sources": {
      "listing_links": "current/upcoming cards",
      "title": "detail h1",
      "date": ".event-date",
      "description": ".event-body",
      "images": ".event-body img"
    },
    "date_format": "YYYY.MM.DD - YYYY.MM.DD",
    "image_rules": "Keep the second image onward; first image is a venue logo."
  }
}
```

Allowed keys:

- `listing_urls` - locale-keyed URLs where event/exhibition lists live.
- `language_url_pattern` - how language switches show up in URLs.
- `field_sources` - where title/date/description/images/listing links are found.
- `date_format` - observed source date format.
- `image_rules` - which images to keep/skip.

Crawler and web do not use `qa` for extraction yet. It is local source truth for faster review.

## `skip_og_image`

Optional. Set `true` when a source's Open Graph image is a flyer, site card, logo, or otherwise not useful as event-card media.

```json
{
  "skip_og_image": true
}
```

When enabled, generic extraction ignores `<meta property="og:image">` and uses real page images or configured `selectors.images` instead. If no usable image remains, the event is skipped by the normal missing-image rule.

## `crawl_hints`

Optional. Use for fetch/crawl behavior exceptions.

```json
{
  "crawl_hints": {
    "requires_render": true,
    "render_mode": "auto",
    "max_detail_pages": 12,
    "skip_patterns": ["/archive/", "/news/"]
  }
}
```

- `requires_render: true` forces Crawl4AI rendering for that source.
- `render_mode` can be `auto`, `always`, or `never`; it overrides global crawler render mode for this source.
- `max_detail_pages` caps detail URLs for this source.
- `skip_patterns` drops matching URLs before detail fetch.

## `source_type`

Required single value. Broad identity of source venue/organization.

Current values:

- `art-center`
- `design`
- `fair`
- `festival`
- `gallery`
- `museum`
- `university`
- `venue`

Used as fallback/category metadata. Not used to choose crawl behavior.

## `crawl_strategy`

Required single value. Describes source shape.

Current values:

- `listing-and-detail-pages` - listing page links to event/detail pages.
- `homepage-and-detail-pages` - homepage is the listing or main entry point.

Currently metadata only. Crawler behavior is driven by URLs, patterns, and source-specific extractors.

## Field Usage

Set `url_year` to `"current"` for annual source URLs. Loader replaces any four-digit year in
`base_url`, `start_urls`, `event_page_patterns`, and locale URL fields with runtime year.

Keep these. They are runtime fields:

- crawler scope: `start_urls`, `url_year`, `allowed_domains`, `event_page_patterns`, `locales`, `selectors`, `crawl_hints`, `skip_og_image`, `measure_image_dimensions`, `capabilities`
- web/map truth: `name`, `names`, `source_categories`, `address_text`, `directions_query`, `lat`, `lng`, `venue_locations`, `beta`

Metadata-only today:

- `crawl_strategy` - useful docs, no crawler branching.
- `notes` - synced to Supabase source rows, not used for extraction.
- `qa` - local review hints, not synced to Supabase.

Do not remove `address_text`, `lat`, or `lng`; they are source-owned map truth. If `locales` has full start URLs, root `start_urls`/`event_page_patterns` are still fallback/default crawler scope.

## `source_categories`

Array of public filter/map categories. Use separate strings. Registry source of truth:
`data/categories.mjs`. Unregistered values fail source validation and web tests.

Current values:

- `exhibition`
- `museum`
- `gallery`
- `art`
- `photography`
- `design`
- `craft`
- `event`
- `music`
- `performance`
- `ceramics`
- `workshop`
- `festival`
- `fair`
- `architecture`
- `graphic`
- `new-media`
- `sculpture`
- `textiles`
- `ukiyoe`
- `campus`

Format:

```json
{
  "source_categories": ["music", "exhibition"]
}
```

Avoid:

```json
{
  "source_categories": ["music, exhibition"]
}
```
