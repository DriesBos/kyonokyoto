import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReplayEvent } from '../src/replay-latest.mjs';
import { assessEventTitle } from '../src/run-once.mjs';

test('replay comparison reports only changed normalized fields', () => {
  const result = compareReplayEvent(
    {
      title: '  Example   Exhibition ',
      start_date: '2026-07-13',
      end_date: '2026-07-20',
      schedule_type: 'range',
      description: 'New copy',
      image_urls: ['https://example.com/art.jpg'],
    },
    {
      title: 'Example Exhibition',
      start_date: '2026-07-13',
      end_date: '2026-07-20',
      schedule_type: 'range',
      description: null,
      image_urls: ['https://example.com/art.jpg'],
    },
  );

  assert.deepEqual(result.changed_fields, ['description_present']);
});

test('replay comparison exposes live title-quality assessment', () => {
  const extracted = assessEventTitle(
    { title: 'Upcoming exhibition' },
    { name: 'Example Gallery' },
    'generic_fallback',
  );
  const result = compareReplayEvent(extracted, { title: 'Upcoming exhibition' });

  assert.deepEqual(result.title_quality, {
    valid: false,
    origin: 'generic_fallback',
    warnings: ['generic_label'],
  });
});
