import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoriesWithMediums,
  checkEventMediums,
  mediumCheckKey,
  mediumsFromCategories,
} from '../src/event-medium-check.mjs';

const gallery = {
  slug: 'some-gallery',
  name: 'Some Gallery',
  source_kind: 'venue',
  taxonomy: { venue_category: ['gallery'], display_category: ['photography', 'painting'] },
};
const event = {
  title: 'Bronze figures',
  description: 'New sculpture in bronze.',
  categories: [
    'venue_category:gallery',
    'display_category:photography',
    'display_category:painting',
  ],
};
const env = { ANTHROPIC_API_KEY: 'test' };

test('checked mediums replace the venue mediums and leave a marker', async () => {
  const result = await checkEventMediums(event, gallery, {
    env,
    lookupFn: async () => null,
    classifyFn: async () => ['sculpture'],
  });
  const key = mediumCheckKey(gallery, event);
  assert.deepEqual(result.categories, [
    'venue_category:gallery',
    'display_category:sculpture',
    `medium_check:${key}`,
  ]);
  assert.deepEqual(mediumsFromCategories(result.categories), ['sculpture']);
});

test('a stored answer is reused without a model call; none found keeps the venue mediums', async () => {
  let calls = 0;
  const result = await checkEventMediums(event, gallery, {
    env,
    lookupFn: async () => [],
    classifyFn: async () => {
      calls += 1;
      return ['music'];
    },
  });
  assert.equal(calls, 0);
  assert.ok(result.categories.includes('display_category:photography'));
  assert.ok(result.categories.some((token) => token.startsWith('medium_check:')));
  assert.deepEqual(
    categoriesWithMediums(['display_category:a', 'medium_check:old'], ['design'], 'new'),
    ['display_category:design', 'medium_check:new'],
  );
});

test('no key, aggregators and non-art venues are left alone', async () => {
  const classifyFn = async () => {
    throw new Error('should not be called');
  };
  assert.equal(await checkEventMediums(event, gallery, { env: {}, classifyFn }), event);
  assert.equal(
    await checkEventMediums(event, { ...gallery, source_kind: 'aggregator' }, { env, classifyFn }),
    event,
  );
  assert.equal(
    await checkEventMediums(
      event,
      { ...gallery, taxonomy: { venue_category: ['historic-site'] } },
      { env, classifyFn },
    ),
    event,
  );
});
