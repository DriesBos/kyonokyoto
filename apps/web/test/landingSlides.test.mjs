import assert from 'node:assert/strict';
import test from 'node:test';

import {
  landingSliderSourceSlugsByCity,
  landingSlidesForEvents,
} from '../src/lib/landingSlides.ts';

const event = (overrides) => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  timing: overrides.timing ?? 'upcoming',
  image_urls: overrides.image_urls ?? [],
  primary_image_url: overrides.primary_image_url ?? null,
});

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
        src: 'https://example.test/nmoa-1.jpg',
        title: 'NMOA first',
        sourceSlug: 'national-museum-of-art-osaka',
      },
      {
        src: 'https://example.test/abeno-1.jpg',
        title: 'ABENO fallback',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        src: 'https://example.test/abeno-extra-0.jpg',
        title: 'abeno-extra-0',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        src: 'https://example.test/abeno-extra-1.jpg',
        title: 'abeno-extra-1',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        src: 'https://example.test/abeno-extra-2.jpg',
        title: 'abeno-extra-2',
        sourceSlug: 'abeno-harukas-art-museum',
      },
      {
        src: 'https://example.test/abeno-extra-3.jpg',
        title: 'abeno-extra-3',
        sourceSlug: 'abeno-harukas-art-museum',
      },
    ],
  );
});

test('landing slider uses configured Tokyo museum sources', () => {
  assert.deepEqual(landingSliderSourceSlugsByCity.tokyo, [
    'mori-art-museum',
    'tokyo-photographic-art-museum',
  ]);
});

test('landing slider uses configured Hong Kong venues', () => {
  assert.deepEqual(landingSliderSourceSlugsByCity['hong-kong'], ['m-plus', 'tai-kwun']);
});
