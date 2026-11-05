import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistTempleEvent,
  finishTempleSourceScan,
  finalizeTempleEvent,
} from '../src/temple-persistence.mjs';
import { templeQaReport } from '../../../scripts/temples-qa.mjs';

const event = {
  title: '大徳寺 聚光院 開創460年 特別公開',
  venue_name: '大徳寺 聚光院',
  institution_name: '大徳寺 聚光院',
  address_text: '京都市北区紫野大徳寺町58',
  source_url: 'https://publisher.example/event/12',
  categories: ['collection:temples-gardens'],
  start_date: '2026-09-18',
  end_date: '2026-12-06',
  schedule_segments: [
    { is_all_day: true, start_date: '2026-09-18', end_date: '2026-09-26' },
    { is_all_day: true, start_date: '2026-09-29', end_date: '2026-12-06' },
  ],
  _temple_warnings: [],
};

test('temple persistence sends one atomic RPC with closure-separated schedule and publisher identity', async () => {
  const calls = [];
  const result = await persistTempleEvent({
    env: {},
    source: { id: 'publisher' },
    rawPageId: 'raw',
    event,
    request: async (call) => {
      calls.push(call);
      return {
        event: { id: 'canonical', dedupe_key: 'temple:canonical' },
        canonical_updated: false,
        duplicate_candidates: 1,
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'rpc/ingest_temple_event');
  assert.equal(calls[0].body.p_source_id, 'publisher');
  assert.equal(calls[0].body.p_event.venue_name, '大徳寺 聚光院');
  assert.equal(calls[0].body.p_event._temple_warnings, undefined);
  assert.equal(calls[0].body.p_segments.length, 2);
  assert.equal(calls[0].body.p_segments[0].end_date, '2026-09-26');
  assert.equal(calls[0].body.p_segments[0].event_id, undefined);
  assert.equal(result.event.id, 'canonical');
  assert.equal(result.canonical_updated, false);
  assert.equal(result.duplicate_candidates, 1);
});

test('invalid schedules never reach persistence; database errors are not silently retried as legacy events', async () => {
  let called = false;
  await assert.rejects(
    persistTempleEvent({
      env: {},
      source: { id: 'publisher' },
      event: { ...event, schedule_segments: [], start_date: null, end_date: null },
      request: async () => {
        called = true;
      },
    }),
    /schedule/,
  );
  assert.equal(called, false);
  await assert.rejects(
    persistTempleEvent({
      env: {},
      source: { id: 'publisher' },
      event,
      request: async () => {
        throw new Error('database unavailable');
      },
    }),
    /database unavailable/,
  );
});

test('finishing scan changes source evidence through scoped RPC, never event archive requests', async () => {
  const calls = [];
  await finishTempleSourceScan({
    env: {},
    sourceId: 'one-publisher',
    seenKeys: new Set(['one', 'two']),
    request: async (call) => calls.push(call),
  });
  assert.deepEqual(
    calls.map((call) => [call.path, call.body]),
    [
      [
        'rpc/finish_temple_source_scan',
        { p_source_id: 'one-publisher', p_seen_keys: ['one', 'two'] },
      ],
    ],
  );
});

test('temple publication carries canonical revision so stale translations cannot overwrite another publisher', async () => {
  let sent;
  const result = await finalizeTempleEvent({
    env: {},
    sourceId: 'publisher',
    event: { id: 'event', updated_at: '2026-11-05T03:00:00.123456Z' },
    translations: [{ locale: 'ja', title: '公開', source_content_hash: 'a'.repeat(64) }],
    request: async (call) => {
      sent = call;
      return false;
    },
  });
  assert.equal(result, false);
  assert.equal(sent.path, 'rpc/finalize_temple_event');
  assert.equal(sent.body.p_revision, '2026-11-05T03:00:00.123456Z');
  assert.equal(sent.body.p_source_id, 'publisher');
});

test('read-only QA report exposes duplicate pair facts and provenance without credentials', async () => {
  const urls = [];
  const report = await templeQaReport(
    { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key' },
    async (url, options) => {
      urls.push([url, options]);
      const rows = url.includes('event_duplicate_candidates?')
        ? [{ id: 'pair', event_id: 'a', other_event_id: 'b', reason: 'review' }]
        : url.includes('sources?source_kind=')
          ? [{ slug: 'kyoto-shunju', beta: true }]
          : url.includes('/events?')
            ? [
                { id: 'a', venue_name: '聚光院' },
                { id: 'b', venue_name: '聚光院' },
              ]
            : [{ event_id: 'a', source_url: 'https://source.example/event/a' }];
      return new Response(JSON.stringify(rows), { status: 200 });
    },
  );
  assert.ok(urls.every(([, options]) => options.method == null));
  assert.equal(
    report.pendingMatches[0].events[0].sources[0].source_url,
    'https://source.example/event/a',
  );
  assert.equal(JSON.stringify(report).includes('private-test-key'), false);
});
