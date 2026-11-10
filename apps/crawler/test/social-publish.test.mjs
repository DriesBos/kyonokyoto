import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  isLastWeek,
  layoutSocialPost,
  measureSocialPostText,
  socialGeometry,
  SOCIAL_SIZE,
} from '../../../packages/shared/social-post.mjs';
import { loadSocialFont, planQueue, renderSocialImage } from '../src/social-publish.mjs';

const both = { meta: { lines: 2 }, title: { lines: 2 } };

test('a landscape photo gets meta and title, box at the top of the post', () => {
  const result = layoutSocialPost({
    layout: 'inset',
    imageWidth: 1600,
    imageHeight: 1000,
    ...both,
  });
  assert.equal(result.ok, true);
  assert.equal(result.showMeta && result.showTitle, true);
  assert.equal(result.photo.width, socialGeometry('inset').contentWidth);
  assert.equal(result.photo.height, Math.round(result.photo.width * (1000 / 1600)));
  assert.equal(result.front.y, 48);
  assert.equal(
    layoutSocialPost({ layout: 'flush', imageWidth: 1600, imageHeight: 1000, ...both }).front.y,
    0,
  );
});

test('taller photos drop the meta, then show only the meta, then do not fit', () => {
  const at = (ratio) =>
    layoutSocialPost({ layout: 'inset', imageWidth: 1000, imageHeight: 1000 * ratio, ...both });
  const fits = [0.6, 0.85, 0.95, 1.05, 1.2].map((ratio) => {
    const result = at(ratio);
    return result.ok ? `${result.showMeta ? 'm' : ''}${result.showTitle ? 't' : ''}` : 'no';
  });
  // more text for wider photos, never more text for a taller one
  const order = ['mt', 't', 'm', 'no'];
  fits.reduce((previous, current) => {
    assert.ok(order.indexOf(current) >= order.indexOf(previous), fits.join(' '));
    return current;
  });
  assert.equal(fits[0], 'mt');
  assert.equal(fits.at(-1), 'no');
});

test('too wide or too tall images are skipped', () => {
  assert.equal(layoutSocialPost({ imageWidth: 3000, imageHeight: 1000, ...both }).ok, false);
  assert.equal(layoutSocialPost({ imageWidth: 1000, imageHeight: 1400, ...both }).ok, false);
  assert.equal(layoutSocialPost({ imageWidth: 0, imageHeight: 0, ...both }).ok, false);
});

test('the flush layout touches the post edges', () => {
  const result = layoutSocialPost({
    layout: 'flush',
    imageWidth: 1600,
    imageHeight: 1000,
    ...both,
  });
  assert.equal(result.front.x, 0);
  assert.equal(result.front.x + result.front.width + 96, SOCIAL_SIZE.width);
});

test('text wraps with the font, and Japanese titles are left out', async () => {
  const font = await loadSocialFont();
  const text = measureSocialPostText(font, {
    venue: 'Eikando Temple',
    date: '11 Nov – 6 Dec 2026',
    title: 'Eikan-do Temple Autumn Treasures Exhibition',
  });
  assert.deepEqual([text.meta.lines, text.title.lines], [2, 2]);
  assert.equal(text.metaPaths.length, 2);
  const japanese = measureSocialPostText(font, {
    venue: 'Eikando',
    date: 'Now',
    title: '永観堂 秋の寺宝展',
  });
  assert.equal(japanese.title, null);
});

test('renders a 1080 x 1350 JPEG with the photo inside the box', async () => {
  const photo = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#2050c0' },
  })
    .png()
    .toBuffer();
  const jpeg = await renderSocialImage({
    post: {
      city: 'kyoto',
      layout: 'inset',
      venue: 'Eikando Temple',
      event_date_text: 'Now',
      event_title: 'Autumn',
    },
    imageBytes: photo,
  });
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [1080, 1350]);
  const result = layoutSocialPost({
    imageWidth: 1600,
    imageHeight: 1000,
    meta: { lines: 2 },
    title: { lines: 1 },
  });
  const x = result.photo.x + 20;
  const y = result.photo.y + 20;
  const [r, , b] = data.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3);
  assert.ok(b > 150 && r < 80, 'photo pixel');
  await assert.rejects(
    renderSocialImage({
      post: { city: 'kyoto', event_title: 'x' },
      imageBytes: await sharp({
        create: { width: 3000, height: 500, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer(),
    }),
    /too wide/,
  );
});

test('LAST WEEK only for started events ending within 6 days', () => {
  const today = '2026-11-10';
  assert.equal(isLastWeek({ startDate: '2026-10-01', endDate: '2026-11-16', today }), true);
  assert.equal(isLastWeek({ startDate: '2026-10-01', endDate: '2026-11-17', today }), false);
  assert.equal(isLastWeek({ startDate: '2026-11-12', endDate: '2026-11-14', today }), false);
  assert.equal(isLastWeek({ startDate: null, endDate: '2026-11-09', today }), false);
  assert.equal(isLastWeek({ startDate: null, endDate: null, today }), false);
});

test('queue posts the soonest-ending event first and expires ended ones', () => {
  const posts = [
    { id: 'a', event_end_date: null, created_at: '2026-11-01' },
    { id: 'b', event_end_date: '2026-11-14', created_at: '2026-11-03' },
    { id: 'c', event_end_date: '2026-11-09', created_at: '2026-11-02' },
    { id: 'd', event_end_date: '2026-11-12', created_at: '2026-11-04' },
  ];
  const { expired, next } = planQueue(posts, '2026-11-10');
  assert.deepEqual(
    expired.map((post) => post.id),
    ['c'],
  );
  assert.equal(next.id, 'd');
});
