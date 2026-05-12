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
