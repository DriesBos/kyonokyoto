import assert from 'node:assert/strict';
import test from 'node:test';

const schedule = await import('../../../packages/shared/event-schedule.mjs');

test('event display window includes starts up to one calendar year from today', () => {
  assert.equal(typeof schedule.isEventWithinDisplayWindow, 'function');

  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2027-05-27', end_date: '2027-06-10' },
      '2026-05-27',
    ),
    true,
  );
  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2027-05-28', end_date: '2027-06-10' },
      '2026-05-27',
    ),
    false,
  );

  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2025-02-28', end_date: '2025-03-01' },
      '2024-02-29',
    ),
    true,
  );
  assert.equal(
    schedule.isEventWithinDisplayWindow(
      { start_date: '2025-03-01', end_date: '2025-03-02' },
      '2024-02-29',
    ),
    false,
  );
});

test('event display window keeps ongoing events and hides unknown-start events', () => {
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
    false,
  );
});
