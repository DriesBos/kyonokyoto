import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSourcesConfig } from '../../../data/sources/source-config.mjs';
import {
  extractKarimokuCommonsEvent,
  getSourceTitleExclusionReason,
  recordSkippedEvent,
} from '../src/run-once.mjs';

test('exclude_title_patterns drops matching titles case-insensitively', () => {
  const source = {
    crawl_hints: {
      exclude_title_patterns: ['^【\\s*Kyoto/News\\s*】', '\\b(closed|notice)\\b'],
    },
  };

  assert.equal(
    getSourceTitleExclusionReason(
      source,
      '【Kyoto/News】Karimoku Commons Kyoto 臨時休館のお知らせ',
    ),
    'excluded title pattern: ^【\\s*Kyoto/News\\s*】',
  );
  assert.equal(
    getSourceTitleExclusionReason(source, 'NOTICE of Temporary Closure'),
    'excluded title pattern: \\b(closed|notice)\\b',
  );
  assert.equal(
    getSourceTitleExclusionReason(source, '【Kyoto/Exhibition】 展覧会「Art Rhizome KYOTO 2026」'),
    null,
  );
  assert.equal(getSourceTitleExclusionReason({}, 'Closed'), null);
  assert.equal(getSourceTitleExclusionReason(source, ''), null);
});

test('exclude_title_patterns ignores invalid regex instead of throwing', () => {
  const source = { crawl_hints: { exclude_title_patterns: ['([', 'holiday'] } };

  assert.equal(getSourceTitleExclusionReason(source, 'Exhibition'), null);
  assert.equal(
    getSourceTitleExclusionReason(source, 'Holiday hours'),
    'excluded title pattern: holiday',
  );
});

test('title exclusions count as other skips, not invalid titles', () => {
  const diagnostics = { skipped_invalid_title_count: 0, skipped_other_count: 0 };

  recordSkippedEvent(diagnostics, 'excluded title pattern: notice');

  assert.equal(diagnostics.skipped_invalid_title_count, 0);
  assert.equal(diagnostics.skipped_other_count, 1);
});

test('Karimoku Commons Kyoto keeps Kyoto exhibitions and events, drops notices and Tokyo posts', async () => {
  const sources = await loadSourcesConfig({ city: 'kyoto' });
  const karimoku = sources.find((source) => source.slug === 'karimoku-commons-kyoto');

  assert.ok(karimoku);
  assert.equal(karimoku.crawl_hints.render_mode, 'always');
  assert.ok(karimoku.crawl_hints.exclude_title_patterns.length > 0);

  const kept = [
    '【Kyoto/Exhibition】 展覧会「Art Rhizome KYOTO 2026 逆旅京都３」',
    '【Kyoto/Event】Karimoku Commons Kyoto Tour & Talk',
  ];
  const dropped = [
    '【Kyoto/News】Karimoku Commons Kyoto 臨時休館のお知らせ',
    '【Kyoto/News】Karimoku Commons Kyoto 開館時間変更のお知らせ',
    'Notice of Temporary Closure – Karimoku Commons Kyoto',
    '【Tokyo/Exhibition】 展覧会『御宿MAS』',
    '【Shop/News】 Karimoku Commons Shop 辰野しずか氏との協働作品の販売のお知らせ',
    'Karimoku Commons Kyoto 年末年始休業のお知らせ',
  ];

  for (const title of kept) {
    assert.equal(getSourceTitleExclusionReason(karimoku, title), null, title);
  }
  for (const title of dropped) {
    assert.match(getSourceTitleExclusionReason(karimoku, title) ?? '', /^excluded title/, title);
  }
});

test('Karimoku Commons Kyoto reads labelled dates, strips the category prefix and keeps the raw heading', async () => {
  const sources = await loadSourcesConfig({ city: 'kyoto' });
  const karimoku = sources.find((source) => source.slug === 'karimoku-commons-kyoto');
  const detailHtml = `
    <html><head><meta property="og:image" content="https://commons.karimoku.com/og-image.png"></head>
    <body><main class="page news-detail">
      <div class="news-header"><div class="date">9.30.2026,</div>
        <h1 class=" typesquare_option"> 【Kyoto/Event】Karimoku Commons Kyoto Tour &amp; Talk </h1></div>
      <div class="content-wrapper">
        <figure class="thumb"> <img src="https://images.microcms-assets.io/assets/abc/def/tour.jpg"> </figure>
        <div class="text-wrapper"><p>京都市が10月に実施する「木材利用促進月間」の関連企画として、Karimoku Commons Kyotoにて、ツアーとトークイベントを開催します。家具を通して、「木とつくる空間」を体感していただけるツアーです。<br><br>
          <strong>■ツアー</strong><br> 期間：2026年10月19日（月）– 23日（金）<br> 時間：14:00 – 15:00<br>
          日程：2026年10月23日（金）<br> 申込期間：2026年9月23日（水）– 10月22日（木）</p></div>
      </div>
    </main></body></html>`;

  const event = extractKarimokuCommonsEvent(
    detailHtml,
    karimoku,
    'https://commons.karimoku.com/news/detail/sbfq4ew25a/',
  );

  assert.equal(event.title, 'Karimoku Commons Kyoto Tour & Talk');
  assert.equal(event._raw_title, '【Kyoto/Event】Karimoku Commons Kyoto Tour & Talk');
  assert.equal(event.start_date, '2026-10-19');
  assert.equal(event.end_date, '2026-10-23');
  assert.equal(
    event.primary_image_url,
    'https://images.microcms-assets.io/assets/abc/def/tour.jpg',
  );
  assert.deepEqual(event.image_urls, ['https://images.microcms-assets.io/assets/abc/def/tour.jpg']);
});
