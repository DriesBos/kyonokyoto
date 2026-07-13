import assert from 'node:assert/strict';
import test from 'node:test';

const { eventMediaDeliveryUrl, proxyYutakaImage, withEventMediaDelivery } =
  await import('../src/lib/mediaDelivery.ts');

const publisherImage =
  'https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/Nh_260523_at-YKG-RPG_008-1200x800.jpg';

test('Yutaka publisher images use the bounded display proxy', () => {
  const proxied = eventMediaDeliveryUrl(publisherImage);

  assert.equal(proxied, `/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`);
  assert.equal(
    eventMediaDeliveryUrl(`${publisherImage}?cache-bust=1#ignored`),
    `/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`,
  );
  assert.equal(
    eventMediaDeliveryUrl('http://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/work.jpg'),
    'http://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/work.jpg',
  );
  assert.equal(
    eventMediaDeliveryUrl('https://www.yutakakikutakegallery.com/other/work.jpg'),
    'https://www.yutakakikutakegallery.com/other/work.jpg',
  );
  assert.equal(
    eventMediaDeliveryUrl('https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/work.svg'),
    'https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/work.svg',
  );
  assert.equal(
    eventMediaDeliveryUrl(
      'https://www.yutakakikutakegallery.com.evil.test/ykgg/wp-content/uploads/work.jpg',
    ),
    'https://www.yutakakikutakegallery.com.evil.test/ykgg/wp-content/uploads/work.jpg',
  );
});

test('event media delivery rewrites existing primary and gallery image rows', () => {
  assert.deepEqual(
    withEventMediaDelivery({
      id: 'event-1',
      primary_image_url: publisherImage,
      image_urls: [publisherImage, 'https://images.example/art.jpg'],
    }),
    {
      id: 'event-1',
      primary_image_url: `/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`,
      image_urls: [
        `/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`,
        'https://images.example/art.jpg',
      ],
    },
  );
});

test('Yutaka proxy sends publisher Referer and returns durable CDN caching', async () => {
  let fetchCall;
  const response = await proxyYutakaImage(
    new Request(
      `https://kyo-no-kyoto.test/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`,
    ),
    async (input, init) => {
      fetchCall = { input, init };
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          'Content-Length': '4',
          'Content-Type': 'image/jpeg',
        },
      });
    },
  );

  assert.equal(fetchCall.input.href, publisherImage);
  assert.equal(fetchCall.init.redirect, 'manual');
  assert.ok(fetchCall.init.signal instanceof AbortSignal);
  assert.equal(fetchCall.init.headers.Referer, 'https://www.yutakakikutakegallery.com/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(
    response.headers.get('Netlify-CDN-Cache-Control'),
    'public, durable, max-age=604800, stale-while-revalidate=2592000',
  );
  assert.equal(response.headers.get('Netlify-Vary'), 'query=url');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test('Yutaka proxy rejects untrusted destinations before fetch', async () => {
  let calls = 0;
  const response = await proxyYutakaImage(
    new Request(
      `https://kyo-no-kyoto.test/api/yutaka-image?url=${encodeURIComponent('https://evil.test/ykgg/wp-content/uploads/work.jpg')}`,
    ),
    async () => {
      calls += 1;
      return new Response();
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls, 0);

  const cacheBustResponse = await proxyYutakaImage(
    new Request(
      `https://kyo-no-kyoto.test/api/yutaka-image?url=${encodeURIComponent(`${publisherImage}?cache-bust=1`)}`,
    ),
    async () => {
      calls += 1;
      return new Response();
    },
  );
  assert.equal(cacheBustResponse.status, 400);
  assert.equal(calls, 0);
});

test('Yutaka proxy rejects redirects, non-images, and oversized responses', async () => {
  const request = () =>
    new Request(
      `https://kyo-no-kyoto.test/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`,
    );

  const redirect = await proxyYutakaImage(
    request(),
    async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }),
  );
  assert.equal(redirect.status, 502);

  const nonImage = await proxyYutakaImage(
    request(),
    async () =>
      new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  assert.equal(nonImage.status, 502);

  const oversized = await proxyYutakaImage(
    request(),
    async () =>
      new Response(new Uint8Array([1]), {
        headers: {
          'Content-Length': String(12 * 1024 * 1024 + 1),
          'Content-Type': 'image/jpeg',
        },
      }),
  );
  assert.equal(oversized.status, 502);

  let cancelled = false;
  const oversizedChunk = new Uint8Array(7 * 1024 * 1024);
  const oversizedWithoutHeader = await proxyYutakaImage(
    request(),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversizedChunk);
            controller.enqueue(oversizedChunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'image/jpeg' } },
      ),
  );
  assert.equal(oversizedWithoutHeader.status, 502);
  assert.equal(cancelled, true);
});
