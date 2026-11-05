import assert from 'node:assert/strict';
import { test } from 'node:test';

import { imagesToCheck, keepOldTagsOnFailure, withoutTags } from '../src/recheck-images.mjs';

const tagged = (url) => ({
  url,
  width: 100,
  height: 100,
  landing_ok: true,
  image_subject: 'artwork',
  image_busyness: 'calm',
  image_score: 8,
  image_confidence: 'high',
});

const row = {
  id: 1,
  image_urls: ['a', 'b', 'c', 'd'],
  image_metadata: ['a', 'b', 'c', 'd'].map(tagged),
};

test('recheck strips tags from the first three images only', () => {
  const stripped = withoutTags(row).image_metadata;
  assert.deepEqual(stripped[0], { url: 'a', width: 100, height: 100 });
  assert.equal(stripped[3].image_score, 8);
  assert.equal(imagesToCheck(row), 3);
});

test('a failed recheck keeps the old tags', () => {
  const rechecked = [
    { url: 'a', width: 100, height: 100 },
    { ...tagged('b'), image_score: 3 },
  ];
  const merged = keepOldTagsOnFailure(row.image_metadata, rechecked);
  assert.equal(merged[0].image_score, 8);
  assert.equal(merged[0].image_subject, 'artwork');
  assert.equal(merged[1].image_score, 3);
});
