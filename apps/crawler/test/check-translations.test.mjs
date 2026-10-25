import assert from 'node:assert/strict';
import test from 'node:test';
import { findMissingTranslations } from '../src/check-translations.mjs';

const kyoto = { slug: 'kyoto-gallery', city: 'kyoto' };
const hongKong = { slug: 'hong-kong-gallery', city: 'hong-kong' };

test('translation check only requires locales for current and upcoming events', () => {
  // 2026-10-25 00:30 in Kyoto is still 2026-10-24 in UTC.
  const now = new Date('2026-10-24T15:30:00Z');
  const report = findMissingTranslations(
    [
      {
        id: 'past',
        end_date: '2026-10-24',
        sources: kyoto,
        event_translations: [{ locale: 'ja' }],
      },
      {
        id: 'today',
        end_date: '2026-10-25',
        sources: kyoto,
        event_translations: [{ locale: 'ja' }],
      },
      { id: 'open', end_date: null, sources: kyoto, event_translations: [{ locale: 'en' }] },
      {
        id: 'complete',
        end_date: '2026-12-01',
        sources: kyoto,
        event_translations: [{ locale: 'en' }, { locale: 'ja' }],
      },
      {
        id: 'hk',
        end_date: '2026-11-01',
        sources: hongKong,
        event_translations: [{ locale: 'en' }],
      },
    ],
    now,
  );

  assert.equal(report.status, 'failed');
  assert.equal(report.events_checked, 4);
  assert.equal(report.past_events_skipped, 1);
  assert.deepEqual(
    report.missing.map((row) => [row.id, row.missing]),
    [
      ['today', ['en']],
      ['open', ['ja']],
    ],
  );
});

test('translation check passes when only past events lack locales', () => {
  const report = findMissingTranslations(
    [
      {
        id: 'past',
        end_date: '2026-07-30',
        sources: kyoto,
        event_translations: [{ locale: 'ja' }],
      },
    ],
    new Date('2026-10-25T03:00:00Z'),
  );

  assert.equal(report.status, 'passed');
  assert.equal(report.past_events_skipped, 1);
  assert.deepEqual(report.missing, []);
});
