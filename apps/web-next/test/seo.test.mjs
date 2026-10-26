import assert from 'node:assert/strict';
import test from 'node:test';

const { buildMetadata, festivalSitemapEntries, siteOrigin, structuredData } = await import(
  '../src/lib/seo.ts'
);

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

test('SEO metadata uses canonical, hreflang, social image, and public origin', () => {
  const previousNext = process.env.NEXT_PUBLIC_SITE_URL;
  const previousPublic = process.env.PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com/path';
  process.env.PUBLIC_SITE_URL = 'https://legacy.example';

  const metadata = buildMetadata({ city: 'kyoto', locale: 'en' });
  assert.equal(siteOrigin(), 'https://example.com');
  assert.equal(metadata.alternates.canonical, 'https://example.com/kyoto/en/');
  assert.equal(metadata.alternates.languages.ja, 'https://example.com/kyoto/ja/');
  assert.equal(metadata.openGraph.images[0].url, 'https://example.com/og.png');
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.match(metadata.title, /Kyoto/);

  if (previousNext === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previousNext;
  if (previousPublic === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = previousPublic;
});

test('single-locale city has bare canonical and no unsupported alternate', () =>
  withoutSiteUrl(() => {
    const metadata = buildMetadata({ city: 'hong-kong', locale: 'en' });
    assert.equal(metadata.alternates.canonical, 'https://kyonokyoto.xyz/hong-kong/');
    assert.equal(metadata.alternates.languages.en, 'https://kyonokyoto.xyz/hong-kong/');
    assert.equal(metadata.alternates.languages.ja, undefined);
  }));

test('JSON-LD is a localized CollectionPage', () => {
  const data = structuredData({ city: 'hong-kong', locale: 'en' });
  assert.equal(data['@type'], 'CollectionPage');
  assert.equal(data.inLanguage, 'en');
  assert.match(data.name, /Hong Kong/);
});

test('festival pages are in the sitemap with their locale alternates', () =>
  withoutSiteUrl(() => {
    const entries = festivalSitemapEntries([
      { city: 'kyoto', slug: 'art week' },
      { city: 'hong-kong', slug: 'art-basel' },
    ]);
    assert.deepEqual(
      entries.map(({ url }) => url),
      [
        'https://kyonokyoto.xyz/kyoto/en/festivals/art%20week/',
        'https://kyonokyoto.xyz/kyoto/ja/festivals/art%20week/',
        'https://kyonokyoto.xyz/hong-kong/festivals/art-basel/',
      ],
    );
    assert.equal(entries[0].languages.ja, 'https://kyonokyoto.xyz/kyoto/ja/festivals/art%20week/');
    assert.deepEqual(Object.keys(entries[2].languages), ['en']);
  }));

test('city JSON-LD lists dated events; festival JSON-LD is a Festival with its page URL', async () => {
  const { structuredData, festivalStructuredData } = await import('../src/lib/seo.ts');
  const event = {
    name: 'Show',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    place: 'Gallery',
    address: null,
    image: null,
    url: 'https://example.com/show',
  };
  const city = structuredData({
    city: 'kyoto',
    locale: 'en',
    events: [event, { ...event, name: 'Permanent', startDate: null }],
  });
  assert.equal(city.mainEntity.itemListElement.length, 1);
  assert.equal(city.mainEntity.itemListElement[0].item.name, 'Show');
  assert.equal(city.mainEntity.itemListElement[0].item.location.name, 'Gallery');

  const festival = festivalStructuredData({ city: 'kyoto', locale: 'ja', slug: 'ack', event });
  assert.equal(festival['@type'], 'Festival');
  assert.match(festival.url, /\/kyoto\/ja\/festivals\/ack\/$/);
  assert.equal(festival.sameAs, 'https://example.com/show');
});
