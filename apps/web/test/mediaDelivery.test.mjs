import assert from 'node:assert/strict';
import test from 'node:test';

const { eventMediaDeliveryUrl, eventMediaDeliverySrcSet, proxyYutakaImage } =
  await import('../src/lib/mediaDelivery.ts');

const publisherImage =
  'https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/Nh_260523_at-YKG-RPG_008-1200x800.jpg';
const galleryExitImage =
  'https://www.galleryexit.com/uploads/1/3/7/3/13731772/jul-show-artlogic-11.jpg';

const imageCdnUrl = (url, width = 640) =>
  `/.netlify/images?${new URLSearchParams({ url, w: String(width), q: '60' })}`;

test('event images use Netlify Image CDN at quality 60', () => {
  assert.equal(eventMediaDeliveryUrl(galleryExitImage), imageCdnUrl(galleryExitImage));
  assert.equal(
    eventMediaDeliveryUrl(`${galleryExitImage}?cache-bust=1#ignored`),
    imageCdnUrl(`${galleryExitImage}?cache-bust=1`),
  );
  assert.equal(
    eventMediaDeliverySrcSet(galleryExitImage),
    [320, 640, 960].map((width) => `${imageCdnUrl(galleryExitImage, width)} ${width}w`).join(', '),
  );
});

test('Yutaka publisher images use the bounded display proxy', () => {
  const proxied = eventMediaDeliveryUrl(publisherImage);

  const proxiedSource = `/api/yutaka-image?url=${encodeURIComponent(publisherImage)}`;
  assert.equal(proxied, imageCdnUrl(proxiedSource));
  assert.equal(
    eventMediaDeliveryUrl(`${publisherImage}?cache-bust=1#ignored`),
    imageCdnUrl(proxiedSource),
  );
  assert.equal(eventMediaDeliveryUrl('data:image/png;base64,AAAA'), null);
  assert.equal(eventMediaDeliveryUrl('javascript:alert(1)'), null);
  assert.equal(eventMediaDeliveryUrl('https://user:pass@example.test/image.jpg'), null);
  assert.equal(eventMediaDeliveryUrl('https://example.test:8443/image.jpg'), null);
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
