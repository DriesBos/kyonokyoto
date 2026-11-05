import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkLandingImages, landingCheckImageUrl } from '../src/landing-image-check.mjs';

const env = { ANTHROPIC_API_KEY: 'key', SITE_URL: 'https://example.test' };
const source = { slug: 'museum', landing_slider: true };
const alive = async () => false;
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

const tags = (clean, subject, busyness, score) => ({
  landing_ok: clean,
  image_subject: subject,
  image_busyness: busyness,
  image_score: score,
});

test('image check reuses stored tags and only classifies new first-three images', async () => {
  const classified = [];
  const result = await checkLandingImages(
    event,
    { slug: 'any-source' },
    {
      env,
      deadImageFn: alive,
      lookupVerdictFn: async (url) =>
        url.endsWith('a.jpg')
          ? { url, ...tags(false, 'graphic', 'busy', 2) }
          : url.endsWith('b.jpg')
            ? { url, landing_ok: true } // older pass/fail-only verdict: re-check it
            : null,
      classifyFn: async (url) => {
        classified.push(url);
        return url.endsWith('c.jpg')
          ? null
          : { clean: true, subject: 'artwork', busyness: 'calm', score: 14, reason: 'painting' };
      },
    },
  );

  assert.deepEqual(classified, ['https://img.test/b.jpg', 'https://img.test/c.jpg']);
  const { url: _url, width: _w, height: _h, ...first } = result.image_metadata[0];
  assert.deepEqual(first, { ...tags(false, 'graphic', 'busy', 2), image_confidence: null });
  assert.equal(result.image_metadata[1].image_score, 10, 'score is clamped to 1-10');
  assert.equal(result.image_metadata[1].image_subject, 'artwork');
  assert.equal(result.image_metadata[2].landing_ok, undefined);
  assert.equal(result.image_metadata[3].landing_ok, undefined, 'only the first three are checked');
});

test('image check keeps already tagged images and ignores unknown tag values', async () => {
  const tagged = {
    ...event,
    image_metadata: event.image_metadata.map((image, index) =>
      index === 0 ? { ...image, ...tags(true, 'installation', 'medium', 7) } : image,
    ),
  };
  const classified = [];
  const result = await checkLandingImages(tagged, source, {
    env,
    deadImageFn: alive,
    classifyFn: async (url) => {
      classified.push(url);
      return { clean: true, subject: 'cat', busyness: 'loud', score: 5, reason: '?' };
    },
  });
  assert.equal(classified.includes('https://img.test/a.jpg'), false);
  assert.equal(result.image_metadata[1].image_subject, null);
  assert.equal(result.image_metadata[1].image_busyness, null);
});

test('image check skips missing keys, IMAGE_CHECK=0 and failed calls', async () => {
  const never = async () => assert.fail('no call');
  assert.equal(await checkLandingImages(event, source, { env: {}, classifyFn: never }), event);
  assert.equal(
    await checkLandingImages(event, source, {
      env: { ...env, IMAGE_CHECK: '0' },
      classifyFn: never,
    }),
    event,
  );
  const failed = await checkLandingImages(event, source, {
    env,
    deadImageFn: alive,
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

test('rating examples: latest three +2 and -2, cached before the image to judge', async () => {
  const { selectRatingExamples, verdictContent } = await import('../src/landing-image-check.mjs');
  const examples = selectRatingExamples({
    'https://img.test/p1.jpg': 2,
    'https://img.test/n1.jpg': -2,
    'https://img.test/p2.jpg': 2,
    'https://img.test/k.jpg': 1,
    'https://img.test/p3.jpg': 2,
    'https://img.test/p4.jpg': 2,
  });
  assert.deepEqual(
    examples.map((example) => example.url.slice(-6)),
    ['p2.jpg', 'p3.jpg', 'p4.jpg', 'n1.jpg'],
  );

  const content = verdictContent(env, 'https://img.test/target.jpg', examples);
  const cachedIndex = content.findIndex((block) => block.cache_control);
  assert.equal(content.filter((block) => block.cache_control).length, 1);
  assert.equal(content.at(-1).type, 'image');
  assert.match(content.at(-1).source.url, /target\.jpg/);
  assert.equal(cachedIndex, content.length - 3, 'cache ends right before the target');
  assert.equal(content.filter((block) => block.type === 'image').length, 5);

  const plain = verdictContent(env, 'https://img.test/target.jpg', []);
  assert.equal(plain.length, 3);
  assert.ok(plain[0].cache_control);
});

test('verdict tags include confidence', async () => {
  const { imageTagsFromVerdict } = await import('../src/landing-image-check.mjs');
  assert.deepEqual(
    imageTagsFromVerdict({
      clean: false,
      subject: 'illustration',
      busyness: 'calm',
      score: 0,
      confidence: 'low',
    }),
    {
      landing_ok: false,
      image_subject: 'illustration',
      image_busyness: 'calm',
      image_score: 1,
      image_confidence: 'low',
    },
  );
});

test('dead images are dropped from the event before tagging', async () => {
  const result = await checkLandingImages(
    { ...event, primary_image_url: 'https://img.test/a.jpg' },
    source,
    {
      env,
      deadImageFn: async (_env, url) => url.endsWith('a.jpg'),
      classifyFn: async () => ({
        clean: true,
        subject: 'artwork',
        busyness: 'calm',
        score: 7,
        confidence: 'high',
        reason: 'ok',
      }),
    },
  );
  assert.deepEqual(result.image_urls, [
    'https://img.test/b.jpg',
    'https://img.test/c.jpg',
    'https://img.test/d.jpg',
  ]);
  assert.equal(result.primary_image_url, 'https://img.test/b.jpg');
  assert.equal(result.image_metadata.length, 3);
});

test('dead image check: 4xx is dead, 429/5xx/network are not', async () => {
  const { isDeadImage } = await import('../src/landing-image-check.mjs');
  const status = (code) => async () => ({ status: code });
  assert.equal(await isDeadImage(env, 'x', status(404)), true);
  assert.equal(await isDeadImage(env, 'x', status(400)), true);
  assert.equal(await isDeadImage(env, 'x', status(429)), false);
  assert.equal(await isDeadImage(env, 'x', status(502)), false);
  assert.equal(await isDeadImage(env, 'x', status(200)), false);
  assert.equal(
    await isDeadImage(env, 'x', async () => {
      throw new Error('offline');
    }),
    false,
  );
});
