import assert from 'node:assert/strict';
import test from 'node:test';

import { permanentEventsForLocale } from '../src/lib/permanentExhibitions.ts';

const testTaxonomy = (
  venue_category = ['gallery'],
  display_category = [],
  event_category = [],
) => ({ venue_category, display_category, event_category });

const sources = [
  {
    slug: 'kyoto-art-center',
    name: 'Kyoto Art Center',
    names: {
      en: 'Kyoto Art Center',
      ja: '京都芸術センター',
    },
    base_url: 'https://www.kac.or.jp',
    taxonomy: testTaxonomy(['museum'], [], ['exhibition']),
    address_text: '546-2 Yamabushiyama-cho, Nakagyo-ku, Kyoto 604-8156 Japan',
    lat: 35.005436,
    lng: 135.758345,
    is_active: true,
    map_visibility: true,
  },
];

test('permanent highlights resolve source venue data for locale cards', () => {
  const highlights = [
    {
      slug: 'kyoto-art-center',
      is_active: true,
      urls: {
        en: 'https://www.kac.or.jp/en/',
        ja: 'https://www.kac.or.jp/',
      },
    },
  ];

  const [event] = permanentEventsForLocale({
    highlights,
    configuredSources: sources,
    activeLocale: 'ja',
  });

  assert.equal(event.id, 'permanent:kyoto-art-center');
  assert.equal(event.title, '京都芸術センター');
  assert.equal(event.institution_name, '京都芸術センター');
  assert.equal(event.date_text, 'あわせて');
  assert.equal(event.timing, 'permanent');
  assert.deepEqual(event.categories, ['venue_category:museum', 'event_category:exhibition']);
  assert.equal(event.address_text, '546-2 Yamabushiyama-cho, Nakagyo-ku, Kyoto 604-8156 Japan');
  assert.equal(event.lat, 35.005436);
  assert.equal(event.lng, 135.758345);
  assert.equal(event.source_url, 'https://www.kac.or.jp/');
});

test('permanent highlights use embedded venue metadata when no source row exists', () => {
  const highlights = [
    {
      slug: 'sayuu',
      is_active: true,
      name: 'SAYUU',
      names: { ja: '若王子倶楽部 左右' },
      base_url: 'https://sayuu.jp/',
      address_text: '15-1 Nyakuoji-cho, Sakyo-ku, Kyoto 606-8444 Japan',
      lat: 35.0155614,
      lng: 135.7955184,
      taxonomy: testTaxonomy(['gallery'], ['craft']),
      media_embeds: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/watch?v=kK0xC3yRJ3I',
        },
      ],
    },
  ];

  const [event] = permanentEventsForLocale({
    highlights,
    configuredSources: [],
    activeLocale: 'ja',
  });

  assert.equal(event.id, 'permanent:sayuu');
  assert.equal(event.title, '若王子倶楽部 左右');
  assert.equal(event.institution_name, '若王子倶楽部 左右');
  assert.deepEqual(event.categories, ['venue_category:gallery', 'display_category:craft']);
  assert.equal(event.address_text, '15-1 Nyakuoji-cho, Sakyo-ku, Kyoto 606-8444 Japan');
  assert.equal(event.lat, 35.0155614);
  assert.equal(event.lng, 135.7955184);
  assert.equal(event.source_url, 'https://sayuu.jp/');
  assert.deepEqual(event.media_embeds, [
    {
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=kK0xC3yRJ3I',
      video_id: 'kK0xC3yRJ3I',
    },
  ]);
});

test('occasional highlights use localized cadence text', () => {
  const highlights = [
    {
      slug: 'nunuka-life',
      cadence: 'occasional',
      is_active: true,
      name: 'Nunuka life',
      names: { ja: 'Nunuka life' },
      base_url: 'https://www.instagram.com/nunuka_life/',
      address_text: '10 Jodoji Minamidacho, Sakyo-ku, Kyoto 606-8403 Japan',
      lat: 35.0261106,
      lng: 135.7962923,
      taxonomy: testTaxonomy(['gallery'], ['craft']),
    },
  ];

  const [event] = permanentEventsForLocale({
    highlights,
    configuredSources: [],
    activeLocale: 'ja',
  });

  assert.equal(event.id, 'occasional:nunuka-life');
  assert.equal(event.title, 'Nunuka life');
  assert.equal(event.date_text, 'あわせて');
  assert.equal(event.timing, 'permanent');
  assert.equal(event.source_url, 'https://www.instagram.com/nunuka_life/');
});

test('permanent highlights skip inactive rows', () => {
  const highlights = [{ slug: 'kyoto-art-center', is_active: false }];

  const events = permanentEventsForLocale({
    highlights,
    configuredSources: sources,
    activeLocale: 'en',
  });

  assert.deepEqual(events, []);
});
