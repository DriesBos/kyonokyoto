import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTempleSourceAdapters, parseTemplePeriods } from '../src/temple-sources.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/temple-sources/${name}.html`, import.meta.url), 'utf8');
const adapters = createTempleSourceAdapters();
const kobunkaUrl = 'https://www.kobunka.com/map/';
const shunjuUrl = 'https://kyotoshunju.com/temple/daitokuji-jukoin2026/';
const travelUrl =
  'https://ja.kyoto.travel/event/search.php?category_id=5&display_type=list&page=1&search_flg=1';
const prefectureUrl = 'https://www.kyoto-kankou.or.jp/event';
const extract = (slug, name, url) => adapters.eventExtractors[slug](fixture(name), { slug }, url);
const activeOn = (event, date) =>
  event.schedule_segments.some((p) => date >= p.start_date && date <= p.end_date);

test('Kobunka real inline listing produces 32 distinct stable identities and isolated facts', () => {
  const html = fixture('kobunka');
  const urls = adapters.detailUrlExtractors['kyoto-kobunka'](html, kobunkaUrl);
  assert.equal(urls.length, 32);
  assert.equal(new Set(urls).size, 32);
  const event = extract('kyoto-kobunka', 'kobunka', urls[0]);
  assert.equal(event.venue_name, '上賀茂神社');
  assert.equal(event.start_date, '2026-10-31');
  assert.equal(event.end_date, '2026-12-06');
  assert.equal(event._source_entry_id, '1');
  assert.match(event.external_id, /^kobunka-2026_a-/);
  assert.equal(event.address_text, null);
  assert.deepEqual(event.image_urls, []);
  assert.equal(event.lat, null);
  assert.equal(activeOn(event, '2026-11-17'), false);
  assert.equal(activeOn(event, '2026-11-27'), false);
  assert.equal(activeOn(event, '2026-11-18'), true);
  assert.match(event.date_text, /11\/12.*午前9時～正午/);
  assert.ok(event.categories.includes('venue_category:shrine'));
  assert.ok(event._temple_warnings.includes('unresolved-prefecture'));
  const renumbered = html.replace('<span class="no">1</span>', '<span class="no">999</span>');
  assert.equal(adapters.detailUrlExtractors['kyoto-kobunka'](renumbered, kobunkaUrl)[0], urls[0]);
});

test('Shunju real detail keeps event venue, closure dates, hours and images', () => {
  const event = extract('kyoto-shunju', 'shunju-detail', shunjuUrl);
  assert.equal(event.venue_name, '大徳寺 聚光院');
  assert.equal(event.address_text, '京都市北区紫野大徳寺町58');
  assert.equal(event.start_date, '2026-09-18');
  assert.equal(event.end_date, '2026-12-06');
  assert.equal(activeOn(event, '2026-10-17'), false);
  assert.equal(activeOn(event, '2026-11-28'), false);
  assert.equal(activeOn(event, '2026-11-30'), true);
  assert.match(event.start_time_text, /9：30〜15：30/);
  assert.ok(event.image_urls.every((v) => /\/uploads\//.test(v)));
  assert.equal(event._location_prefecture, 'Kyoto');
  assert.doesNotMatch(event.address_text, /二条通東洞院/);
  assert.equal(
    adapters.detailUrlExtractors['kyoto-shunju'](fixture('shunju'), shunjuUrl).length,
    5,
  );
});

test('split periods, explicit individual days, cross-year dates and invalid dates stay precise', () => {
  assert.deepEqual(
    parseTemplePeriods('2026年9月5日～29日・10月3日～12月15日').map((v) => [
      v.start_date,
      v.end_date,
    ]),
    [
      ['2026-09-05', '2026-09-29'],
      ['2026-10-03', '2026-12-15'],
    ],
  );
  assert.equal(parseTemplePeriods('11月14日(土)、15日(日)、21日(土)', 2026).length, 3);
  assert.equal(parseTemplePeriods('2026年12月28日～1月3日')[0].end_date, '2027-01-03');
  assert.deepEqual(parseTemplePeriods('11月1日～20日'), []);
  assert.deepEqual(parseTemplePeriods('2026年2月30日'), []);
});

test('Navi real structured event resolves actual temple, address and trustworthy map coordinates', () => {
  const event = extract(
    'kyoto-tourism-openings',
    'travel-detail',
    'https://ja.kyoto.travel/event/single.php?event_id=10472',
  );
  assert.equal(event.title, '【秋の特別公開】宝鏡寺〈秋の人形展〉');
  assert.equal(event.venue_name, '宝鏡寺');
  assert.equal(event.address_text, '上京区寺之内通堀川東入百々町547');
  assert.equal(event.start_date, '2026-11-01');
  assert.equal(event.end_date, '2026-11-20');
  assert.equal(event.lat, 35.034083);
  assert.equal(event.lng, 135.752661);
  assert.equal(event.image_urls.length, 7);
  assert.equal(event._temple_relevant, true);
  assert.ok(event.categories.includes('event_category:exhibition'));
  const urls = adapters.detailUrlExtractors['kyoto-tourism-openings'](fixture('travel'), travelUrl);
  assert.ok(urls.includes('https://ja.kyoto.travel/event/single.php?event_id=10472'));
  assert.ok(urls.length < 20);
});

test('pagination handles Navi JavaScript data values and prefecture normal links, bounded and filter-preserving', () => {
  const travel = adapters.listingPaginationUrls(fixture('travel'), travelUrl, {
    slug: 'kyoto-tourism-openings',
  });
  assert.equal(travel.length, 5);
  assert.ok(travel.some((v) => v.includes('page=9')));
  assert.ok(travel.every((v) => v.includes('category_id=5') && v.includes('display_type=list')));
  const pref = adapters.listingPaginationUrls(fixture('pref'), prefectureUrl, {
    slug: 'kyoto-prefecture-openings',
    crawl_hints: { max_listing_pages: 12 },
  });
  assert.ok(pref.includes(`${prefectureUrl}?page=2`));
  assert.ok(pref.includes(`${prefectureUrl}?page=29`)); // Caller must detect configured-cap truncation.
});

test('prefecture detail never borrows nearby venue photos or invents year; unrelated fishing excluded', () => {
  const event = extract('kyoto-prefecture-openings', 'pref-detail', `${prefectureUrl}/836`);
  assert.equal(event.venue_name, '真如堂（真正極楽寺）');
  assert.equal(event.address_text, '〒606-8414 京都府京都市左京区浄土寺真如町82');
  assert.equal(event.start_date, null);
  assert.ok(event._temple_warnings.includes('missing-explicit-event-year'));
  assert.deepEqual(event.image_urls, []);
  assert.equal(event.lat, 35.021935);
  const unrelated = extract('kyoto-prefecture-openings', 'pref-opening', `${prefectureUrl}/2045`);
  assert.equal(unrelated._temple_relevant, false);
});

test('ambiguous recurring restricted opening days require review and out-of-prefecture address stays unresolved', () => {
  const html = fixture('shunju-detail')
    .replace('2026年9月18日(金)〜12月6日(日)', '2026年10月10日～12月6日期間の内、金・土・日・祝日')
    .replace('京都市北区紫野大徳寺町58', '滋賀県大津市坂本本町4220');
  const event = adapters.eventExtractors['kyoto-shunju'](html, { slug: 'kyoto-shunju' }, shunjuUrl);
  assert.equal(event.start_date, null);
  assert.equal(event._location_prefecture, null);
  assert.ok(event._temple_warnings.includes('restricted-opening-days-require-review'));
});

test('structured date bounds cannot erase weekday restrictions or closure exceptions', () => {
  for (const suffix of ['上記期間中の金・土・日に公開', '※11月10日は拝観休止']) {
    const html = fixture('travel-detail').replace(
      '<td>2026年11月1日（日）～20日（金）</td>',
      `<td>2026年11月1日（日）～20日（金） ${suffix}</td>`,
    );
    const event = adapters.eventExtractors['kyoto-tourism-openings'](
      html,
      { slug: 'kyoto-tourism-openings' },
      'https://ja.kyoto.travel/event/single.php?event_id=10472',
    );
    assert.equal(event.start_date, null);
    assert.deepEqual(event.schedule_segments, []);
    assert.ok(event.date_text.includes(suffix));
    assert.ok(event._temple_warnings.some((value) => value.endsWith('require-review')));
  }
});

test('source facts replace generic empty-page validity and publisher location defaults', () => {
  const injected = createTempleSourceAdapters({
    extractGenericEvent: () => ({
      _title_valid: false,
      _description_valid: false,
      address_text: 'Publisher office',
      lat: 99,
      lng: 99,
    }),
  });
  const event = injected.eventExtractors['kyoto-shunju'](
    fixture('shunju-detail'),
    { slug: 'kyoto-shunju' },
    shunjuUrl,
  );
  assert.equal(event._title_valid, true);
  assert.equal(event._description_valid, true);
  assert.equal(event.address_text, '京都市北区紫野大徳寺町58');
  assert.equal(event.lat, null);
});

test('prefecture year can come from matching event listing card, never neighboring cards', () => {
  const slug = 'kyoto-prefecture-openings';
  const html = fixture('pref-detail');
  const url = `${prefectureUrl}/836`;
  const event = adapters.eventExtractors[slug](html, { slug }, url, {
    listingPages: [
      {
        url: prefectureUrl,
        html: '<article><a href="/event/836"><h1>2026年 お十夜</h1></a></article><article><a href="/event/999"><h1>2025年 Other</h1></a></article>',
      },
    ],
  });
  assert.equal(event.start_date, '2026-11-05');
  assert.equal(event.end_date, '2026-11-15');
});

test('real listing cards prefilter broad prefecture and mixed Navi results before detail fetch', () => {
  const pref = adapters.detailUrlExtractors['kyoto-prefecture-openings'](
    fixture('pref'),
    prefectureUrl,
  );
  assert.equal(pref.length, 5); // 24 broad cards -> five opening candidates.
  assert.ok(pref.includes(`${prefectureUrl}/999`)); // 青蓮院夜の特別拝観
  assert.ok(pref.includes(`${prefectureUrl}/1770`)); // 三重塔（国宝）開扉
  assert.ok(!pref.includes(`${prefectureUrl}/836`)); // Generic 念仏会 festival.
  assert.ok(!pref.includes(`${prefectureUrl}/2045`)); // Fishing.
  const navi = adapters.detailUrlExtractors['kyoto-tourism-openings'](fixture('travel'), travelUrl);
  assert.equal(navi.length, 7); // 20 category-tagged cards -> seven explicit opening/exhibition candidates.
  assert.ok(!navi.includes('https://ja.kyoto.travel/event/single.php?event_id=13025')); // Generic foliage lighting.
});

test('actual review pipeline preserves validity flags and reports honest fixture baseline', async () => {
  const { extractEventForReview } = await import('../src/run-once.mjs');
  const sources = JSON.parse(
    readFileSync(new URL('../../../data/sources/kyoto-sources.json', import.meta.url), 'utf8'),
  ).sources;
  const cases = [
    [
      'kyoto-kobunka',
      'kobunka',
      adapters.detailUrlExtractors['kyoto-kobunka'](fixture('kobunka'), kobunkaUrl),
    ],
    ['kyoto-shunju', 'shunju-detail', [shunjuUrl]],
    [
      'kyoto-tourism-openings',
      'travel-detail',
      ['https://ja.kyoto.travel/event/single.php?event_id=10472'],
    ],
    ['kyoto-prefecture-openings', 'pref-special-opening', [`${prefectureUrl}/999`]],
  ];
  const baseline = {};
  for (const [slug, file, urls] of cases) {
    const results = urls.map((url) =>
      extractEventForReview(
        { html: fixture(file), url },
        sources.find((v) => v.slug === slug),
      ),
    );
    baseline[slug] = {
      total: results.length,
      valid: results.filter((r) => !r.invalidFields.length).length,
    };
    assert.ok(
      results.every((r) => r.event._title_valid === true && r.event._description_valid === true),
      `${slug}: source facts must survive generic normalization`,
    );
  }
  assert.deepEqual(baseline, {
    'kyoto-kobunka': { total: 32, valid: 0 },
    'kyoto-shunju': { total: 1, valid: 1 },
    'kyoto-tourism-openings': { total: 1, valid: 1 },
    'kyoto-prefecture-openings': { total: 1, valid: 0 },
  });
});
