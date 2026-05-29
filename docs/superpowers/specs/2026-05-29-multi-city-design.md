# Multi-City Design

## Goal

Extend Kyo no Kyoto from a Kyoto-only cultural events app into a route-based multi-city app for Kyoto, Osaka, and Tokyo.

The first implementation keeps visual changes minimal:

- Kyoto keeps green.
- Osaka uses purple.
- Tokyo uses blue.
- Header gains a city toggle between map and language.
- Landing page text changes to `What's on in <City>`.
- Existing brand/logo remains unchanged.

## Cities

City config is the source of truth for city behavior.

Initial cities:

| City | Slug | Theme color | Route example |
| --- | --- | --- | --- |
| Kyoto | `kyoto` | `#138e00` | `/kyoto/en/` |
| Osaka | `osaka` | `#7d4cff` | `/osaka/en/` |
| Tokyo | `tokyo` | `#006fd6` | `/tokyo/en/` |

The city toggle cycles:

`Kyoto -> Osaka -> Tokyo -> Kyoto`

The button label shows the next city. Language is preserved during city switches.

## Routing

Canonical app routes become:

- `/kyoto/en/`
- `/kyoto/ja/`
- `/osaka/en/`
- `/osaka/ja/`
- `/tokyo/en/`
- `/tokyo/ja/`

Redirect behavior:

- `/` redirects to the remembered city, or Kyoto if none is remembered, and uses existing language detection.
- `/en/` redirects to `/kyoto/en/`.
- `/ja/` redirects to `/kyoto/ja/`.
- unknown city redirects to Kyoto with the requested valid locale.
- unknown locale redirects to English for the requested valid city.

City preference is stored with cookie/localStorage when a city route loads. This preference is used only for `/`.

## Frontend

The frontend loads city-specific source and permanent data for the active route.

Source files:

- `data/sources/kyoto-sources.json`
- `data/sources/osaka-sources.json`
- `data/sources/tokyo-sources.json`

Permanent venue files:

- `data/permanent/kyoto-permanent.json`
- `data/permanent/osaka-permanent.json`
- `data/permanent/tokyo-permanent.json`

Existing Kyoto source slugs remain unchanged. New slugs must be globally unique.

Events are fetched broadly from Supabase, then filtered through the active city's local source config. This avoids a larger PostgREST relation/filter change in the first implementation.

Landing page:

- background uses active city theme color.
- label becomes `What's on in Kyoto`, `What's on in Osaka`, or `What's on in Tokyo`.
- aria labels become city-aware.
- counts and categories come from active city events only.

Header:

- toolbar order becomes filter, map, city, language.
- city toggle uses same `GeneralButton` pattern as existing header controls.

Theme:

- CSS keeps existing semantic `--color-green` usage.
- active city sets `--color-green` to the city's theme color at the root.
- service worker cache name is bumped because route structure changes.

Map:

- one map component and one Google Maps JS implementation remain.
- map center is city-aware.
- map ID is city-aware through env fallback:
  - `PUBLIC_GOOGLE_MAPS_MAP_ID_KYOTO`
  - `PUBLIC_GOOGLE_MAPS_MAP_ID_OSAKA`
  - `PUBLIC_GOOGLE_MAPS_MAP_ID_TOKYO`
  - fallback: `PUBLIC_GOOGLE_MAPS_MAP_ID`
- city-specific Google Cloud map styles can be added later. Code supports them now.

## Database

Add `city` to `public.sources`.

Migration behavior:

- `city text not null default 'kyoto'`
- existing sources are backfilled as `kyoto`
- events keep linking through `source_id`

No event table city column is needed for the first implementation.

## Crawler

Use one crawler codebase with city-scoped commands.

Required behavior:

- `sync-sources --city=<city>` loads and mutates only that city's source file.
- stale-source deletion is city-scoped.
- `crawl --city=<city> --source=all` crawls only active sources for that city.
- empty city configs are valid and return success with `sources_total: 0`.
- empty city crawl cycles still trigger Netlify rebuilds.
- `run-crawl-cycle --city=<city>` runs pull, sync, crawl, translations check, and rebuild.

Crawler instances are separated by systemd instance name and logs, but share the same codebase and VPS.

## VPS Schedule

Use systemd template instances:

- `kyo-no-kyoto-crawl@kyoto.timer`
- `kyo-no-kyoto-crawl@osaka.timer`
- `kyo-no-kyoto-crawl@tokyo.timer`

Each city runs every 36 hours.

Initial 2h30m stagger:

- Kyoto: boot + 10m
- Osaka: boot + 2h40m
- Tokyo: boot + 5h10m

Future cities can use additional 2h30m slots across the 36h window.

A shared global lock prevents overlapping crawl cycles on the 512 MB RAM VPS. If a cycle is already running, the later cycle exits without starting another crawl.

## Tests

Add city matrix coverage:

- every city source file exists and parses.
- every source validates cleanly with `validateSourceConfig`.
- source city assignment matches file city.
- slugs are globally unique.
- permanent files exist and parse.
- empty Osaka/Tokyo data is accepted.
- empty city crawl returns success.
- city routing and redirects behave as expected.
- build succeeds for all city/locale routes.

Existing source-specific extractor tests remain Kyoto-focused until Osaka/Tokyo sources are added.

## Docs

Update only operational docs:

- README intro says multi-city cultural events app.
- source docs mention city source files.
- crawler roadmap and ops docs mention `--city`.
- systemd docs explain instance timers and shared lock.

No broad brand rewrite.

## Out Of Scope

- Renaming the product/logo.
- Adding real Osaka/Tokyo sources.
- Creating Google Cloud map styles manually.
- Splitting Supabase projects.
- Splitting deployments by city.
- Changing animation design.
