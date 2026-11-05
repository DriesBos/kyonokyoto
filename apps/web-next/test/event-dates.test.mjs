import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEventScheduleDate } from '../src/lib/eventDates.ts';
import { googleCalendarUrl } from '../src/lib/calendar.ts';

// Sōken-in's published autumn opening, with November 4–5 and 21–22 excluded.
const sokenin = {
  title: 'Sōken-in autumn opening',
  start_date: '2026-10-10',
  end_date: '2026-11-30',
  schedule_type: 'range',
  is_all_day: true,
  schedule_segments: [
    { ordinal: 0, is_all_day: true, start_date: '2026-10-10', end_date: '2026-11-03' },
    { ordinal: 1, is_all_day: true, start_date: '2026-11-06', end_date: '2026-11-20' },
    { ordinal: 2, is_all_day: true, start_date: '2026-11-23', end_date: '2026-11-30' },
  ],
};
const rawNotes = '2026年10月10日(土)〜11月30日(月) 拝観休止日: 11月4日・5日';

test('split opening formats next verified period during closure, in either locale', () => {
  const before = structuredClone(sokenin);
  assert.equal(formatEventScheduleDate(sokenin, '2026-11-05', rawNotes, 'en'), '6 – 20 Nov 2026');
  assert.equal(
    formatEventScheduleDate(sokenin, '2026-11-05', rawNotes, 'ja'),
    '6日 – 2026年11月20日',
  );
  assert.equal(
    formatEventScheduleDate(sokenin, '2026-11-06', rawNotes, 'en'),
    "ONGOING — 20 NOV '26",
  );
  assert.equal(formatEventScheduleDate(sokenin, '2026-11-21', rawNotes, 'en'), '23 – 30 Nov 2026');
  assert.deepEqual(sokenin, before);
  const calendar = new URL(
    googleCalendarUrl(
      { ...sokenin, institution: '大徳寺 総見院', schedule_segments: sokenin.schedule_segments },
      '2026-11-05',
    ),
  );
  assert.equal(calendar.searchParams.get('dates'), '20261106/20261121');
});

test('ordinary, timed and open-ended date labels retain existing behavior', () => {
  assert.equal(
    formatEventScheduleDate(
      { start_date: '2026-11-08', end_date: '2026-11-08', is_all_day: true },
      '2026-11-05',
      rawNotes,
      'en',
    ),
    '8 Nov 2026',
  );
  assert.equal(
    formatEventScheduleDate(
      {
        calendar_starts_at: '2026-11-08T10:00:00+09:00',
        calendar_ends_at: '2026-11-08T12:00:00+09:00',
        is_all_day: false,
      },
      '2026-11-05',
      rawNotes,
      'en',
    ),
    '8 Nov 2026',
  );
  assert.equal(
    formatEventScheduleDate(
      { start_date: '2026-11-08', end_date: null, schedule_type: 'open_ended', is_all_day: true },
      '2026-11-05',
      'From 8 November',
      'en',
    ),
    'From 8 November',
  );
});
