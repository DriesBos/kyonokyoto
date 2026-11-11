import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SOCIAL_CITY_COLORS } from '../../../packages/shared/social-post.mjs';
import {
  categoryHashtags,
  hashtagFor,
  instagramHandle,
  rankSocialCandidates,
  scoreSocialEvent,
  socialCaption,
  SOCIAL_POINTS,
} from '../src/lib/socialPosts.ts';

const today = '2026-11-10';
const event = (overrides = {}) => ({
  id: 'e1',
  group: 'ongoing',
  beta: false,
  title: 'Clay, Fire, Time',
  institution: 'Kyoto City KYOCERA Museum of Art',
  venue: null,
  date: "Ongoing — 16 Nov '26",
  calendarStartsAt: '2026-10-01',
  calendarEndsAt: '2026-12-20',
  endsSoon: false,
  images: [{ url: 'https://example.com/a.jpg', width: 1600, height: 1000 }],
  eventKind: 'event',
  filterTags: ['type:art', 'sub:art:ceramics', 'place:museum'],
  venueInstagram: 'kyotocitykyoceramuseum',
  ...overrides,
});

test('starting this week and ending this week each score', () => {
  const starting = scoreSocialEvent(
    event({ group: 'upcoming', calendarStartsAt: '2026-11-14' }),
    today,
  );
  assert.equal(starting.score, SOCIAL_POINTS.startsThisWeek);
  const ending = scoreSocialEvent(event({ endsSoon: true, calendarEndsAt: '2026-11-16' }), today);
  assert.equal(ending.score, SOCIAL_POINTS.endsThisWeek);
  assert.equal(ending.endDate, '2026-11-16');
  const later = scoreSocialEvent(
    event({ group: 'upcoming', calendarStartsAt: '2026-11-17' }),
    today,
  );
  assert.equal(later.score, 0);
});

test('image quality adds AI score, clean bonus and rating; small images lose points', () => {
  const good = scoreSocialEvent(
    event({
      images: [{ url: 'u', width: 1600, height: 1000, score: 8, landingOk: true, rating: 2 }],
    }),
    today,
  );
  assert.equal(good.score, 3.2 + 1 + 2);
  assert.deepEqual([good.imageWidth, good.imageHeight], [1600, 1000]);
  const small = scoreSocialEvent(event({ images: [{ url: 'u', width: 500, height: 400 }] }), today);
  assert.equal(small.score, SOCIAL_POINTS.smallImage);
});

test('no image, -2 image, beta and permanent events are never proposed', () => {
  assert.equal(scoreSocialEvent(event({ images: [] }), today), null);
  assert.equal(scoreSocialEvent(event({ images: [{ url: 'u', rating: -2 }] }), today), null);
  assert.equal(scoreSocialEvent(event({ beta: true }), today), null);
  assert.equal(scoreSocialEvent(event({ group: 'permanent' }), today), null);
  assert.equal(scoreSocialEvent(event({ venueInstagram: null }), today), null);
  assert.equal(scoreSocialEvent(event({ venueInstagram: 'not a handle' }), today), null);
});

test('candidates are ranked best first', () => {
  const ranked = rankSocialCandidates(
    [event({ id: 'plain' }), event({ id: 'ending', endsSoon: true })],
    today,
  );
  assert.deepEqual(
    ranked.map((candidate) => candidate.event.id),
    ['ending', 'plain'],
  );
});

test('caption: title, dates, venue, then #category #subcategories #venue', () => {
  assert.equal(
    socialCaption(event({ venueInstagram: null })),
    [
      '"Clay, Fire, Time"',
      "Ongoing — 16 Nov '26",
      'Kyoto City KYOCERA Museum of Art',
      '',
      '#art #ceramics #kyotocitykyoceramuseumofart',
    ].join('\n'),
  );
  assert.match(
    socialCaption(event({ venueInstagram: 'kyotocitykyoceramuseum' })),
    /\n@kyotocitykyoceramuseum\n/,
  );
  assert.match(socialCaption(event({ endsSoon: true })), /^Last week:\n"Clay, Fire, Time"\n/);
  assert.match(socialCaption(event({ startsSoon: true })), /^Opening soon:\n"Clay, Fire, Time"\n/);
});

test('hashtags and handles are cleaned up', () => {
  assert.equal(hashtagFor('Kyōto Art & Design Center'), '#kyotoartanddesigncenter');
  assert.equal(hashtagFor('  '), null);
  assert.deepEqual(categoryHashtags(['type:historic', 'sub:historic:temple']), [
    '#historic',
    '#temple',
  ]);
  assert.equal(instagramHandle('https://www.instagram.com/momak_kyoto/'), '@momak_kyoto');
  assert.equal(instagramHandle('@momak_kyoto'), '@momak_kyoto');
  assert.equal(instagramHandle('not a handle!'), null);
});

test('post colours match the city colours', async () => {
  const cities = await readFile(new URL('../src/lib/cities.ts', import.meta.url), 'utf8');
  for (const [slug, color] of Object.entries(SOCIAL_CITY_COLORS)) {
    assert.match(cities, new RegExp(`slug: '${slug}',[\\s\\S]*?themeColor: '${color}'`));
  }
});
