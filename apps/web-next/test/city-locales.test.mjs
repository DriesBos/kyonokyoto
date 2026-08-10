import assert from 'node:assert/strict';
import test from 'node:test';

const { alternateLocaleForCity, cityConfigFor, citySupportsLocale } = await import('../src/lib/cities.ts');
const { routePathFor } = await import('../src/lib/routeState.ts');
const { sitemapEntries } = await import('../src/lib/seo.ts');

test('city locale config keeps Hong Kong English-only on its bare canonical route', () => {
  const hongKong = cityConfigFor('hong-kong');
  assert.deepEqual(hongKong?.locales, ['en']);
  assert.equal(hongKong?.locales[0], 'en');
  assert.equal(citySupportsLocale(hongKong, 'ja'), false);
  assert.equal(routePathFor({ city: 'hong-kong', locale: 'en' }), '/hong-kong/');
  assert.equal(routePathFor({ city: 'kyoto', locale: 'en' }), '/kyoto/en/');
  assert.equal(alternateLocaleForCity('hong-kong', 'en'), undefined);
  assert.equal(alternateLocaleForCity('kyoto', 'en'), 'ja');
});

test('sitemap emits supported city locales only', () => {
  const hongKong = sitemapEntries().filter((entry) => entry.city === 'hong-kong');
  assert.deepEqual(hongKong.map((entry) => entry.url), ['https://kyonokyoto.com/hong-kong/']);
  assert.deepEqual(Object.keys(hongKong[0].languages), ['en']);
});
