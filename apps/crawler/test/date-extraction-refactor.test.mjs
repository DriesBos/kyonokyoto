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

test('spaced dotted Artcourt range parses', () => {
  const raw = '2026. 7. 11 [sat] - 8.29 [sat]';

  assert.equal(normalizeHumanDateText(raw), '2026.7.11 - 8.29');
  assert.deepEqual(
    {
      startDate: parseGenericDateRange(raw).startDate,
      endDate: parseGenericDateRange(raw).endDate,
    },
    { startDate: '2026-07-11', endDate: '2026-08-29' },
  );
});

test('same-month ranges with only an end day parse in English and Japanese', () => {
  for (const [raw, startDate, endDate] of [
    ['Oct 3 – 31, 2026', '2026-10-03', '2026-10-31'],
    ['October 3 - 31 2026', '2026-10-03', '2026-10-31'],
    ['2026年11月7日(土)～21日(土)', '2026-11-07', '2026-11-21'],
  ]) {
    const parsed = parseGenericDateRange(raw);
    assert.deepEqual([parsed.startDate, parsed.endDate], [startDate, endDate], raw);
  }
});

test('galerie16 dotted ordinal ranges keep their start date', () => {
  const raw = 'Oct.13th ,Tue – Oct. 25th Sun, 2026';

  assert.equal(normalizeHumanDateText(raw), 'Oct 13 - Oct 25 2026');
  const parsed = parseGenericDateRange(raw);
  assert.deepEqual([parsed.startDate, parsed.endDate], ['2026-10-13', '2026-10-25']);
});

test('MoMAK omitted end year rolls across New Year', async () => {
  const source = (await loadSourcesConfig({ city: 'kyoto' })).find(
    (candidate) => candidate.slug === 'momak',
  );
  const event = eventExtractors.momak(
    `<section id="scTitle">
      <p>2026.10.24 sat. - 01.17 sun.</p>
      <p>Creating Japanese Jewellery: Personal Expression and Memory</p>
    </section>
    <div class="description"><p>Exhibition description.</p></div>`,
    source,
    'https://www.momak.go.jp/English/?p=106584',
  );

  assert.equal(event.start_date, '2026-10-24');
  assert.equal(event.end_date, '2027-01-17');
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

test('day-first numeric dates with a trailing year parse as ranges', () => {
  const cases = [
    ['10/10/2026 - 31/10/2026', '2026-10-10', '2026-10-31'],
    ['10.10.2026 – 31.10.2026', '2026-10-10', '2026-10-31'],
    ['08.03.2026-21.02.2027', '2026-03-08', '2027-02-21'],
    ['18.07-25.10.2026', '2026-07-18', '2026-10-25'],
    ['15.12 - 10.01.2027', '2026-12-15', '2027-01-10'],
    [
      'Date: 19.9 – 22.11.2026 (Closed on Mondays, except for legal holidays)',
      '2026-09-19',
      '2026-11-22',
    ],
    ['Date: 5-25/7/2025', '2025-07-05', '2025-07-25'],
    ['7/3 - 10/5, 2026', '2026-03-07', '2026-05-10'],
    ['Date | 日期: 27.9.2026 (Sun 日)', '2026-09-27', '2026-09-27'],
    ['Date: 16/2/2024', '2024-02-16', '2024-02-16'],
    // A second component over 12 marks US month-first text.
    ['12/20/2026 - 01/15/2027', '2026-12-20', '2027-01-15'],
    // JSON-LD startDate/endDate pairs keep their local dates.
    ['2024-01-15T00:00:00+08:00 - 2030-09-30T23:59:59+08:00', '2024-01-15', '2030-09-30'],
    // Year-first forms keep their existing parsers.
    ['2026/10/3 - 2026/11/5', '2026-10-03', '2026-11-05'],
  ];

  for (const [raw, startDate, endDate] of cases) {
    const parsed = parseGenericDateRange(raw);
    assert.deepEqual([parsed.startDate, parsed.endDate], [startDate, endDate], raw);
  }
});

test('Japanese ranges tolerate spaced 年月日, ー dashes and a bare end day', () => {
  const cases = [
    ['展示期間： 2026 年 7 月 28 日（火）～ 2027 年 1 月 24 日（日）', '2026-07-28', '2027-01-24'],
    [
      '令和8年 9月12日（土）〜12月13日（日） 【前期】9月12日（土）〜10月25日（日）',
      '2026-09-12',
      '2026-12-13',
    ],
    [
      '会期｜ 2026年5月19日(火)ー6月12日(金) 予約期間 6月16日(火)ー 6月19日(金)',
      '2026-05-19',
      '2026-06-12',
    ],
    ['2026年2月10日(火)-14(土)', '2026-02-10', '2026-02-14'],
    ['2026年9月12日 10:00-17:00', '2026-09-12', '2026-09-12'],
    ['種と根っこ ─ 都市の耕し方 2026年10月17日［土］─ 12月20日［日］', '2026-10-17', '2026-12-20'],
  ];

  for (const [raw, startDate, endDate] of cases) {
    const parsed = parseGenericDateRange(raw);
    assert.deepEqual([parsed.startDate, parsed.endDate], [startDate, endDate], raw);
  }
});

test('month-only dotted ranges span whole months without swallowing day dates', () => {
  const cases = [
    ['2025. 11 - 2027. 4 OAP Sculpture Path', '2025-11-01', '2027-04-30'],
    ['2027.12 – 2028.2', '2027-12-01', '2028-02-29'],
    ['2025.11.3 - 2025.12.4', '2025-11-03', '2025-12-04'],
    ['2026. 7. 11 [sat] - 8.29 [sat]', '2026-07-11', '2026-08-29'],
    ['2025.11.3', '2025-11-03', '2025-11-03'],
    ['2025.11 - 2025.13', null, null],
    ['v2025.11 build', null, null],
  ];

  for (const [raw, startDate, endDate] of cases) {
    const parsed = parseGenericDateRange(raw);
    assert.deepEqual([parsed.startDate, parsed.endDate], [startDate, endDate], raw);
  }

  const candidate = extractBestDateCandidate(
    '<main><h1>Sculpted Rhymes</h1><p>2025. 11 - 2027. 4 <span>OAP Sculpture Path</span></p></main>',
  );
  assert.equal(candidate.parserId, 'parseDottedMonthRange');
  assert.deepEqual(
    [candidate.parsed.startDate, candidate.parsed.endDate],
    ['2025-11-01', '2027-04-30'],
  );
});

test('open-start date text starts on the crawl date or stays unknown', () => {
  const html = (dateText) =>
    `<main><span class="label">DATE</span><div class="event-date"><p>${dateText}</p></div></main>`;
  const datesFor = (dateText, today) => {
    const parsed = extractBestDateCandidate(html(dateText), null, { today })?.parsed;
    return parsed ? [parsed.startDate, parsed.endDate] : null;
  };

  assert.deepEqual(datesFor('From Now &#8211; 28 February 2027 (Sunday)', '2026-10-25'), [
    '2026-10-25',
    '2027-02-28',
  ]);
  assert.deepEqual(datesFor('Now - 28 February 2027', '2026-10-25'), ['2026-10-25', '2027-02-28']);
  assert.deepEqual(datesFor('Until 5 December 2026', '2026-10-25'), ['2026-10-25', '2026-12-05']);
  assert.deepEqual(datesFor('～2027年2月28日（日）まで', '2026-10-25'), [
    '2026-10-25',
    '2027-02-28',
  ]);
  // Ended before the crawl, or no crawl date: the start is unknown, so no date.
  assert.equal(datesFor('From Now – 28 February 2026', '2026-10-25'), null);
  assert.equal(datesFor('From Now – 28 February 2027', null), null);
  // Plain single dates and full ranges are untouched.
  assert.deepEqual(datesFor('28 February 2027', '2026-10-25'), ['2027-02-28', '2027-02-28']);
  assert.deepEqual(datesFor('2026年10月1日～2027年2月28日まで', '2026-10-25'), [
    '2026-10-01',
    '2027-02-28',
  ]);
});
