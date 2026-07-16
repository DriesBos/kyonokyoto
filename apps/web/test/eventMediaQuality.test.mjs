import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterEventMediaByMinimumHeight,
  MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX,
} from '../../../packages/shared/event-media.mjs';

test('event media rejects measured images below 540px and keeps unknown dimensions', () => {
  const low = 'https://example.test/low.jpg';
  const minimum = 'https://example.test/minimum.jpg';
  const unknown = 'https://example.test/unknown.jpg';
  const event = filterEventMediaByMinimumHeight({
    primary_image_url: low,
    image_urls: [low, minimum, unknown],
    image_metadata: [
      { url: low, width: 1200, height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX - 1 },
      { url: minimum, width: 1200, height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX },
    ],
  });

  assert.equal(MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX, 540);
  assert.equal(event.primary_image_url, minimum);
  assert.deepEqual(event.image_urls, [minimum, unknown]);
  assert.deepEqual(event.image_metadata, [
    { url: minimum, width: 1200, height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX },
  ]);
});
