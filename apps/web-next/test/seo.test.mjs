import assert from 'node:assert/strict';
import test from 'node:test';

const { buildMetadata, siteOrigin, structuredData } = await import('../src/lib/seo.ts');

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
    assert.equal(metadata.alternates.canonical, 'https://kyonokyoto.com/hong-kong/');
    assert.equal(metadata.alternates.languages.en, 'https://kyonokyoto.com/hong-kong/');
    assert.equal(metadata.alternates.languages.ja, undefined);
  }));

test('JSON-LD is a localized CollectionPage', () => {
  const data = structuredData({ city: 'hong-kong', locale: 'en' });
  assert.equal(data['@type'], 'CollectionPage');
  assert.equal(data.inLanguage, 'en');
  assert.match(data.name, /Hong Kong/);
});
