import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkLandingImages, landingCheckImageUrl } from '../src/landing-image-check.mjs';

const env = { ANTHROPIC_API_KEY: 'key', SITE_URL: 'https://example.test' };
const source = { slug: 'museum', landing_slider: true };
const event = {
  image_urls: [
    'https://img.test/a.jpg',
    'https://img.test/b.jpg',
    'https://img.test/c.jpg',
    'https://img.test/d.jpg',
  ],
  image_metadata: ['a', 'b', 'c', 'd'].map((name) => ({
    url: `https://img.test/${name}.jpg`,
    width: 2000,
    height: 1200,
  })),
};

test('landing check reuses stored verdicts and only classifies new first-three images', async () => {
  const classified = [];
  const result = await checkLandingImages(event, source, {
    env,
    lookupVerdictFn: async (url) => (url.endsWith('a.jpg') ? false : null),
    classifyFn: async (url) => {
      classified.push(url);
      return url.endsWith('c.jpg') ? null : { landing_ok: true, reason: 'gallery photo' };
    },
  });

  assert.deepEqual(classified, ['https://img.test/b.jpg', 'https://img.test/c.jpg']);
  assert.deepEqual(
    result.image_metadata.map((image) => image.landing_ok),
    [false, true, undefined, undefined],
  );
});

test('landing check skips non-landing sources, missing keys and failed calls', async () => {
  const never = async () => assert.fail('no call');
  assert.equal(await checkLandingImages(event, { slug: 'x' }, { env, classifyFn: never }), event);
  assert.equal(await checkLandingImages(event, source, { env: {}, classifyFn: never }), event);
  const failed = await checkLandingImages(event, source, {
    env,
    classifyFn: async () => {
      throw new Error('overloaded');
    },
  });
  assert.ok(failed.image_metadata.every((image) => image.landing_ok === undefined));
});

test('landing check sends a small CDN transform of the image', () => {
  const url = new URL(landingCheckImageUrl(env, 'https://img.test/a.jpg'));
  assert.equal(url.origin + url.pathname, 'https://example.test/.netlify/images');
  assert.equal(url.searchParams.get('url'), 'https://img.test/a.jpg');
  assert.equal(url.searchParams.get('w'), '1024');
});
