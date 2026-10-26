import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { cityCacheTag } from '../src/lib/cdnCache.ts';

const app = new URL('../src/app/', import.meta.url);

test('Supabase fetches carry the purgeable city tag', async () => {
  const events = await readFile(new URL('../src/lib/cityEvents.ts', import.meta.url), 'utf8');

  assert.equal(cityCacheTag('hong-kong'), 'city-hong-kong');
  assert.equal((events.match(/tags: \[cityCacheTag\(city\)\]/g) ?? []).length, 2);
});

// The Netlify runtime only puts static (ISR) pages on the CDN, and it never caches a failed
// render. Headers set in the proxy are added after the CDN layer, so they cannot cache a page.
test('city and festival pages stay static: no request headers or cookies', async () => {
  const files = [
    'RootDocument.tsx',
    '[city]/(single)/layout.tsx',
    '[city]/(single)/page.tsx',
    '[city]/(single)/festivals/[slug]/page.tsx',
    '[city]/[locale]/layout.tsx',
    '[city]/[locale]/page.tsx',
    '[city]/[locale]/festivals/[slug]/page.tsx',
    'CityEventsPage.tsx',
    'FestivalPage.tsx',
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, app), 'utf8');
    assert.doesNotMatch(source, /next\/headers|cookies\(\)|headers\(\)/, file);
  }
  for (const file of files.filter((name) => name.endsWith('page.tsx') && name.startsWith('['))) {
    assert.match(await readFile(new URL(file, app), 'utf8'), /export const revalidate = 300/, file);
  }
});

test('the proxy only runs the cookie redirects and never caches them', async () => {
  const proxy = await readFile(new URL('../src/proxy.ts', import.meta.url), 'utf8');

  assert.match(proxy, /matcher: \['\/', '\/en', '\/en\/', '\/ja', '\/ja\/'\]/);
  assert.match(proxy, /'Cache-Control', 'private, no-store'/);
  assert.doesNotMatch(proxy, /Netlify-CDN-Cache-Control/);
});
