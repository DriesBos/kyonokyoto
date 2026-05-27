# Adding Sources

Use `data/sources/kyoto-sources.json` as source of truth. Crawler should not guess stable venue facts when you can write them once.

## Required Source Truth

Add these first:

```json
{
  "slug": "example-gallery",
  "name": "Example Gallery",
  "source_type": "gallery",
  "source_categories": ["gallery", "exhibition"],
  "language": "ja",
  "base_url": "https://example.jp",
  "start_urls": ["https://example.jp/exhibitions/"],
  "allowed_domains": ["example.jp"],
  "event_page_patterns": ["/exhibitions/"],
  "address_text": "Example address, Kyoto",
  "directions_query": "Example Gallery, Kyoto",
  "lat": 35.0,
  "lng": 135.0,
  "is_active": true
}
```

Crawler-owned event fields:

- `title`
- `description`
- dates
- images
- event source URL

Source-owned fields:

- source/venue name
- categories
- address
- directions query
- coordinates
- map visibility

## Languages

If source has separate language URLs:

```json
"locales": {
  "ja": {
    "start_urls": ["https://example.jp/ja/exhibitions/"],
    "event_page_patterns": ["/ja/exhibitions/"]
  },
  "en": {
    "start_urls": ["https://example.jp/en/exhibitions/"],
    "event_page_patterns": ["/en/exhibitions/"]
  }
}
```

If source has one URL and a language toggle/menu:

```json
"capabilities": {
  "native_locales": ["ja", "en"],
  "machine_translate_missing_locales": true
}
```

If source has Japanese only:

```json
"capabilities": {
  "native_locales": ["ja"],
  "machine_translate_missing_locales": true
}
```

Only event `title` and `description` are localized. Dates, venue, address, images, and links stay shared.

## Simple CSS Selectors

Use selectors when page structure is simple and stable:

```json
"selectors": {
  "listing_links": "#events a.event-link",
  "title": "h1.event-title",
  "description": ".event-body",
  "date": ".event-date",
  "images": ".event-body img"
}
```

Supported selector style: `#id`, `.class`, `tag`, `tag.class`, and descendants like `#events a.event-link`.

If date parsing or page layout is weird, add source-specific extractor code and tests instead.

## Crawl Hints

Use hints for predictable crawl behavior:

```json
"crawl_hints": {
  "render_mode": "auto",
  "max_detail_pages": 12,
  "skip_patterns": ["/archive/", "/news/"]
}
```

Use `render_mode: "always"` only for JS-heavy sources. Static fetch is cheaper and more stable.

## Multiple Venues

Use `venue_locations` when one source hosts events at multiple map locations:

```json
"venue_locations": [
  {
    "name": "The Triangle",
    "match": ["The Triangle", "triangle"],
    "address_text": "The Triangle, Kyoto City KYOCERA Museum of Art",
    "lat": 35.0123,
    "lng": 135.7834
  }
]
```

First matching location wins. If nothing matches, source `lat`/`lng` are used.

## Test Flow

1. Add source config.
2. Run `cd apps/crawler && npm test`.
3. Run one source crawl locally or on VPS.
4. Check crawl result:
   - detail URLs found
   - title/description present
   - date parsed
   - image present
   - translations native or machine-filled
5. Run `cd apps/web && npm run build`.
