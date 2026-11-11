import type { AppCity } from './cities.ts';

// Supabase fetches carry this tag. Next adds fetch tags to the page's cache tags, and the Netlify
// runtime sends those as Netlify-Cache-Tag on the CDN copy of each ISR page, so the purge after a
// crawl (scripts/run-crawl-cycle.mjs) drops that city's city and festival pages, so fresh data
// never waits for revalidation. Pages still revalidate hourly on their own (revalidate = 3600),
// which covers the city's date change (ongoing/upcoming, badges) within an hour of midnight.
// Route segment configs need a literal, so pages repeat 3600; keep them in step with this.
export const CITY_DATA_REVALIDATE_SECONDS = 3600;
export const cityCacheTag = (city: AppCity) => `city-${city}`;
