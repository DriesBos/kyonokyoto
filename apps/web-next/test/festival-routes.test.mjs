import assert from 'node:assert/strict';
import test from 'node:test';
import { festivalPathFor } from '../src/lib/festivalRoutes.ts';

test('festival paths follow each city canonical locale shape and encode slugs', () => {
  assert.equal(
    festivalPathFor('kyoto', 'ja', 'art festival'),
    '/kyoto/ja/festivals/art%20festival/',
  );
  assert.equal(
    festivalPathFor('hong-kong', 'en', 'art festival'),
    '/hong-kong/festivals/art%20festival/',
  );
});
