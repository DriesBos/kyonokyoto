import assert from 'node:assert/strict';
import test from 'node:test';

const { imageRank, rankImages } = await import('../src/lib/imageRanking.ts');

test('ranking puts a calm clean artwork first and flyers last', () => {
  const images = [
    { url: 'flyer', landingOk: false, subject: 'graphic', busyness: 'busy', score: 3 },
    { url: 'interior', landingOk: true, subject: 'interior', busyness: 'medium', score: 6 },
    { url: 'artwork', landingOk: true, subject: 'artwork', busyness: 'calm', score: 8 },
    { url: 'install', landingOk: true, subject: 'installation', busyness: 'busy', score: 9 },
  ];
  assert.deepEqual(
    rankImages(images).map((image) => image.url),
    ['artwork', 'install', 'interior', 'flyer'],
  );
});

test('untagged images keep source order and sit between good and bad ones', () => {
  const images = [
    { url: 'a' },
    { url: 'b', landingOk: null },
    { url: 'poster', landingOk: false, subject: 'graphic' },
    { url: 'art', landingOk: true, subject: 'artwork', busyness: 'calm', score: 5 },
  ];
  assert.deepEqual(
    rankImages(images).map((image) => image.url),
    ['art', 'a', 'b', 'poster'],
  );
  assert.equal(imageRank({}), 0);
});

test('custom weights change the order without new tags', () => {
  const images = [
    { url: 'art', subject: 'artwork' },
    { url: 'room', subject: 'interior' },
  ];
  const weights = {
    notClean: -10,
    subject: {
      artwork: 0,
      illustration: 0,
      installation: 0,
      event: 0,
      interior: 5,
      exterior: 0,
      people: 0,
      graphic: 0,
    },
    busyness: { calm: 0, medium: 0, busy: 0 },
    maxScoreBonus: 0,
  };
  assert.deepEqual(
    rankImages(images, weights).map((image) => image.url),
    ['room', 'art'],
  );
});

test('manual ratings beat the AI tags; -2 is left out', async () => {
  const { aiImageRank, isLeftOut } = await import('../src/lib/imageRanking.ts');
  const images = [
    { url: 'art', landingOk: true, subject: 'artwork', busyness: 'calm', score: 10 },
    { url: 'poster', landingOk: false, subject: 'graphic', rating: 2 },
    { url: 'room', landingOk: true, subject: 'interior', rating: -1 },
  ];
  assert.deepEqual(
    rankImages(images).map((image) => image.url),
    ['poster', 'art', 'room'],
  );
  assert.ok(aiImageRank(images[1]) < 0, 'AI rank ignores the rating');
  assert.equal(isLeftOut({ rating: -2 }), true);
  assert.equal(isLeftOut({ rating: -1 }), false);
});
