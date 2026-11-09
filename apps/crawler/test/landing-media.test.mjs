import assert from 'node:assert/strict';
import test from 'node:test';

import { attachLandingMedia, landingImageFor, landingObjectPath } from '../src/landing-media.mjs';

const env = { SUPABASE_URL: 'https://project.supabase.co' };
const source = { slug: 'museum', landing_slider: true };
const event = {
  image_urls: ['https://museum.test/a.jpg', 'https://museum.test/b.jpg'],
  image_metadata: [
    { url: 'https://museum.test/a.jpg', landing_ok: false },
    { url: 'https://museum.test/b.jpg', landing_ok: true },
  ],
};
const render = async () => ({ desktop: Buffer.from('d'), mobile: Buffer.from('m') });

test('picks the approved image, else the first one not rejected', () => {
  assert.equal(landingImageFor(event.image_metadata).url, 'https://museum.test/b.jpg');
  assert.equal(landingImageFor([{ url: 'x', landing_ok: false }, { url: 'y' }]).url, 'y');
  assert.equal(landingImageFor([{ url: 'x', landing_ok: false }]), null);
});

test('makes desktop and mobile files for the landing image only', async () => {
  const uploads = [];
  const result = await attachLandingMedia(event, source, {
    env,
    lookupFn: async () => null,
    downloadFn: async () => ({ bytes: Buffer.from('original') }),
    uploadFn: async (_env, path, file) => uploads.push({ path, type: file.contentType }),
    renderFn: render,
  });

  const desktopPath = landingObjectPath('museum', 'https://museum.test/b.jpg', 'desktop');
  assert.match(desktopPath, /^landing\/museum\/[0-9a-f]{32}-desktop\.webp$/);
  assert.deepEqual(
    uploads.map((upload) => upload.path),
    [desktopPath, landingObjectPath('museum', 'https://museum.test/b.jpg', 'mobile')],
  );
  assert.ok(uploads.every((upload) => upload.type === 'image/webp'));
  assert.equal(result.image_urls, event.image_urls);
  assert.equal(result.image_metadata[0].landing_desktop, undefined);
  assert.equal(
    result.image_metadata[1].landing_desktop,
    `https://project.supabase.co/storage/v1/object/public/event-media/${desktopPath}`,
  );
  assert.ok(result.image_metadata[1].landing_mobile.endsWith('-mobile.webp'));
});

test('reuses files from an earlier crawl without downloading', async () => {
  const result = await attachLandingMedia(event, source, {
    env,
    lookupFn: async () => ({ landing_desktop: 'D', landing_mobile: 'M' }),
    downloadFn: async () => assert.fail('downloaded'),
    uploadFn: async () => assert.fail('uploaded'),
    renderFn: render,
  });
  assert.equal(result.image_metadata[1].landing_desktop, 'D');
  assert.equal(result.image_metadata[1].landing_mobile, 'M');
});

test('other sources never get landing files and keep their original image URLs', async () => {
  const stale = {
    ...event,
    image_metadata: [
      { url: 'https://museum.test/a.jpg', landing_desktop: 'D', landing_mobile: 'M' },
    ],
  };
  const result = await attachLandingMedia(
    stale,
    { slug: 'gallery' },
    {
      env,
      downloadFn: async () => assert.fail('downloaded'),
    },
  );
  assert.deepEqual(result.image_metadata, [{ url: 'https://museum.test/a.jpg' }]);
});

test('a failed download leaves the event without landing files', async () => {
  const result = await attachLandingMedia(event, source, {
    env,
    lookupFn: async () => null,
    downloadFn: async () => {
      throw new Error('blocked');
    },
    uploadFn: async () => assert.fail('uploaded'),
    renderFn: render,
  });
  assert.ok(result.image_metadata.every((image) => image.landing_desktop === undefined));
});
