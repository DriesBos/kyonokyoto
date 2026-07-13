import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const {
  activeOrNextScheduleSegment,
  buildScheduleFields,
  classifyEventTiming,
  eventScheduleSegments,
  inferCanonicalScheduleType,
  isEventWithinDisplayWindow,
  nextRelevantScheduleStartDateOnly,
  validateScheduleSegments,
} = await import('../../../packages/shared/event-schedule.mjs');

const allDay = (startDate, endDate = startDate) => ({
  is_all_day: true,
  start_date: startDate,
  end_date: endDate,
});

test('canonical schedule kinds validate without changing legacy schedule fields', () => {
  const schedules = [
    {
      event: { schedule_type: 'single', schedule_segments: [allDay('2026-07-11')] },
      type: 'single',
    },
    {
      event: {
        schedule_type: 'range',
        schedule_segments: [allDay('2026-07-11', '2026-08-01')],
      },
      type: 'range',
    },
    {
      event: {
        schedule_type: 'occurrence_set',
        schedule_segments: [allDay('2026-07-11'), allDay('2026-08-01')],
      },
      type: 'occurrence_set',
    },
    {
      event: {
        schedule_type: 'open_ended',
        schedule_segments: [allDay('2026-07-11', null)],
      },
      type: 'open_ended',
    },
  ];

  for (const { event, type } of schedules) {
    assert.equal(inferCanonicalScheduleType(event), type);
    assert.deepEqual(validateScheduleSegments(event), {
      valid: true,
      errors: [],
      schedule_type: type,
      schedule_segments: event.schedule_segments,
    });
  }

  assert.deepEqual(buildScheduleFields({ startDate: '2026-07-11' }), {
    schedule_type: 'occurrence_set',
    occurrence_dates: ['2026-07-11'],
  });
  assert.deepEqual(buildScheduleFields({ startDate: '2026-07-11', endDate: '2026-08-01' }), {
    schedule_type: 'range',
    occurrence_dates: [],
  });

  assert.equal(
    inferCanonicalScheduleType({
      schedule_type: 'range',
      schedule_segments: [allDay('2026-07-11', null)],
    }),
    'open_ended',
  );
});

test('segment validation rejects invalid dates, reversed bounds, and mixed precision', () => {
  const invalid = validateScheduleSegments({
    schedule_type: 'range',
    schedule_segments: [
      {
        is_all_day: true,
        start_date: '2026-02-30T00:00:00Z',
        end_date: '2026-02-01',
        starts_at: '2026-02-01T10:00:00+09:00',
      },
    ],
  });

  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /start_date must be valid/);
  assert.match(invalid.errors.join('\n'), /must not contain timestamps/);
  assert.deepEqual(eventScheduleSegments({ schedule_segments: invalid.schedule_segments }), []);

  const reversed = validateScheduleSegments({
    schedule_type: 'range',
    schedule_segments: [allDay('2026-07-12', '2026-07-11')],
  });
  assert.equal(reversed.valid, false);
  assert.match(reversed.errors.join('\n'), /must not precede start_date/);

  const unsupported = validateScheduleSegments({ schedule_type: 'recurring' });
  assert.equal(unsupported.valid, false);
  assert.match(unsupported.errors.join('\n'), /schedule_type is not supported/);
});

test('split phases classify gap as upcoming instead of ongoing', () => {
  const event = {
    schedule_type: 'occurrence_set',
    schedule_segments: [allDay('2026-07-17', '2026-08-09'), allDay('2026-08-11', '2026-08-30')],
  };

  assert.equal(classifyEventTiming(event, '2026-08-09'), 'ongoing');
  assert.deepEqual(activeOrNextScheduleSegment(event, '2026-08-10'), event.schedule_segments[1]);
  assert.equal(classifyEventTiming(event, '2026-08-10'), 'upcoming');
  assert.equal(nextRelevantScheduleStartDateOnly(event, '2026-08-10'), '2026-08-11');
  assert.equal(classifyEventTiming(event, '2026-08-11'), 'ongoing');
  assert.equal(classifyEventTiming(event, '2026-08-31'), 'past');
});

test('past and future occurrences window from next relevant date', () => {
  const event = {
    schedule_type: 'occurrence_set',
    schedule_segments: [allDay('2026-01-10'), allDay('2027-05-28')],
  };

  assert.equal(classifyEventTiming(event, '2026-05-27'), 'upcoming');
  assert.equal(nextRelevantScheduleStartDateOnly(event, '2026-05-27'), '2027-05-28');
  assert.equal(isEventWithinDisplayWindow(event, '2026-05-27'), false);
  assert.equal(isEventWithinDisplayWindow(event, '2026-05-28'), true);
});

test('open-ended segment stays upcoming before start and ongoing after start', () => {
  const event = {
    schedule_type: 'open_ended',
    schedule_segments: [allDay('2026-04-09', null)],
  };

  assert.equal(classifyEventTiming(event, '2026-04-08'), 'upcoming');
  assert.equal(classifyEventTiming(event, '2026-07-11'), 'ongoing');
  assert.equal(nextRelevantScheduleStartDateOnly(event, '2026-07-11'), '2026-07-11');
  assert.equal(isEventWithinDisplayWindow(event, '2026-07-11'), true);
});

test('timed segment classifies on event timezone date', () => {
  const event = {
    schedule_type: 'single',
    schedule_segments: [
      {
        is_all_day: false,
        starts_at: '2026-07-10T16:30:00Z',
        ends_at: '2026-07-10T17:30:00Z',
        timezone: 'Asia/Tokyo',
      },
    ],
  };

  const validated = validateScheduleSegments(event);
  assert.equal(validated.valid, true);
  assert.deepEqual(validated.schedule_segments, [
    {
      is_all_day: false,
      starts_at: '2026-07-10T16:30:00.000Z',
      ends_at: '2026-07-10T17:30:00.000Z',
      timezone: 'Asia/Tokyo',
    },
  ]);
  assert.equal(classifyEventTiming(event, '2026-07-10'), 'upcoming');
  assert.equal(classifyEventTiming(event, '2026-07-11'), 'ongoing');
  assert.equal(classifyEventTiming(event, '2026-07-12'), 'past');
});

test('unknown or invalid schedule never silently classifies ongoing', () => {
  assert.equal(classifyEventTiming({}, '2026-07-11'), 'unknown');
  assert.equal(classifyEventTiming({ schedule_type: 'unknown' }, '2026-07-11'), 'unknown');
  assert.equal(classifyEventTiming({ start_date: '2026-07-11' }, 'not-a-date'), 'unknown');
  assert.equal(isEventWithinDisplayWindow({}, '2026-07-11'), false);
});

test('empty Supabase schedule relation falls back to legacy schedule fields', () => {
  const event = {
    schedule_type: 'range',
    schedule_segments: [],
    is_all_day: true,
    start_date: '2026-07-11',
    end_date: '2026-08-01',
  };

  assert.deepEqual(eventScheduleSegments(event), [allDay('2026-07-11', '2026-08-01')]);
  assert.equal(inferCanonicalScheduleType(event), 'range');
  assert.equal(classifyEventTiming(event, '2026-07-13'), 'ongoing');
});

test('migration does not guess timed moments from legacy opening-hour timestamps', async () => {
  const migration = await readFile(
    new URL(
      '../../../supabase/migrations/20260713003650_event_schedule_segments.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.doesNotMatch(migration, /where not event\.is_all_day/);
});
