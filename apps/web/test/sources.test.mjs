import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapSourcesForEvents,
  sourceDisplayNameForEvent,
  sourceSlugForEvent,
  sourceTruthForEvent,
} from '../src/lib/sources.ts';

test('map sources include permanent events without source config rows', () => {
  const event = {
    id: 'permanent:sayuu',
    source_id: 'sayuu',
    title: 'Permanent collection',
    categories: ['craft', 'gallery'],
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
      categories: ['craft', 'gallery'],
      lat: 35.0155614,
      lng: 135.7955184,
    },
  ]);
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
      source_type: 'gallery',
      base_url: 'https://example.test/events/',
      allowed_domains: ['example.test'],
      source_categories: ['gallery'],
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
      source_type: 'gallery',
      base_url: 'https://example.test/events/',
      source_categories: ['gallery'],
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
      source_type: 'gallery',
      base_url: 'https://example.test/events/',
      source_categories: ['gallery', 'exhibition'],
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
    categories: ['gallery', 'exhibition'],
    lat: 35.1,
    lng: 135.1,
  });
});
