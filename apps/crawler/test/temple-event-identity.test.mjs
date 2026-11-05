import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTempleEventIdentity } from '../../../packages/shared/temple-event-identity.mjs';

const base = {
  title: '国宝・阿弥陀如来坐像 特別公開',
  venue_name: '清水寺',
  address_text: '京都府京都市東山区清水',
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  source_url: 'https://publisher.example/events?utm_source=x',
};

test('cross-publisher event matches with same venue, address, title, season, and year', () => {
  const left = buildTempleEventIdentity(base);
  const right = buildTempleEventIdentity({
    ...base,
    source_url: 'https://other.example/story/123',
  });
  assert.ok(left.matchKey);
  assert.equal(left.matchKey, right.matchKey);
  assert.notEqual(left.sourceEventKey, right.sourceEventKey);
});

test('generic annual opening titles remain review-only without specific official URL', () => {
  for (const title of ['Autumn Special Opening', '秋の特別公開', '特別公開']) {
    const identity = buildTempleEventIdentity({ ...base, title });
    assert.equal(identity.matchKey, null);
    assert.ok(identity.reviewKey);
  }
  const venuePrefixed = buildTempleEventIdentity({
    ...base,
    venue_name: '光雲寺',
    title: '光雲寺 秋の特別公開',
  });
  assert.equal(venuePrefixed.matchKey, null);
  const compoundVenuePrefixed = buildTempleEventIdentity({
    ...base,
    venue_name: '聚光院',
    institution_name: '大徳寺',
    title: '大徳寺 聚光院 秋の特別公開',
  });
  assert.equal(compoundVenuePrefixed.matchKey, null);
});

test('event-specific official URL permits generic title match across publishers', () => {
  const official_url = 'https://temple.example/news/2026-autumn-opening';
  const left = buildTempleEventIdentity({ ...base, title: '秋の特別公開', official_url });
  const right = buildTempleEventIdentity({
    ...base,
    title: '秋の特別公開',
    official_url,
    source_url: 'https://other.example/x',
  });
  assert.ok(left.matchKey);
  assert.equal(left.matchKey, right.matchKey);
});

test('generic title needs dated or event-route official URL, not static venue page', () => {
  const staticPage = buildTempleEventIdentity({
    ...base,
    venue_name: '光雲寺',
    title: '光雲寺 秋の特別公開',
    official_url: 'https://temple.example/temple/daitokuji-kohrinin',
  });
  const datedEvent = buildTempleEventIdentity({
    ...base,
    venue_name: '光雲寺',
    title: '光雲寺 秋の特別公開',
    official_url: 'https://temple.example/news/autumn-opening-2026',
  });
  assert.equal(staticPage.matchKey, null);
  assert.ok(datedEvent.matchKey);
});

test('inline entry IDs distinguish events sharing publisher URL; tracking params ignored', () => {
  const one = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/list?utm_medium=email',
    external_id: 'temple-a',
  });
  const same = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/list?utm_campaign=foo',
    external_id: 'temple-a',
  });
  const other = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/list?utm_campaign=foo',
    external_id: 'temple-b',
  });
  assert.equal(one.sourceEventKey, same.sourceEventKey);
  assert.notEqual(one.sourceEventKey, other.sourceEventKey);
});

test('meaningful URL query IDs survive canonicalization', () => {
  const one = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/event?id=42&utm_source=x',
  });
  const other = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/event?id=43',
  });
  assert.notEqual(one.sourceEventKey, other.sourceEventKey);
});

test('inline URL fragments distinguish listing entries when external IDs absent', () => {
  const one = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/list#event-1',
  });
  const two = buildTempleEventIdentity({
    ...base,
    source_url: 'https://publisher.example/list#event-2',
  });
  assert.notEqual(one.sourceEventKey, two.sourceEventKey);
});

test('venue, programme, season, and edition distinctions remain separate', () => {
  const original = buildTempleEventIdentity(base).matchKey;
  assert.notEqual(original, buildTempleEventIdentity({ ...base, venue_name: '東寺' }).matchKey);
  assert.notEqual(
    original,
    buildTempleEventIdentity({ ...base, title: '国宝・阿弥陀如来坐像 夜間特別公開' }).matchKey,
  );
  assert.notEqual(
    original,
    buildTempleEventIdentity({
      ...base,
      title: '国宝・阿弥陀如来坐像 春季特別公開',
      start_date: '2026-04-01',
    }).matchKey,
  );
  assert.notEqual(
    original,
    buildTempleEventIdentity({ ...base, start_date: '2027-10-01' }).matchKey,
  );
});

test('missing Japanese venue or locality facts prevents automatic match', () => {
  assert.equal(buildTempleEventIdentity({ ...base, venue_name: 'Kiyomizu Temple' }).matchKey, null);
  assert.equal(buildTempleEventIdentity({ ...base, address_text: 'Japan' }).matchKey, null);
  assert.equal(buildTempleEventIdentity({ ...base, start_date: null }).matchKey, null);
});

test('exact schedule bounds are required and included in cross-source key', () => {
  const original = buildTempleEventIdentity(base);
  const corrected = buildTempleEventIdentity({ ...base, start_date: '2026-10-02' });
  const differentEnd = buildTempleEventIdentity({ ...base, end_date: '2026-11-01' });
  assert.ok(original.matchKey);
  assert.notEqual(original.matchKey, corrected.matchKey);
  assert.notEqual(original.matchKey, differentEnd.matchKey);
  assert.equal(original.reviewKey, corrected.reviewKey);
  assert.equal(buildTempleEventIdentity({ ...base, end_date: null }).matchKey, null);
});

test('source event key distinguishes annual recurrence but tolerates date corrections within season', () => {
  const original = buildTempleEventIdentity(base).sourceEventKey;
  const correction = buildTempleEventIdentity({
    ...base,
    start_date: '2026-10-02',
    end_date: '2026-11-01',
  }).sourceEventKey;
  const nextYear = buildTempleEventIdentity({
    ...base,
    start_date: '2027-10-01',
    end_date: '2027-10-31',
  }).sourceEventKey;
  assert.equal(original, correction);
  assert.notEqual(original, nextYear);
});

test('Kyoto prefecture, Kyoto city, ward-only, and postal-code addresses canonicalize alike', () => {
  const baseLocation = {
    ...base,
    city: 'kyoto',
    venue_name: '大覚寺',
    title: '狩野派障壁画 特別公開',
  };
  const full = buildTempleEventIdentity({
    ...baseLocation,
    address_text: '〒616-8411 京都府京都市右京区嵯峨大沢町',
  });
  const noPrefecture = buildTempleEventIdentity({
    ...baseLocation,
    address_text: '京都市右京区嵯峨大沢町',
  });
  const wardOnly = buildTempleEventIdentity({
    ...baseLocation,
    address_text: '〒616-8411 右京区嵯峨大沢町',
  });
  assert.ok(full.matchKey);
  assert.equal(full.matchKey, noPrefecture.matchKey);
  assert.equal(full.matchKey, wardOnly.matchKey);
});

test('venue prefixes are removed from distinctive title identity', () => {
  const shared = {
    ...base,
    venue_name: '聚光院',
    institution_name: '大徳寺',
    title: '開創460年 特別公開',
  };
  const direct = buildTempleEventIdentity(shared);
  const prefixed = buildTempleEventIdentity({
    ...shared,
    title: '大徳寺 聚光院 開創460年 特別公開',
    source_url: 'https://other.example/entry',
  });
  assert.ok(direct.matchKey);
  assert.equal(direct.matchKey, prefixed.matchKey);
});

test('municipality remains in review and match identity for same-named venues', () => {
  const kyoto = buildTempleEventIdentity({
    ...base,
    venue_name: '観音寺',
    address_text: '京都市北区紫野',
  });
  const uji = buildTempleEventIdentity({
    ...base,
    venue_name: '観音寺',
    address_text: '宇治市宇治',
  });
  assert.notEqual(kyoto.reviewKey, uji.reviewKey);
  assert.notEqual(kyoto.matchKey, uji.matchKey);
});

test('English and Japanese venue aliases remain review-only without invented match', () => {
  const japanese = buildTempleEventIdentity({
    ...base,
    venue_name: '大徳寺',
    address_text: '京都市北区紫野',
  });
  const english = buildTempleEventIdentity({
    ...base,
    venue_name: 'Daitokuji Temple',
    title: 'Autumn Special Viewing',
    address_text: '京都市北区紫野',
  });
  assert.ok(japanese.reviewKey);
  assert.ok(english.reviewKey);
  assert.ok(japanese.matchKey);
  assert.equal(english.matchKey, null);
  assert.notEqual(japanese.matchKey, english.matchKey);
});
