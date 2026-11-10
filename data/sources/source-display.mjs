// The part of a source config the website shows (names, taxonomy, address, map pin, landing and
// beta flags, event-to-source matching URLs). scripts/sync-sources.mjs writes it to
// public.sources.display on every crawl cycle, and apps/web-next reads it back through the
// public.source_profiles view, so a new or edited source reaches the site with the next scheduled
// crawl instead of a Netlify deploy. Crawl internals (selectors, crawl_hints, notes, qa) stay out.
export const SOURCE_DISPLAY_KEYS = Object.freeze([
  'slug',
  'name',
  'names',
  'source_kind',
  'taxonomy',
  'landing_slider',
  'instagram',
  'map_visibility',
  'is_active',
  'beta',
  'base_url',
  'start_urls',
  'allowed_domains',
  'event_page_patterns',
  'address_text',
  'directions_query',
  'lat',
  'lng',
  'image_urls',
  'primary_image_url',
  'venue_locations',
  'festival',
]);

// Normalized configs add [] and {} defaults; leaving them out keeps the profile equal to the JSON.
const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

export function sourceDisplayProfile(source = {}) {
  return Object.fromEntries(
    SOURCE_DISPLAY_KEYS.filter((key) => !isEmpty(source[key])).map((key) => [key, source[key]]),
  );
}
