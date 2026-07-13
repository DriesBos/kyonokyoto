import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { buildAppleCalendarIcs } = await import('../src/scripts/appleCalendar.ts');

const fixedFields = {
  title: 'Quiet Forms',
  details: 'Sculpture, paper; and clay',
  location: 'Kyoto',
  uid: 'event@kyonokyoto',
  dtStamp: '20260713T000000Z',
};

test('Apple calendar keeps inclusive all-day input with exclusive DATE end', () => {
  const ics = buildAppleCalendarIcs({
    ...fixedFields,
    start: '2026-07-11',
    end: '2026-08-01',
    isAllDay: true,
  });

  assert.match(ics, /DTSTART;VALUE=DATE:20260711\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260802\r\n/);
  assert.match(ics, /DESCRIPTION:Sculpture\\, paper\\; and clay/);
});

test('Apple calendar emits timed timestamps in UTC', () => {
  const ics = buildAppleCalendarIcs({
    ...fixedFields,
    start: '2026-07-11T01:30:00+09:00',
    end: '2026-07-11T02:30:00+09:00',
    isAllDay: false,
  });

  assert.match(ics, /DTSTART:20260710T163000Z\r\n/);
  assert.match(ics, /DTEND:20260710T173000Z\r\n/);
  assert.doesNotMatch(ics, /VALUE=DATE/);
});

test('Apple calendar declines open-ended events', () => {
  assert.equal(
    buildAppleCalendarIcs({
      ...fixedFields,
      start: '2026-04-09',
      end: '',
      isAllDay: true,
    }),
    null,
  );
});

test('event card passes full selected schedule values and all-day marker', async () => {
  const card = await readFile(
    new URL('../src/components/EventCard.astro', import.meta.url),
    'utf8',
  );

  assert.match(card, /const showAppleCalendar = Boolean\(calendarStart && calendarEnd\)/);
  assert.match(card, /data-calendar-start=\{calendarStart\}/);
  assert.match(card, /data-calendar-end=\{calendarEnd\}/);
  assert.match(card, /data-calendar-all-day=\{String\(calendarIsAllDay\)\}/);
  assert.match(card, /calendarIsAllDay = event\.is_all_day/);
  assert.doesNotMatch(card, /calendar_starts_at\?\.slice/);
  assert.doesNotMatch(card, /calendar_ends_at\?\.slice/);
});
