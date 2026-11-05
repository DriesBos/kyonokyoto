import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createTemplePlaceEnricher } from '../src/temple-place-loader.mjs';
import {
  prefecturePlaceSearchUrl,
  findPrefecturePlaceUrl,
  extractPrefecturePlaceFacts,
} from '../src/prefecture-places.mjs';
import {
  buildTemplePlaceIndex,
  extractTemplePlaceFacts,
  findTemplePlaceUrl,
} from '../src/temple-places.mjs';

const listing = (name, id, category = 7) =>
  `<h3 class="tit"><a href="/tourism/single01.php?category_id=${category}&amp;tourism_id=${id}">${name}</a></h3>`;

const detailUrl = 'https://ja.kyoto.travel/tourism/single01.php?category_id=7&tourism_id=253';
const detail = `<main><article id="detail">
  <h1>賀茂別雷神社（上賀茂神社）</h1>
  <div class="detailGallery"><div class="item"><img src="/resource/tourism/253-1.jpg" alt="楼門"></div>
  <div class="item"><img src="/resource/tourism/253-3.jpg" alt="特別参拝"></div></div>
  <section><h2>基本情報</h2><table>
    <tr><th>正式名称</th><td>賀茂別雷神社（上賀茂神社）</td></tr>
    <tr><th>通称名称</th><td>上賀茂神社（かみがもじんじゃ）</td></tr>
    <tr><th>住所・所在地</th><td>京都市北区上賀茂本山339</td></tr>
  </table></section>
</article><section class="related"><img src="/resource/tourism/999-1.jpg"></section></main>`;

test('directory index maps formal and parenthetical common names to exact detail URLs', () => {
  const index = buildTemplePlaceIndex([
    {
      url: 'https://ja.kyoto.travel/tourism/search.php?category_id=7',
      html: listing('賀茂別雷神社（上賀茂神社）', 253) + listing('賀茂御祖神社（下鴨神社）', 498),
    },
  ]);
  assert.equal(
    findTemplePlaceUrl(index, '上賀茂神社'),
    'https://ja.kyoto.travel/tourism/single01.php?category_id=7&tourism_id=253',
  );
  assert.equal(
    findTemplePlaceUrl(index, '賀茂御祖神社'),
    'https://ja.kyoto.travel/tourism/single01.php?category_id=7&tourism_id=498',
  );
  assert.equal(findTemplePlaceUrl(index, '東寺 講堂・五重塔'), null);
});

test('duplicate exact aliases stay unresolved', () => {
  const index = buildTemplePlaceIndex([
    {
      url: 'https://ja.kyoto.travel/tourism/search.php?category_id=7',
      html: listing('上賀茂神社', 253) + listing('上賀茂神社', 254),
    },
  ]);
  assert.equal(findTemplePlaceUrl(index, '上賀茂神社'), null);
});

test('place facts require exact venue alias and isolate gallery/address from related cards', () => {
  assert.deepEqual(extractTemplePlaceFacts(detail, detailUrl, '上賀茂神社'), {
    venue_name: '上賀茂神社',
    address_text: '京都市北区上賀茂本山339',
    lat: null,
    lng: null,
    image_urls: [
      'https://ja.kyoto.travel/resource/tourism/253-1.jpg',
      'https://ja.kyoto.travel/resource/tourism/253-3.jpg',
    ],
    source_url: detailUrl,
  });
  assert.equal(extractTemplePlaceFacts(detail, detailUrl, '上賀茂神社 三門'), null);
});

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/temple-sources/${name}.html`, import.meta.url), 'utf8');

test('real city place supplies own photos, address and coordinates', () => {
  const facts = extractTemplePlaceFacts(fixture('place-kamigamo'), detailUrl, '上賀茂神社');
  assert.equal(facts.address_text, '京都市北区上賀茂本山339');
  assert.equal(facts.lat, 35.060346);
  assert.equal(facts.lng, 135.752711);
  assert.equal(facts.image_urls.length, 3);
  assert.ok(facts.image_urls.every((url) => /\/253-/.test(url)));
});

test('prefecture search selects exact entity, not its museum or another related result', () => {
  const html =
    '<article class="spotArticle"><a href="/info_search/883"><h1 class="spotArticle__title">浦嶋神社</h1></a></article><article class="spotArticle"><a href="/info_search/3692"><h1 class="spotArticle__title">浦嶋神社・宝物資料館</h1></a></article>';
  assert.equal(
    findPrefecturePlaceUrl(html, '浦嶋神社'),
    'https://www.kyoto-kankou.or.jp/info_search/883',
  );
  assert.equal(findPrefecturePlaceUrl(html, '浦島神社'), null);
  assert.equal(
    new URL(prefecturePlaceSearchUrl('浦嶋神社')).searchParams.get('q[name_or_description_cont]'),
    '浦嶋神社',
  );
  assert.equal(findPrefecturePlaceUrl(html + html.replace('/883', '/884'), '浦嶋神社'), null);
});

test('real northern place extracts hero and full address without ruby or nearby photos', () => {
  const facts = extractPrefecturePlaceFacts(
    fixture('place-pref-urashima'),
    'https://www.kyoto-kankou.or.jp/info_search/883',
    '浦嶋神社',
  );
  assert.match(facts.address_text, /京都府与謝郡伊根町本庄浜191/);
  assert.equal(facts.image_urls.length, 2);
  assert.equal(
    extractPrefecturePlaceFacts(
      fixture('place-pref-urashima'),
      'https://www.kyoto-kankou.or.jp/info_search/883',
      '浦嶋神社・宝物資料館',
    ),
    null,
  );
  assert.deepEqual(
    extractPrefecturePlaceFacts(
      fixture('place-pref-kitayama'),
      'https://www.kyoto-kankou.or.jp/info_search/7797',
      '表千家北山会館',
    ).image_urls,
    [],
  );
});

test('enrichment caches directory requests, retains schedule and records fact evidence', async () => {
  const requests = [];
  const enrich = createTemplePlaceEnricher({
    fetchPage: async (url) => {
      requests.push(url);
      return {
        url,
        html:
          url === detailUrl
            ? fixture('place-kamigamo')
            : listing('賀茂別雷神社（上賀茂神社）', 253),
      };
    },
  });
  const event = {
    title: '上賀茂神社 京都非公開文化財特別公開',
    venue_name: '上賀茂神社',
    address_text: null,
    image_urls: [],
    start_date: '2026-10-31',
    schedule_segments: [{ start_date: '2026-10-31', end_date: '2026-11-16' }],
    _temple_warnings: ['missing-event-address', 'unresolved-prefecture', 'missing-event-images'],
  };
  const updated = await enrich(event);
  await enrich(event);
  assert.equal(requests.length, 5);
  assert.equal(updated.address_text, '京都市北区上賀茂本山339');
  assert.equal(updated.location_source_url, detailUrl);
  assert.equal(updated.image_source_url, detailUrl);
  assert.equal(updated._location_prefecture, 'Kyoto');
  assert.deepEqual(updated._temple_warnings, []);
  assert.deepEqual(updated.schedule_segments, event.schedule_segments);
  assert.equal((await enrich({ ...event, start_date: null })).address_text, null);
  assert.equal(requests.length, 5);
});
