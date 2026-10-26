import type { AppCity } from './cities.ts';

// Supabase fetches carry this tag. Next adds fetch tags to the page's cache tags, and the Netlify
// runtime sends those as Netlify-Cache-Tag on the CDN copy of each ISR page, so the purge after a
// crawl (scripts/run-crawl-cycle.mjs) drops that city's city and festival pages. Pages revalidate
// every 5 minutes on their own (revalidate = 300), which also covers the city's date change.
export const cityCacheTag = (city: AppCity) => `city-${city}`;
