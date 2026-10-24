import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSourcesConfig } from '../../../data/sources/source-config.mjs';
import {
  eventExtractors,
  extractGenericDetailUrls,
  getInvalidRequiredEventFields,
} from '../src/run-once.mjs';

const source = (await loadSourcesConfig({ city: 'kyoto' })).find(
  (entry) => entry.slug === 'the-terminal-kyoto',
);
const listingUrl = 'https://kyoto.theterminal.jp/events/';
const detailUrl = `${listingUrl}home-%E5%AE%B6%E5%BA%AD/`;
const description =
  'Artists explore home and belonging through textiles, handmade paper, and sculpture in a historic Kyoto townhouse.';
const listingHtml = `
  <a href="/event_type/exhibition/">Exhibitions</a>
  <div class="monthly_wrap"><ul class="entry_wrap">
    <li class="entry"><dl><dt><a href="/events/other/">Other show</a></dt>
      <dd>Unrelated event copy must not reach the HOME exhibition.</dd></dl></li>
    <li class="entry"><dl><dt><a href="/events/home-%e5%ae%b6%e5%ba%ad/">HOME 家庭</a></dt>
      <dd>${description}</dd></dl>
      <a href="/events/home-%e5%ae%b6%e5%ba%ad/#report">Report</a></li>
  </ul></div>`;
const detailHtml = `
  <h1>展示・イベント</h1><section class="sec_entry">
    <h2 class="main_title">HOME 家庭</h2>
    <table class="info_table"><tbody>
      <tr><th>作家・主催者</th><td>Artist born 1980年1月1日</td></tr>
      <tr><th>期間</th><td>2026年10月10日（土）～10月23日（金）</td></tr>
      <tr><th>時間</th><td>9:30～18:00</td></tr>
    </tbody></table>
    <div class="info_bottom"><p><img src="/wp-content/uploads/home.jpg" width="254" height="361"></p></div>
    <div class="paging"><img src="/arrow.png"></div>
  </section>`;
const extract = (html = detailHtml) =>
  eventExtractors[source.slug](html, source, detailUrl, {
    listingPages: [{ html: listingHtml, url: listingUrl }],
  });

test('Terminal Kyoto uses requested event feed and concrete listing links', () => {
  assert.equal(source.base_url, listingUrl);
  assert.deepEqual(source.start_urls, [listingUrl]);
  assert.deepEqual(source.locales.ja.start_urls, [listingUrl]);
  assert.deepEqual(source.event_page_patterns, ['/events/']);
  assert.deepEqual(extractGenericDetailUrls(listingHtml, listingUrl, source), [
    `${listingUrl}other/`,
    `${listingUrl}home-%e5%ae%b6%e5%ba%ad/`,
  ]);
});

test('Terminal Kyoto combines matching listing prose with detail period and media', () => {
  const event = extract();
  assert.equal(event.title, 'HOME 家庭');
  assert.equal(event.description, description);
  assert.equal(event.start_date, '2026-10-10');
  assert.equal(event.end_date, '2026-10-23');
  assert.deepEqual(event.image_urls, ['https://kyoto.theterminal.jp/wp-content/uploads/home.jpg']);
  assert.deepEqual(getInvalidRequiredEventFields(event, source), []);
});

test('Terminal Kyoto rejects missing period instead of choosing artist biography dates', () => {
  const event = extract(detailHtml.replace(/<tr><th>期間<\/th>[\s\S]*?<\/tr>/, ''));
  assert.equal(event.start_date, null);
  assert.equal(event.end_date, null);
  assert.ok(getInvalidRequiredEventFields(event, source).includes('date'));
});
