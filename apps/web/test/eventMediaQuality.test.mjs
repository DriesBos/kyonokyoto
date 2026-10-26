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

test('event media shows one slot per image when a row stores size variants', () => {
  const group =
    'https://static-assets.artlogic.net/w_920,h_920,c_limit,f_auto,fl_lossy,q_auto/ws-artlogicwebsite0038/usr/images/exhibitions/group_images_override/96/culver.jpg';
  const main =
    'https://static-assets.artlogic.net/w_1200,h_630,c_fill,f_auto,fl_lossy,q_auto/ws-artlogicwebsite0038/usr/images/exhibitions/main_image_override/96/culver.jpg';
  const other = 'https://example.test/other.jpg';
  const event = filterEventMediaByMinimumHeight({
    primary_image_url: main,
    image_urls: [group, main, other],
    image_metadata: [],
  });

  assert.equal(event.primary_image_url, main);
  assert.deepEqual(event.image_urls, [main, other]);
});

test('event media drops stored CMS theme assets such as the Asia Society footer logo', () => {
  const hero =
    'https://asiasociety.org/sites/default/files/styles/400x286/public/2026-08/Ho%20Kan%20Updated%20KV_0.jpg';
  const logo =
    'https://asiasociety.org/themes/custom/asia/images/magazine/asia-society-magazine-footer.svg';
  const event = filterEventMediaByMinimumHeight({
    primary_image_url: logo,
    image_urls: [logo, hero],
    image_metadata: [],
  });

  assert.equal(event.primary_image_url, hero);
  assert.deepEqual(event.image_urls, [hero]);
});
