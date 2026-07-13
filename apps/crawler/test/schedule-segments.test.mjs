import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScheduleSegmentRows,
  upsertEventScheduleSegments,
} from '../src/schedule-segments.mjs';

test('schedule persistence writes normalized segments before deleting stale ordinals', async () => {
  const requests = [];
  const rows = await upsertEventScheduleSegments({
    env: {},
    eventId: 'event-1',
    event: {
      schedule_type: 'range',
      schedule_segments: [
        {
          is_all_day: true,
          start_date: '2026-07-17',
          end_date: '2026-08-09',
        },
        {
          is_all_day: true,
          start_date: '2026-08-11',
          end_date: '2026-08-30',
        },
      ],
    },
    request: async (request) => {
      requests.push(request);
      return [];
    },
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    requests.map(({ method, path }) => ({ method, path })),
    [
      {
        method: 'POST',
        path: 'event_schedule_segments?on_conflict=event_id,ordinal',
      },
      {
        method: 'DELETE',
        path: 'event_schedule_segments?event_id=eq.event-1&ordinal=gte.2',
      },
    ],
  );
  assert.deepEqual(
    rows.map(({ ordinal, start_date, end_date }) => ({ ordinal, start_date, end_date })),
    [
      { ordinal: 0, start_date: '2026-07-17', end_date: '2026-08-09' },
      { ordinal: 1, start_date: '2026-08-11', end_date: '2026-08-30' },
    ],
  );
});

test('event timezone reaches persisted schedule segments', () => {
  const [row] = buildScheduleSegmentRows('event-hk', {
    start_date: '2026-07-13',
    end_date: '2026-07-20',
    schedule_type: 'range',
    timezone: 'Asia/Hong_Kong',
  });

  assert.equal(row.timezone, 'Asia/Hong_Kong');
});

test('legacy range becomes one segment and missing schedule is rejected', () => {
  assert.deepEqual(
    buildScheduleSegmentRows('event-1', {
      start_date: '2026-07-13',
      end_date: '2026-07-20',
      schedule_type: 'range',
    }),
    [
      {
        event_id: 'event-1',
        ordinal: 0,
        is_all_day: true,
        start_date: '2026-07-13',
        end_date: '2026-07-20',
        starts_at: null,
        ends_at: null,
        timezone: 'Asia/Tokyo',
      },
    ],
  );
  assert.throws(() => buildScheduleSegmentRows('event-1', {}), /at least one segment/);
});
