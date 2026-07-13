import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allActiveSourcesFrom,
  categoriesForEvents,
  mapSourcesForEvents,
  matchesCategoryGroups,
  sourceDisplayNameForEvent,
  sourceSlugForEvent,
  sourceTruthForEvent,
} from '../src/lib/sources.ts';

const testTaxonomy = (
  venue_category = ['gallery'],
  display_category = [],
  event_category = [],
) => ({ venue_category, display_category, event_category });

test('source normalization rejects unregistered filter categories', () => {
  assert.throws(
    () =>
      allActiveSourcesFrom([
        {
          slug: 'bad-category',
          name: 'Bad Category',
          base_url: 'https://example.com',
          taxonomy: testTaxonomy(['gallery'], [], ['book fair']),
        },
      ]),
    /bad-category: unsupported event_category "book fair"/,
  );
});

test('category filters group namespaced taxonomy and combine dimensions', () => {
  const categories = [
    'venue_category:gallery',
    'display_category:graphic',
    'event_category:exhibition',
  ];

  assert.deepEqual(categoriesForEvents([{ categories }]), [
    { slug: 'venue_category:gallery', label: 'gallery', dimension: 'venue_category' },
    { slug: 'display_category:graphic', label: 'graphic', dimension: 'display_category' },
    { slug: 'event_category:exhibition', label: 'exhibition', dimension: 'event_category' },
  ]);
  assert.equal(
    matchesCategoryGroups(
      categories,
      new Map([
        ['venue_category', ['venue_category:museum', 'venue_category:gallery']],
        ['event_category', ['event_category:exhibition']],
      ]),
    ),
    true,
  );
  assert.equal(
    matchesCategoryGroups(
      categories,
      new Map([
        ['venue_category', ['venue_category:gallery']],
        ['event_category', ['event_category:workshop']],
      ]),
    ),
    false,
  );
});

test('map sources include permanent events without source config rows', () => {
  const event = {
    id: 'permanent:sayuu',
    source_id: 'sayuu',
    title: 'Permanent collection',
    categories: ['venue_category:gallery', 'display_category:contemporary'],
    date_text: 'Permanent',
    institution_name: 'SAYUU',
    venue_name: null,
    address_text: '15-1 Nyakuoji-cho, Sakyo-ku, Kyoto 606-8444 Japan',
    directions_query: '京都市左京区若王子町15-1',
    lat: 35.0155614,
    lng: 135.7955184,
    start_date: null,
    end_date: null,
    calendar_starts_at: null,
    calendar_ends_at: null,
    primary_image_url: null,
    image_urls: [],
    source_url: 'https://sayuu.jp/',
    description: null,
    timing: 'permanent',
  };

  const mapSources = mapSourcesForEvents([event], new Map([[event.id, 'sayuu']]), []);

  assert.deepEqual(mapSources, [
    {
      id: 'sayuu:35.015561:135.795518:sayuu',
      sourceSlug: 'sayuu',
      name: 'SAYUU',
      categories: ['venue_category:gallery', 'display_category:contemporary'],
      lat: 35.0155614,
      lng: 135.7955184,
    },
  ]);
});

test('map sources use event taxonomy when permanent highlights refine a source', () => {
  const event = {
    id: 'permanent:kyoto-art-center',
    institution_name: 'Kyoto Art Center',
    categories: [
      'venue_category:institute',
      'venue_category:museum',
      'display_category:performance',
      'event_category:exhibition',
      'event_category:workshop',
    ],
    lat: 35.005436,
    lng: 135.758345,
  };
  const sources = [
    {
      slug: 'kyoto-art-center',
      name: 'Kyoto Art Center',
      base_url: 'https://www.kac.or.jp',
      taxonomy: testTaxonomy(['institute'], ['contemporary']),
      lat: 35.005436,
      lng: 135.758345,
    },
  ];

  const [mapSource] = mapSourcesForEvents(
    [event],
    new Map([[event.id, 'kyoto-art-center']]),
    sources,
  );

  assert.deepEqual(mapSource.categories, event.categories);
});

test('sourceDisplayNameForEvent prefers localized source names over scraped event venue name', () => {
  const event = {
    source_url: 'https://example.test/events/current-exhibition',
    institution_name: 'Old scraped venue name',
  };
  const sources = [
    {
      slug: 'example-gallery',
      name: 'Example Gallery',
      names: {
        en: 'Correct English Gallery',
        ja: '正しいギャラリー',
      },
      base_url: 'https://example.test/events/',
      allowed_domains: ['example.test'],
      taxonomy: testTaxonomy(['gallery']),
    },
  ];

  assert.equal(sourceDisplayNameForEvent(event, sources, 'ja'), '正しいギャラリー');
  assert.equal(sourceDisplayNameForEvent(event, sources, 'en'), 'Correct English Gallery');
});

test('sourceSlugForEvent prefers Supabase source relation over URL matching', () => {
  const event = {
    source_id: '2c9387fc-b1df-4dac-a3de-e69d33f1187a',
    source_url: 'https://redirect.example/events/42',
    institution_name: 'Old venue',
    sources: {
      slug: 'example-gallery',
    },
  };
  const sources = [
    {
      slug: 'example-gallery',
      name: 'Example Gallery',
      base_url: 'https://example.test/events/',
      taxonomy: testTaxonomy(['gallery']),
    },
  ];

  assert.equal(sourceSlugForEvent(event, sources), 'example-gallery');
});

test('sourceTruthForEvent returns venue and categories from source JSON', () => {
  const event = {
    source_id: '2c9387fc-b1df-4dac-a3de-e69d33f1187a',
    source_url: 'https://redirect.example/events/42',
    title: 'Event title',
    categories: ['wrong'],
    institution_name: 'Old venue',
    venue_name: 'Old room',
    address_text: 'Old address',
    directions_query: 'Old map query',
    lat: 1,
    lng: 2,
    sources: {
      slug: 'example-gallery',
    },
  };
  const sources = [
    {
      slug: 'example-gallery',
      name: 'Example Gallery',
      names: {
        ja: '正しいギャラリー',
      },
      base_url: 'https://example.test/events/',
      taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
      address_text: 'Correct address',
      directions_query: 'Correct map query',
      lat: 35.1,
      lng: 135.1,
    },
  ];

  assert.deepEqual(sourceTruthForEvent(event, sources, 'ja'), {
    sourceSlug: 'example-gallery',
    institution_name: '正しいギャラリー',
    venue_name: 'Example Gallery',
    address_text: 'Correct address',
    directions_query: 'Correct map query',
    categories: ['venue_category:gallery', 'event_category:exhibition'],
    lat: 35.1,
    lng: 135.1,
  });
});
