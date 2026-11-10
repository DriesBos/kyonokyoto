import assert from 'node:assert/strict';
import test from 'node:test';
import { venuePathFor } from '../src/lib/venueRoutes.ts';

test('venue paths follow each city canonical locale shape and encode slugs', () => {
  assert.equal(
    venuePathFor('kyoto', 'ja', 'kyoto-art-center'),
    '/kyoto/ja/venues/kyoto-art-center/',
  );
  assert.equal(venuePathFor('kyoto', 'en', 'a b'), '/kyoto/en/venues/a%20b/');
  assert.equal(venuePathFor('hong-kong', 'en', 'm-plus'), '/hong-kong/venues/m-plus/');
});
