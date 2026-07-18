import assert from 'node:assert/strict';
import test from 'node:test';

import { groupDisplayEvents } from '../src/lib/eventSections.ts';

test('active open-ended source events move to the permanent section without duplication', () => {
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

  const grouped = groupDisplayEvents([ranged, openEnded, futureOpenEnded]);

  assert.deepEqual(grouped.ongoingEvents, [ranged]);
  assert.deepEqual(grouped.upcomingEvents, [futureOpenEnded]);
  assert.deepEqual(grouped.sourcePermanentEvents, [openEnded]);
  assert.deepEqual(
    [
      ...grouped.ongoingEvents,
      ...grouped.upcomingEvents,
      ...grouped.sourcePermanentEvents,
    ].map((event) => event.id),
    ['ranged', 'future-open-ended', 'open-ended'],
  );
});
