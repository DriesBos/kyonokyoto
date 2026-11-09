import assert from 'node:assert/strict';
import { test } from 'node:test';

import { purgeCityPageCache } from '../../../scripts/crawl-cycle-utils.mjs';

test('page cache purge targets the crawled city tag', async () => {
  const calls = [];
  const result = await purgeCityPageCache(
    { NETLIFY_SITE_ID: 'site-1', NETLIFY_PURGE_TOKEN: 'token-1' },
    'hong-kong',
    async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 202 });
    },
  );

  assert.deepEqual(result, { skipped: false });
  assert.equal(calls[0].url, 'https://api.netlify.com/api/v1/purge');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    site_id: 'site-1',
    cache_tags: ['city-hong-kong'],
  });
});

test('page cache purge is skipped without Netlify credentials and reports API failures', async () => {
  assert.deepEqual(await purgeCityPageCache({}, 'kyoto', () => assert.fail('no request')), {
    skipped: true,
  });
  await assert.rejects(
    purgeCityPageCache(
      { NETLIFY_SITE_ID: 's', NETLIFY_PURGE_TOKEN: 't' },
      'kyoto',
      async () => new Response('nope', { status: 401 }),
    ),
    /Netlify cache purge failed \(401\): nope/,
  );
});

test('landing image warm requests each listed landing file once', async () => {
  const { warmLandingImages } = await import('../../../scripts/crawl-cycle-utils.mjs');
  const calls = [];
  const result = await warmLandingImages(
    { SITE_URL: 'https://example.test/' },
    'kyoto',
    async (url) => {
      calls.push(url);
      if (url.endsWith('/api/landing-images/kyoto/')) {
        return Response.json({ urls: ['/.netlify/images?url=a', '/.netlify/images?url=b'] });
      }
      return new Response(url.endsWith('b') ? null : 'img', {
        status: url.endsWith('b') ? 500 : 200,
      });
    },
  );

  assert.deepEqual(result, { skipped: false, urls: 2, warmed: 1, failed: 1 });
  assert.deepEqual(calls, [
    'https://example.test/api/landing-images/kyoto/',
    'https://example.test/.netlify/images?url=a',
    'https://example.test/.netlify/images?url=b',
  ]);
  assert.deepEqual(await warmLandingImages({ LANDING_WARM: '0' }, 'kyoto', () => assert.fail()), {
    skipped: true,
  });
});
