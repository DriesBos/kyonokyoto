import assert from 'node:assert/strict';
import test from 'node:test';

import {
  landingSliderSourceSlugsByCity,
  landingSlidesForEvents,
} from '../src/lib/landingSlides.ts';
import { coverDensityFor, resolveLandingSlides } from '../src/scripts/landingSlider.ts';
import { loadAllSourcesConfig } from '../../../data/sources/source-config.mjs';

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

test('landingSlidesForEvents keeps configured city source order from events and caps unique images', () => {
  const events = [
    event({
      id: 'skip-wrong-source',
      image_urls: ['https://example.test/wrong.jpg'],
    }),
    event({
      id: 'nmoa-1',
      title: 'NMOA first',
      image_urls: ['https://example.test/nmoa-1.jpg'],
    }),
    event({
      id: 'nmoa-duplicate',
      title: 'NMOA duplicate',
      image_urls: ['https://example.test/nmoa-1.jpg'],
    }),
    event({
      id: 'abeno-1',
      title: 'ABENO fallback',
      primary_image_url: 'https://example.test/abeno-1.jpg',
    }),
    event({
      id: 'abeno-no-image',
      title: 'ABENO no image',
    }),
    event({
      id: 'abeno-permanent',
      title: 'ABENO permanent',
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
    ['abeno-no-image', 'abeno-harukas-art-museum'],
    ['abeno-permanent', 'abeno-harukas-art-museum'],
    ...Array.from({ length: 6 }, (_, index) => [
      `abeno-extra-${index}`,
      'abeno-harukas-art-museum',
    ]),
  ]);

  assert.deepEqual(
    landingSlidesForEvents({
      city: 'osaka',
      events,
      sourceSlugByEventId,
    }),
    [
      {
        images: [{ src: 'https://example.test/nmoa-1.jpg', width: 2400, height: 1600 }],
        title: 'NMOA first',
        sourceSlug: 'national-museum-of-art-osaka',
      },
      {
        images: [{ src: 'https://example.test/abeno-1.jpg', width: 2400, height: 1600 }],
        title: 'ABENO fallback',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        images: [{ src: 'https://example.test/abeno-extra-0.jpg', width: 2400, height: 1600 }],
        title: 'abeno-extra-0',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        images: [{ src: 'https://example.test/abeno-extra-1.jpg', width: 2400, height: 1600 }],
        title: 'abeno-extra-1',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        images: [{ src: 'https://example.test/abeno-extra-2.jpg', width: 2400, height: 1600 }],
        title: 'abeno-extra-2',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        images: [{ src: 'https://example.test/abeno-extra-3.jpg', width: 2400, height: 1600 }],
        title: 'abeno-extra-3',
        sourceSlug: 'abeno-harukas-art-museum',
      },
    ],
  );
});

test('Osaka landing slider accepts Tezukayama landscape images on desktop', () => {
  const slides = landingSlidesForEvents({
    city: 'osaka',
    events: [
      event({
        id: 'tezukayama-current',
        image_urls: ['https://www.tezukayama-g.com/exhibition.jpg'],
        image_metadata: [
          {
            url: 'https://www.tezukayama-g.com/exhibition.jpg',
            width: 1280,
            height: 905,
          },
        ],
      }),
    ],
    sourceSlugByEventId: new Map([['tezukayama-current', 'tezukayama-gallery']]),
  });

  assert.equal(
    resolveLandingSlides({ slides, viewportWidth: 1440, viewportHeight: 900, devicePixelRatio: 2 })
      .length,
    1,
  );
});

test('landing slider uses configured Tokyo museum sources', () => {
  assert.deepEqual(landingSliderSourceSlugsByCity.tokyo, [
    'mori-art-museum',
    'tokyo-photographic-art-museum',
  ]);
});

test('landing slider uses configured Hong Kong galleries', () => {
  assert.deepEqual(landingSliderSourceSlugsByCity['hong-kong'], [
    'david-zwirner',
    'kiang-malingue',
    'gallery-exit',
  ]);
});

test('every landing source measures image dimensions during crawls', async () => {
  const sourceBySlug = new Map(
    (await loadAllSourcesConfig()).map((source) => [source.slug, source]),
  );

  for (const slug of Object.values(landingSliderSourceSlugsByCity).flat()) {
    assert.equal(sourceBySlug.get(slug)?.measure_image_dimensions, true, slug);
  }
});

test('landing slides require measured dimensions from current event media', () => {
  const slides = landingSlidesForEvents({
    city: 'kyoto',
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
    sourceSlugByEventId: new Map([
      ['unknown', 'kcua'],
      ['stale', 'artro'],
    ]),
  });

  assert.deepEqual(slides, []);
});

test('cover density allows a portrait image on mobile but rejects it on desktop', () => {
  const portrait = { width: 1000, height: 1414 };
  assert.ok(coverDensityFor(portrait, 390, 844) >= 1.5);
  assert.ok(coverDensityFor(portrait, 1440, 900) < 1.5);

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
