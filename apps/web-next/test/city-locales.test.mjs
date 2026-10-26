import assert from 'node:assert/strict';
import test from 'node:test';

const { alternateLocaleForCity, cityConfigFor, citySupportsLocale } =
  await import('../src/lib/cities.ts');
const { routePathFor } = await import('../src/lib/routeState.ts');
const { sitemapEntries } = await import('../src/lib/seo.ts');

// Netlify builds run tests with PUBLIC_SITE_URL set; these assertions pin the fallback origin.
const withoutSiteUrl = (fn) => {
  const previous = [process.env.NEXT_PUBLIC_SITE_URL, process.env.PUBLIC_SITE_URL];
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.PUBLIC_SITE_URL;
  try {
    fn();
  } finally {
    if (previous[0] !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previous[0];
    if (previous[1] !== undefined) process.env.PUBLIC_SITE_URL = previous[1];
  }
};

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

test('sitemap emits supported city locales only', () =>
  withoutSiteUrl(() => {
    const hongKong = sitemapEntries().filter((entry) => entry.city === 'hong-kong');
    assert.deepEqual(
      hongKong.map((entry) => entry.url),
      ['https://kyonokyoto.com/hong-kong/'],
    );
    assert.deepEqual(Object.keys(hongKong[0].languages), ['en']);
  }));
