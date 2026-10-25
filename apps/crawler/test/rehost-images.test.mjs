import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rehostEventImages } from '../src/run-once.mjs';

const env = { SUPABASE_URL: 'https://example.supabase.co' };
const source = { slug: 'abeno-harukas-art-museum', rehost_images: true };
const firstUrl = 'https://www.aham.jp/exhibition/future/wyeth/images/img_wyeth.jpg';
const secondUrl = 'https://www.aham.jp/exhibition/future/wyeth/images/img_wyeth_2.jpg';
const event = {
  title: 'Andrew Wyeth',
  primary_image_url: firstUrl,
  image_urls: [firstUrl, secondUrl],
  image_metadata: [{ url: firstUrl, width: 1200, height: 800 }],
};
const image = { bytes: Buffer.from('jpeg'), contentType: 'image/jpeg', extension: 'jpg' };

test('rehosts images for opted-in sources into the event-media bucket', async () => {
  const uploads = [];
  const result = await rehostEventImages(event, source, {
    env,
    downloadImageFn: async () => image,
    uploadFn: async (_env, objectPath, payload) => uploads.push({ objectPath, payload }),
  });

  assert.equal(uploads.length, 2);
  assert.match(uploads[0].objectPath, /^abeno-harukas-art-museum\/[0-9a-f]{32}\.jpg$/);
  assert.notEqual(uploads[0].objectPath, uploads[1].objectPath);
  const publicPrefix = `${env.SUPABASE_URL}/storage/v1/object/public/event-media/`;
  assert.equal(result.primary_image_url, `${publicPrefix}${uploads[0].objectPath}`);
  assert.deepEqual(
    result.image_urls,
    uploads.map(({ objectPath }) => `${publicPrefix}${objectPath}`),
  );
  assert.deepEqual(result.image_metadata, [
    { url: `${publicPrefix}${uploads[0].objectPath}`, width: 1200, height: 800 },
  ]);
});

test('keeps original URLs when a download or upload fails', async () => {
  const result = await rehostEventImages(event, source, {
    env,
    downloadImageFn: async (url) => (url === firstUrl ? null : image),
    uploadFn: async () => {
      throw new Error('storage down');
    },
  });

  assert.deepEqual(result, event);
});

test('leaves sources without rehost_images untouched', async () => {
  let called = false;
  const result = await rehostEventImages(
    event,
    { slug: 'other' },
    {
      env,
      downloadImageFn: async () => {
        called = true;
        return image;
      },
    },
  );

  assert.equal(result, event);
  assert.equal(called, false);
});
