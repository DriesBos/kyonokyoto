import type { AppCity } from './cities';

// Crawls purge this tag (scripts/run-crawl-cycle.mjs), so CDN copies can live until the city's
// date changes instead of expiring every few minutes.
export const cityCacheTag = (city: AppCity) => `city-${city}`;

export const secondsUntilMidnightInTimeZone = (now: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, Number(value)]),
  );
  const elapsed = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return Math.max(60, 86400 - elapsed);
};

// Pages classify events against the city's "today", so the CDN copy must expire at local midnight.
export const cityPageCacheHeaders = (city: AppCity, timeZone: string, now = new Date()) => ({
  'Cache-Control': 'public, max-age=60',
  'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${secondsUntilMidnightInTimeZone(now, timeZone)}, stale-while-revalidate=600`,
  'Netlify-Cache-Tag': cityCacheTag(city),
});
