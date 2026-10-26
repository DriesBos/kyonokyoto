import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cityCacheTag,
  cityPageCacheHeaders,
  secondsUntilMidnightInTimeZone,
} from '../src/lib/cdnCache.ts';

test('CDN copies of city pages expire at local midnight', () => {
  // 2026-10-25 22:00 in Tokyo.
  const now = new Date('2026-10-25T13:00:00Z');

  assert.equal(secondsUntilMidnightInTimeZone(now, 'Asia/Tokyo'), 2 * 3600);
  assert.equal(secondsUntilMidnightInTimeZone(now, 'Asia/Hong_Kong'), 3 * 3600);
  assert.equal(secondsUntilMidnightInTimeZone(new Date('2026-10-25T14:59:30Z'), 'Asia/Tokyo'), 60);
});

test('city page headers carry the purgeable city tag', () => {
  const headers = cityPageCacheHeaders('kyoto', 'Asia/Tokyo', new Date('2026-10-25T13:00:00Z'));

  assert.equal(cityCacheTag('hong-kong'), 'city-hong-kong');
  assert.equal(headers['Netlify-Cache-Tag'], 'city-kyoto');
  assert.equal(headers['Cache-Control'], 'public, max-age=60');
  assert.equal(
    headers['Netlify-CDN-Cache-Control'],
    'public, durable, s-maxage=7200, stale-while-revalidate=600',
  );
});

test('only canonical city and festival pages get the long CDN lifetime', async () => {
  const { cachedCityPagePath } = await import('../src/lib/cdnCache.ts');

  assert.equal(cachedCityPagePath('/kyoto/en/')?.slug, 'kyoto');
  assert.equal(cachedCityPagePath('/tokyo/ja/festivals/art-week/')?.slug, 'tokyo');
  assert.equal(cachedCityPagePath('/hong-kong/')?.slug, 'hong-kong');
  assert.equal(cachedCityPagePath('/hong-kong/festivals/art-basel/')?.slug, 'hong-kong');
  assert.equal(cachedCityPagePath('/'), null);
  assert.equal(cachedCityPagePath('/en/'), null);
  assert.equal(cachedCityPagePath('/kyoto/'), null);
  assert.equal(cachedCityPagePath('/kyoto/fr/'), null);
  assert.equal(cachedCityPagePath('/Kyoto/en/'), null);
  assert.equal(cachedCityPagePath('/hong-kong/en/'), null);
});
