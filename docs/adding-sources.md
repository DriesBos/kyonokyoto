# Adding Sources

Use the matching city source file as source of truth:

- `data/sources/kyoto-sources.json`
- `data/sources/osaka-sources.json`
- `data/sources/tokyo-sources.json`
- `data/sources/hong-kong-sources.json`

Crawler should not guess stable venue facts when you can write them once.

## Required Source Truth

Add these first:

```json
{
  "slug": "example-gallery",
  "name": "Example Gallery",
  "taxonomy": {
    "venue_category": ["gallery"],
    "display_category": ["photography"],
    "event_category": ["exhibition"]
  },
  "language": "ja",
  "base_url": "https://example.jp",
  "start_urls": ["https://example.jp/exhibitions/"],
  "allowed_domains": ["example.jp"],
  "event_page_patterns": ["/exhibitions/"],
  "address_text": "Example address, Kyoto",
  "directions_query": "Example Gallery, Kyoto",
  "lat": 35.0,
  "lng": 135.0,
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
      "images": ".event-body img"
    },
    "date_format": "YYYY.MM.DD - YYYY.MM.DD",
    "image_rules": "Keep artwork images only; skip logo/header images."
  }
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
- grouped taxonomy
- address
- directions query
- coordinates

## Languages

If source has separate language URLs:

```json
{
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
}
```

If source has one URL and a language toggle/menu:

```json
{
  "capabilities": {
    "native_locales": ["ja", "en"],
    "machine_translate_missing_locales": true
  }
}
```

If source has Japanese only:

```json
{
  "capabilities": {
    "native_locales": ["ja"],
    "machine_translate_missing_locales": true
  }
}
```

Only event `title` and `description` are localized. Dates, venue, address, images, and links stay shared.

## Simple CSS Selectors

Use selectors when page structure is simple and stable:

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

Supported selector style: `#id`, `.class`, `tag`, `tag.class`, and descendants like `#events a.event-link`.

If date parsing or page layout is weird, add source-specific extractor code and tests instead.

### Event images

Configured `selectors.images` keep page order and outrank generic Open Graph media. Generic extraction prefers article images and uses `og:image` only as a fallback. The final media pass still rejects obvious UI, social, placeholder, and LQIP URLs for configured and source-specific extractors.

Set `"skip_og_image": true` when a source's Open Graph image is a site card, flyer, or other non-event image. This does not disable configured or source-specific images.

Set `"measure_image_dimensions": true` when opaque image URLs repeatedly leak small or low-resolution media. Known or suspicious small candidates are probed selectively; probe failure keeps the image rather than deleting the source's only media. Measured event media must be at least 540px tall to support the card's maximum rendered height at 1.5x density.

Set `"landing_slider": true` to include a source in the city's curated landing candidates. This also measures its final image candidates, so no separate measurement flag is required for landing eligibility. Browser selection keeps one qualifying slide per source, caps output at six slides, uses at most a Full-HD viewport for eligibility, and requests no transform larger than 2560×1440.

The existing 100px width/height guard remains separate. It rejects obvious icons and UI thumbnails using dimensions exposed by page markup; it is not a source-quality measurement. URL rules for logos, social assets, and other UI images also remain necessary because those files can be larger than 540px.

`srcset` uses its largest candidate. Source-specific first-image or second-image rules remain authoritative because the final safety pass filters without reordering.

## QA Metadata

Use `qa` for facts you keep repeating during review:

- listing or exhibition URLs
- language URL behavior
- where title/date/description/images live
- date format
- image keep/skip rule

Keep `QA-todo.md` for unresolved crawl problems, approval notes, and crawl results.

## Crawl Hints

Use hints for predictable crawl behavior:

```json
{
  "crawl_hints": {
    "render_mode": "auto",
    "wait_for": "css:main .event-title",
    "scan_full_page": false,
    "max_detail_pages": 12,
    "skip_patterns": ["/archive/", "/news/"]
  }
}
```

Use `render_mode: "always"` only for JS-heavy sources. Static fetch is cheaper and more stable.
Use `wait_for` for known dynamic content. Enable `scan_full_page` only when required media loads on scroll.

## Multiple Venues

Use `venue_locations` when one source hosts events at multiple map locations:

```json
{
  "venue_locations": [
    {
      "name": "The Triangle",
      "match": ["The Triangle", "triangle"],
      "address_text": "The Triangle, Kyoto City KYOCERA Museum of Art",
      "lat": 35.0123,
      "lng": 135.7834
    }
  ]
}
```

First matching location wins. If nothing matches, source `lat`/`lng` are used.

## Test Flow

1. Add source config.
2. Run `node scripts/sync-sources.mjs --city=<city>`; review prune candidates without pruning.
3. Run `npm --prefix apps/crawler test`.
4. Run one source crawl locally or on VPS with `--city=<city>`.
5. Check crawl result:
   - detail URLs found
   - title/description present
   - date parsed
   - image present
   - translations native or machine-filled
6. Run `npm --prefix apps/web run build`.
