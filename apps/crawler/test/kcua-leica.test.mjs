import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  detailUrlExtractors,
  eventExtractors,
  extractGenericDetailUrls,
} from '../src/run-once.mjs';

test('KCUA follows every current or upcoming exhibition card with an image', () => {
  const listingHtml = `
    <h3>Current Exhibitions</h3>
    <div class="exhCont">
      <a href="/en/archives/2026/15095/">
        <figure><img data-src="/uploads/current.jpg" alt=""></figure>
      </a>
    </div>
    <h3>Upcoming Exhibitions</h3>
    <div class="exhCont">
      <a href="/en/archives/2026/15100/">
        <figure><img src="/uploads/upcoming.jpg" alt=""></figure>
      </a>
    </div>
    <div class="exhCont">
      <a href="/en/archives/2026/15101/"><figure></figure></a>
    </div>
  `;

  assert.deepEqual(
    detailUrlExtractors.kcua(
      listingHtml,
      'https://gallery.kcua.ac.jp/en/exhibitions-en/',
    ),
    [
      'https://gallery.kcua.ac.jp/en/archives/2026/15095/',
      'https://gallery.kcua.ac.jp/en/archives/2026/15100/',
    ],
  );
});

test('Leica Gallery Kyoto follows only Kyoto events and parses localized date ranges', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'leica-gallery-kyoto');
  const listingHtml = `
    <a href="/en-US/event/leica-gallery-kyoto/kissomaru-shimamura">Kyoto</a>
    <a href="/en-US/event/leica-gallery-tokyo/yasuhiro-ogawa">Tokyo</a>
  `;
  const detailHtml = `
    <article class="node--type-event">
      <div class="headline h1">Kisshomaru Shimamura Exhibition: what matters</div>
      <div class="field--name-field-teaser-text">August 1, 2026 to October 1, 2026 | Leica Gallery Kyoto</div>
      <div class="text-field"><p>Exhibition description.</p></div>
      <div class="fancy-slider">
        <picture>
          <source srcset="/sites/default/files/kyoto.webp 1x">
          <img src="/sites/default/files/kyoto.jpg" alt="Kyoto exhibition">
        </picture>
        <picture>
          <img src="/sites/default/files/kyoto-2.jpg" alt="Kyoto exhibition">
        </picture>
      </div>
    </article>
  `;

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, source.start_urls[0], source, 8),
    ['https://leica-camera.com/en-US/event/leica-gallery-kyoto/kissomaru-shimamura'],
  );

  const event = eventExtractors[source.slug](
    detailHtml,
    source,
    'https://leica-camera.com/en-US/event/leica-gallery-kyoto/kissomaru-shimamura',
  );

  assert.equal(event.title, 'Kisshomaru Shimamura Exhibition: what matters');
  assert.equal(event.start_date, '2026-08-01');
  assert.equal(event.end_date, '2026-10-01');
  assert.equal(event.primary_image_url, 'https://leica-camera.com/sites/default/files/kyoto.jpg');
  assert.deepEqual(event.image_urls, [
    'https://leica-camera.com/sites/default/files/kyoto.jpg',
    'https://leica-camera.com/sites/default/files/kyoto-2.jpg',
  ]);

  const japaneseEvent = eventExtractors[source.slug](
    detailHtml
      .replace(
        'Kisshomaru Shimamura Exhibition: what matters',
        '嶌村吉祥丸 写真展 「what matters」',
      )
      .replace(
        'August 1, 2026 to October 1, 2026 | Leica Gallery Kyoto',
        '2026/8/1～2026/10/1まで、ライカギャラリー京都にて開催',
      ),
    source,
    'https://leica-camera.com/ja-JP/event/leica-gallery-kyoto/kissomaru-shimamura',
  );

  assert.equal(japaneseEvent.start_date, '2026-08-01');
  assert.equal(japaneseEvent.end_date, '2026-10-01');
});
