import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { googleCalendarUrl } = await import('../src/lib/calendar.ts');

const baseEvent = {
  title: 'Schedule test',
  description: 'Details',
  institution_name: 'Test venue',
  venue_name: null,
  address_text: 'Kyoto',
  calendar_starts_at: null,
  calendar_ends_at: null,
};

const calendarDates = (url) => new URL(url).searchParams.get('dates');

test('legacy calendar fields keep all-day inclusive-end behavior', () => {
  const url = googleCalendarUrl(
    {
      ...baseEvent,
      calendar_starts_at: '2026-07-11',
      calendar_ends_at: '2026-08-01',
    },
    '2026-07-13',
  );

  assert.equal(calendarDates(url), '20260711/20260802');
});

test('calendar chooses active or next all-day segment and makes end exclusive', () => {
  const url = googleCalendarUrl(
    {
      ...baseEvent,
      schedule_type: 'occurrence_set',
      schedule_segments: [
        {
          ordinal: 0,
          is_all_day: true,
          start_date: '2026-07-17',
          end_date: '2026-08-09',
          starts_at: null,
          ends_at: null,
          timezone: 'Asia/Tokyo',
        },
        {
          ordinal: 1,
          is_all_day: true,
          start_date: '2026-08-11',
          end_date: '2026-08-30',
          starts_at: null,
          ends_at: null,
          timezone: 'Asia/Tokyo',
        },
      ],
    },
    '2026-08-10',
  );

  assert.equal(calendarDates(url), '20260811/20260831');
});

test('calendar emits timed segment timestamps in UTC', () => {
  const url = googleCalendarUrl(
    {
      ...baseEvent,
      schedule_type: 'single',
      schedule_segments: [
        {
          ordinal: 0,
          is_all_day: false,
          start_date: null,
          end_date: null,
          starts_at: '2026-07-11T01:30:00+09:00',
          ends_at: '2026-07-11T02:30:00+09:00',
          timezone: 'Asia/Tokyo',
        },
      ],
    },
    '2026-07-11',
  );

  assert.equal(calendarDates(url), '20260710T163000Z/20260710T173000Z');
});

test('calendar declines open-ended segment without inventing an end', () => {
  const url = googleCalendarUrl(
    {
      ...baseEvent,
      schedule_type: 'range',
      schedule_segments: [
        {
          ordinal: 0,
          is_all_day: true,
          start_date: '2026-04-09',
          end_date: null,
          starts_at: null,
          ends_at: null,
          timezone: 'Asia/Tokyo',
        },
      ],
    },
    '2026-07-11',
  );

  assert.equal(url, null);
});

test('web query and display path consume canonical schedule relation', async () => {
  const source = await readFile(new URL('../src/lib/events.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /schedule_segments:event_schedule_segments\(ordinal, is_all_day, start_date, end_date, starts_at, ends_at, timezone\)/,
  );
  assert.match(source, /preserveSourceDateText = scheduleSegments\.length > 1/);
  assert.match(source, /scheduleType === 'open_ended'/);
  assert.match(source, /start_date: preserveSourceDateText \? null/);
  assert.match(source, /end_date: preserveSourceDateText \? null/);
  assert.match(source, /event\.timing === 'ongoing' \|\| event\.timing === 'upcoming'/);
  assert.match(source, /nextRelevantScheduleStartDateOnly\(left, today\)/);
});
