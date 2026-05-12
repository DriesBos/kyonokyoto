# Source Config Reference

Use this for `data/sources/kyoto-sources.json` and `data/sources/source-overrides.json`.

## `name` / `names`

`name` is required and is the canonical/default source name.

`names` is optional for locale-specific source names:

```json
"name": "Kyoto Art Center",
"names": {
  "en": "Kyoto Art Center",
  "ja": "京都芸術センター"
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
"venue_locations": [
  {
    "name": "The Triangle",
    "match": ["The Triangle", "Kyoto City KYOCERA Museum of Art"],
    "address_text": "The Triangle, Kyoto City KYOCERA Museum of Art",
    "lat": 35.0123,
    "lng": 135.7834
  }
]
```

Crawler matches these strings against event venue, address, directions query, source URL, institution, and title. First matching location wins. If none match, source `lat`/`lng` are used.

## `capabilities`

Optional. Use this for language exceptions and translation behavior.

```json
"capabilities": {
  "native_locales": ["ja"],
  "machine_translate_missing_locales": true
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
"selectors": {
  "listing_links": "#events a.event-link",
  "title": "h1.event-title",
  "description": ".event-body",
  "date": ".event-date",
  "images": ".event-body img"
}
```

Selector support is intentionally small: IDs, classes, tags, and descendant selectors such as `#events a.event-link`. Complex pseudo-selectors need source-specific extractor code.

## `skip_og_image`

Optional. Set `true` when a source's Open Graph image is a flyer, site card, logo, or otherwise not useful as event-card media.

```json
"skip_og_image": true
```

When enabled, generic extraction ignores `<meta property="og:image">` and uses real page images or configured `selectors.images` instead. If no usable image remains, the event is skipped by the normal missing-image rule.

## `crawl_hints`

Optional. Use for fetch/crawl behavior exceptions.

```json
"crawl_hints": {
  "requires_render": true,
  "render_mode": "auto",
  "max_detail_pages": 12,
  "skip_patterns": ["/archive/", "/news/"]
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
- `art-fair`
- `festival`
- `gallery`
- `museum`
- `venue`

Used as fallback/category metadata. Not used to choose crawl behavior.

## `crawl_strategy`

Required single value. Describes source shape.

Current values:

- `listing-and-detail-pages` - listing page links to event/detail pages.
- `homepage-and-detail-pages` - homepage is the listing or main entry point.

Currently metadata only. Crawler behavior is driven by URLs, patterns, and source-specific extractors.

## `source_categories`

Array of public filter/map categories. Use separate strings.

Current values:

- `architecture`
- `art-fair`
- `ceramics`
- `craft`
- `design`
- `exhibition`
- `festival`
- `gallery`
- `illustration`
- `new-media`
- `museum`
- `music`
- `photography`
- `product`
- `sculpture`
- `textiles`

Format:

```json
"source_categories": ["music", "exhibition"]
```

Avoid:

```json
"source_categories": ["music, exhibition"]
```
