import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSourcesConfig } from '../../../data/sources/source-config.mjs';
import { validateScheduleSegments } from '../../../packages/shared/event-schedule.mjs';
import {
  eventExtractors,
  extractBestDateCandidate,
  extractGenericEvent,
  hasVerifiedOpenEndedSchedule,
  normalizeHumanDateText,
  parseGenericDateRange,
} from '../src/run-once.mjs';

test('bracket weekdays normalize and Artizon English range parses', () => {
  const raw = 'June 23 [Tue] - October 4 [Sun], 2026';

  assert.equal(normalizeHumanDateText(raw), 'June 23 - October 4, 2026');
  assert.deepEqual(
    {
      startDate: parseGenericDateRange(raw).startDate,
      endDate: parseGenericDateRange(raw).endDate,
    },
    { startDate: '2026-06-23', endDate: '2026-10-04' },
  );
});

test('date candidates use typed page-matching JSON-LD and deterministic precedence', () => {
  const detailUrl = 'https://example.test/exhibitions/current';
  const html = `
    <script type="application/ld+json">
      {"@type":"Organization","startDate":"2031-01-01","endDate":"2031-02-01"}
    </script>
    <script type="application/ld+json">
      {"@type":"ExhibitionEvent","url":"https://example.test/exhibitions/other","startDate":"2032-01-01","endDate":"2032-02-01"}
    </script>
    <time class="published-date" datetime="2025-01-01">Published 2025-01-01</time>
    <main><div class="event-date">June 23 [Tue] - October 4 [Sun], 2026</div></main>
    <meta property="og:description" content="July 1 - July 2, 2027">
  `;

  const semantic = extractBestDateCandidate(html, detailUrl);
  assert.equal(semantic.origin, 'semantic_element');
  assert.equal(semantic.text, 'June 23 - October 4, 2026');
  assert.equal(semantic.parserId, 'parseBilingualDateRange');

  const matchingJsonLd = extractBestDateCandidate(
    html.replace(
      'https://example.test/exhibitions/other',
      'https://example.test/exhibitions/current',
    ),
    detailUrl,
  );
  assert.equal(matchingJsonLd.origin, 'json_ld');
  assert.equal(matchingJsonLd.text, '2032-01-01 - 2032-02-01');
  assert.ok(matchingJsonLd.score > semantic.score);

  assert.equal(
    extractBestDateCandidate(
      `<script type="application/ld+json">
        {"@type":"Organization","startDate":"2031-01-01","endDate":"2031-02-01"}
      </script>`,
      detailUrl,
    ),
    null,
  );
});

test('generic extraction stores selected date provenance directly', () => {
  const detailUrl = 'https://example.test/exhibitions/current';
  const event = extractGenericEvent(
    `<script type="application/ld+json">
      {"@type":"ExhibitionEvent","url":"${detailUrl}","name":"Current show","startDate":"2026-07-11","endDate":"2026-08-01"}
    </script><h1>Current show</h1>`,
    {
      name: 'Example Gallery',
      taxonomy: {
        venue_category: ['gallery'],
        display_category: [],
        event_category: ['exhibition'],
      },
    },
    detailUrl,
  );

  assert.equal(event.start_date, '2026-07-11');
  assert.equal(event._date_origin, 'json_ld');
  assert.equal(event._date_parser, 'parseBilingualDateRange');
});

test('Pola phases persist as two canonical segments with legacy range fields', async () => {
  const source = (await loadSourcesConfig({ city: 'tokyo' })).find(
    (candidate) => candidate.slug === 'pola-museum-annex',
  );
  const event = eventExtractors[source.slug](
    `<div class="article dataBox"><div class="inBox"><dl>
      <dt class="ttl">「束芋画 国宝」</dt>
      <dt class="day">前期：2026年7月17日(金)–8月9日(日)<br>後期：2026年8月11日(火・祝)–8月30日(日)</dt>
      <dd class="right"><img src="../images/exhibition/archive/2026/detail_202607/img01.jpg"></dd>
      <dd class="txt"><p>二つの会期に分けて展示します。</p></dd>
    </dl></div></div>`,
    source,
    source.base_url,
  );

  assert.equal(event.schedule_type, 'range');
  assert.equal(event.start_date, '2026-07-17');
  assert.equal(event.end_date, '2026-08-30');
  assert.deepEqual(event.schedule_segments, [
    { is_all_day: true, start_date: '2026-07-17', end_date: '2026-08-09' },
    { is_all_day: true, start_date: '2026-08-11', end_date: '2026-08-30' },
  ]);
  assert.equal(validateScheduleSegments(event).valid, true);
});

test('SCAI Park and Issey Kura keep verified open-ended canonical truth', async () => {
  const tokyoSources = await loadSourcesConfig({ city: 'tokyo' });
  const kyotoSources = await loadSourcesConfig({ city: 'kyoto' });
  const scai = tokyoSources.find((candidate) => candidate.slug === 'scai-park');
  const issey = kyotoSources.find((candidate) => candidate.slug === 'issey-miyake-kyoto-kura');

  const scaiEvent = eventExtractors[scai.slug](
    `<meta property="og:image" content="https://www.scaithebathhouse.com/show.jpg">
     <div class="title_info"><h1>Current Park show</h1><div class="duration">Thu. 9 April -</div></div>`,
    scai,
    'https://www.scaithebathhouse.com/en/exhibitions/2026/04/current/',
  );
  const isseyEvent = eventExtractors[issey.slug](
    `<h2>2026.07.01 | ISSEY MIYAKE KYOTO | KURA 「WALL WHITE HEM」</h2>
     <img src="https://cdn.shopify.com/KURA_2026jul01_01.jpg">`,
    issey,
    'https://www.isseymiyake.com/blogs/kyotokura/current',
  );

  for (const event of [scaiEvent, isseyEvent]) {
    assert.equal(event.schedule_type, 'occurrence_set');
    assert.equal(event.end_date, null);
    assert.equal(event.calendar_ends_at, null);
    assert.deepEqual(event.schedule_segments, [
      { is_all_day: true, start_date: event.start_date, end_date: null },
    ]);
    assert.equal(validateScheduleSegments(event).schedule_type, 'open_ended');
    assert.equal(hasVerifiedOpenEndedSchedule(event), true);
  }
});
