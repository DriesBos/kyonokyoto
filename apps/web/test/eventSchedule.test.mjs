import assert from 'node:assert/strict';
import test from 'node:test';

const schedule = await import('../../../packages/shared/event-schedule.mjs');

test('event display window includes starts up to six calendar months from today', () => {
  assert.equal(typeof schedule.isEventWithinDisplayWindow, 'function');

  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2026-11-27', end_date: '2026-12-10' },
      '2026-05-27',
    ),
    true,
  );
  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2026-11-28', end_date: '2026-12-10' },
      '2026-05-27',
    ),
    false,
  );
});

test('event display window keeps ongoing and unknown-start events visible', () => {
  assert.equal(typeof schedule.isEventWithinDisplayWindow, 'function');

  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2026-05-01', end_date: '2026-12-10' },
      '2026-05-27',
    ),
    true,
  );
  assert.equal(
    schedule.isEventWithinDisplayWindow({ start_date: null, end_date: '2026-12-10' }, '2026-05-27'),
    true,
  );
});
