import assert from 'node:assert/strict';
import test from 'node:test';

import { groupDisplayEvents } from '../src/lib/eventSections.ts';

test('active permanent-like source events move to the permanent section without duplication', () => {
  const ranged = { id: 'ranged', timing: 'ongoing', schedule_type: 'range' };
  const openEnded = {
    id: 'open-ended',
    timing: 'ongoing',
    schedule_type: 'range',
    schedule_segments: [{ is_all_day: true, start_date: '2026-01-01', end_date: null }],
  };
  const futureOpenEnded = {
    id: 'future-open-ended',
    timing: 'upcoming',
    schedule_type: 'open_ended',
  };
  const longRunning = {
    id: 'long-running',
    timing: 'ongoing',
    schedule_type: 'range',
    schedule_segments: [{ is_all_day: true, start_date: '2017-10-01', end_date: '2028-03-31' }],
  };
  const exactBoundary = {
    id: 'exact-boundary',
    timing: 'ongoing',
    schedule_type: 'range',
    schedule_segments: [{ is_all_day: true, start_date: '2026-01-01', end_date: '2027-07-19' }],
  };
  const oldButEndingSoon = {
    id: 'old-but-ending-soon',
    timing: 'ongoing',
    schedule_type: 'range',
    schedule_segments: [{ is_all_day: true, start_date: '2024-01-01', end_date: '2026-08-13' }],
  };
  const futureLongRunning = {
    id: 'future-long-running',
    timing: 'upcoming',
    schedule_type: 'range',
    schedule_segments: [{ is_all_day: true, start_date: '2026-08-01', end_date: '2028-03-31' }],
  };

  const grouped = groupDisplayEvents(
    [
      ranged,
      openEnded,
      futureOpenEnded,
      longRunning,
      exactBoundary,
      oldButEndingSoon,
      futureLongRunning,
    ],
    '2026-07-19',
  );

  assert.deepEqual(grouped.ongoingEvents, [ranged, exactBoundary, oldButEndingSoon]);
  assert.deepEqual(grouped.upcomingEvents, [futureOpenEnded, futureLongRunning]);
  assert.deepEqual(grouped.sourcePermanentEvents, [openEnded, longRunning]);
  assert.deepEqual(
    [...grouped.ongoingEvents, ...grouped.upcomingEvents, ...grouped.sourcePermanentEvents].map(
      (event) => event.id,
    ),
    [
      'ranged',
      'exact-boundary',
      'old-but-ending-soon',
      'future-open-ended',
      'future-long-running',
      'open-ended',
      'long-running',
    ],
  );
});
