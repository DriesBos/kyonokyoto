import assert from 'node:assert/strict';
import test from 'node:test';

import { landingSlidesForEvents } from '../src/lib/landingSlides.ts';
import { coverDensityFor, resolveLandingSlides } from '../src/scripts/landingSlider.ts';

const event = (overrides) => {
  const imageUrls = overrides.image_urls ?? [];
  const primaryImageUrl = overrides.primary_image_url ?? null;
  const allImageUrls = [...new Set([primaryImageUrl, ...imageUrls].filter(Boolean))];

  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    timing: overrides.timing ?? 'upcoming',
    image_urls: imageUrls,
    primary_image_url: primaryImageUrl,
    image_metadata:
      overrides.image_metadata ?? allImageUrls.map((url) => ({ url, width: 2400, height: 1600 })),
  };
};

test('landing candidates include every configured event before viewport selection', () => {
  const events = [
    event({ id: 'skip-wrong-source', image_urls: ['https://example.test/wrong.jpg'] }),
    event({ id: 'nmoa-1', image_urls: ['https://example.test/nmoa-1.jpg'] }),
    event({ id: 'nmoa-duplicate', image_urls: ['https://example.test/nmoa-1.jpg'] }),
    event({ id: 'abeno-1', primary_image_url: 'https://example.test/abeno-1.jpg' }),
    event({
      id: 'abeno-permanent',
      timing: 'permanent',
      image_urls: ['https://example.test/permanent.jpg'],
    }),
    ...Array.from({ length: 6 }, (_, index) =>
      event({
        id: `abeno-extra-${index}`,
        image_urls: [`https://example.test/abeno-extra-${index}.jpg`],
      }),
    ),
  ];
  const sourceSlugByEventId = new Map([
    ['skip-wrong-source', 'yod-gallery'],
    ['nmoa-1', 'national-museum-of-art-osaka'],
    ['nmoa-duplicate', 'national-museum-of-art-osaka'],
    ['abeno-1', 'abeno-harukas-art-museum'],
    ['abeno-permanent', 'abeno-harukas-art-museum'],
    ...Array.from({ length: 6 }, (_, index) => [
      `abeno-extra-${index}`,
      'abeno-harukas-art-museum',
    ]),
  ]);

  const slides = landingSlidesForEvents({
    events,
    landingSourceSlugs: ['national-museum-of-art-osaka', 'abeno-harukas-art-museum'],
    sourceSlugByEventId,
  });

  assert.deepEqual(
    slides.map((slide) => slide.title),
    ['nmoa-1', 'abeno-1', ...Array.from({ length: 6 }, (_, index) => `abeno-extra-${index}`)],
  );
});

test('landing slides require measured dimensions from current event media', () => {
  const slides = landingSlidesForEvents({
    events: [
      event({
        id: 'unknown',
        image_urls: ['https://example.test/unknown.jpg'],
        image_metadata: [],
      }),
      event({
        id: 'stale',
        image_urls: ['https://example.test/current.jpg'],
        image_metadata: [{ url: 'https://example.test/stale.jpg', width: 3000, height: 2000 }],
      }),
    ],
    landingSourceSlugs: ['kcua', 'artro'],
    sourceSlugByEventId: new Map([
      ['unknown', 'kcua'],
      ['stale', 'artro'],
    ]),
  });

  assert.deepEqual(slides, []);
});

test('cover density allows a portrait image on mobile but rejects it on desktop', () => {
  const portrait = { width: 1000, height: 1414 };
  assert.ok(coverDensityFor(portrait, 390, 844) >= 1);
  assert.ok(coverDensityFor(portrait, 1440, 900) < 1);

  const slides = [
    {
      images: [{ src: 'https://www.nmao.go.jp/poster.jpg', ...portrait }],
      title: 'Portrait exhibition',
      sourceSlug: 'national-museum-of-art-osaka',
    },
  ];

  assert.equal(
    resolveLandingSlides({ slides, viewportWidth: 1440, viewportHeight: 900, devicePixelRatio: 2 })
      .length,
    0,
  );
  const [mobile] = resolveLandingSlides({
    slides,
    viewportWidth: 390,
    viewportHeight: 844,
    devicePixelRatio: 2,
  });
  const url = new URL(mobile.src, 'https://example.test');
  assert.equal(url.pathname, '/.netlify/images');
  assert.equal(url.searchParams.get('url'), 'https://www.nmao.go.jp/poster.jpg');
  assert.equal(url.searchParams.get('fit'), 'cover');
  assert.equal(url.searchParams.get('q'), '82');
  assert.ok(Number(url.searchParams.get('w')) <= portrait.width);
  assert.ok(Number(url.searchParams.get('h')) <= portrait.height);
});

test('viewport filtering happens before one-per-source and six-slide limits', () => {
  const undersized = Array.from({ length: 6 }, (_, index) => ({
    images: [{ src: `https://example.test/small-${index}.jpg`, width: 800, height: 600 }],
    title: `Small ${index}`,
    sourceSlug: `small-${index}`,
  }));
  const valid = Array.from({ length: 7 }, (_, index) => ({
    images: [{ src: `https://example.test/valid-${index}.jpg`, width: 2400, height: 1600 }],
    title: `Valid ${index}`,
    sourceSlug: `valid-${index}`,
  }));

  const resolved = resolveLandingSlides({
    slides: [
      ...undersized,
      valid[0],
      { ...valid[0], title: 'Duplicate source' },
      ...valid.slice(1),
    ],
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  });

  assert.deepEqual(
    resolved.map((slide) => slide.sourceSlug),
    Array.from({ length: 6 }, (_, index) => `valid-${index}`),
  );
});

test('4K and 5K monitors share a capped Full-HD eligibility target', () => {
  const slides = [
    {
      images: [{ src: 'https://example.test/tokyo.jpg', width: 2000, height: 1500 }],
      title: 'Tokyo',
      sourceSlug: 'what-museum',
    },
  ];
  const resolveFor = (viewportWidth, viewportHeight) =>
    resolveLandingSlides({ slides, viewportWidth, viewportHeight, devicePixelRatio: 2 })[0];
  const fourK = resolveFor(3840, 2160);
  const fiveK = resolveFor(5120, 2880);

  assert.ok(fourK);
  assert.deepEqual({ width: fourK.width, height: fourK.height }, { width: 2000, height: 1125 });
  assert.deepEqual(
    { width: fiveK.width, height: fiveK.height },
    { width: fourK.width, height: fourK.height },
  );
});

test('landing transforms never exceed 2560 by 1440', () => {
  const [slide] = resolveLandingSlides({
    slides: [
      {
        images: [{ src: 'https://example.test/huge.jpg', width: 8000, height: 8000 }],
        title: 'Huge',
        sourceSlug: 'huge',
      },
    ],
    viewportWidth: 5120,
    viewportHeight: 2880,
    devicePixelRatio: 2,
  });

  assert.deepEqual({ width: slide.width, height: slide.height }, { width: 2560, height: 1440 });
});
