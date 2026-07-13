import assert from 'node:assert/strict';
import test from 'node:test';

const { formatEventDateParts, formatEventDateRange, formatOngoingEventEnd } =
  await import('../src/lib/calendar.ts');

test('event dates format from normalized ISO values for English and Japanese', () => {
  assert.equal(
    formatEventDateRange('2026-07-11', '2026-08-01', 'raw date', 'en'),
    '11 Jul – 1 Aug 2026',
  );
  assert.equal(
    formatEventDateRange('2026-07-11', '2026-08-01', 'raw date', 'ja'),
    '2026年7月11日〜8月1日',
  );
  assert.equal(formatEventDateRange(null, null, 'Date pending', 'en'), 'Date pending');
});

test('event date parts preserve machine-readable ISO endpoints', () => {
  assert.deepEqual(formatEventDateParts('2026-12-20', '2027-01-10', 'raw date', 'en'), {
    startDate: '2026-12-20',
    endDate: '2027-01-10',
    startText: '20 Dec 2026',
    endText: '10 Jan 2027',
    separator: ' – ',
  });
});

test('ongoing event dates show only localized end-date copy', () => {
  assert.deepEqual(formatOngoingEventEnd('2026-08-01', 'raw date', 'en'), {
    date: '2026-08-01',
    text: "UNTIL 1 AUG '26",
  });
  assert.deepEqual(formatOngoingEventEnd('2026-08-01', 'raw date', 'ja'), {
    date: '2026-08-01',
    text: '2026年8月1日まで',
  });
  assert.deepEqual(formatOngoingEventEnd(null, 'Open ended', 'en'), {
    date: null,
    text: 'Open ended',
  });
});
