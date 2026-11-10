import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseStarredEntries,
  parseStarredIds,
  toggleStarredEntry,
  toggleStarredId,
  STARRED_EVENTS_KEY,
  STARS_UPDATED_EVENT,
} from '../src/lib/eventStars.ts';

const app = new URL('../src/app/', import.meta.url);

test('starred ids keep the old site key and event so saved stars and map markers carry over', () => {
  assert.equal(STARRED_EVENTS_KEY, 'kyo_starred_events');
  assert.equal(STARS_UPDATED_EVENT, 'event-stars:updated');
});

test('parseStarredIds tolerates junk and drops duplicates', () => {
  assert.deepEqual(parseStarredIds(null), []);
  assert.deepEqual(parseStarredIds('not json'), []);
  assert.deepEqual(parseStarredIds('{"a":1}'), []);
  assert.deepEqual(parseStarredIds('["a", 2, "", "b", "a"]'), ['a', 'b']);
});

test('v1 string arrays still read as entries without dates', () => {
  assert.deepEqual(parseStarredEntries('["a","b"]'), [
    { id: 'a', savedAt: null, endsAt: null },
    { id: 'b', savedAt: null, endsAt: null },
  ]);
});

test('v2 entries read, mixed with v1 ids, junk and duplicates dropped', () => {
  const raw = JSON.stringify([
    { id: 'a', savedAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01' },
    'b',
    { id: 'c', savedAt: 5, endsAt: null },
    { id: '' },
    { nope: true },
    null,
    { id: 'a', endsAt: null },
  ]);
  assert.deepEqual(parseStarredEntries(raw, Date.parse('2026-11-10')), [
    { id: 'a', savedAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01' },
    { id: 'b', savedAt: null, endsAt: null },
    { id: 'c', savedAt: null, endsAt: null },
  ]);
  assert.deepEqual(parseStarredIds(raw, Date.parse('2026-11-10')), ['a', 'b', 'c']);
});

test('entries whose event ended more than 30 days ago are pruned', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const raw = JSON.stringify([
    { id: 'old', savedAt: null, endsAt: '2026-10-01' }, // 40 days ago
    { id: 'recent', savedAt: null, endsAt: '2026-10-20' }, // 21 days ago
    { id: 'edge', savedAt: null, endsAt: '2026-10-11T00:00:00Z' }, // exactly 30 days
    { id: 'permanent', savedAt: null, endsAt: null },
    { id: 'bad-date', savedAt: null, endsAt: 'soon' },
  ]);
  assert.deepEqual(parseStarredIds(raw, now), ['recent', 'edge', 'permanent', 'bad-date']);
});

test('toggleStarredEntry stores id, savedAt and endsAt, and removes', () => {
  const added = toggleStarredEntry([], 'a', '2026-12-01', '2026-11-10T00:00:00.000Z');
  assert.deepEqual(added, [{ id: 'a', savedAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-12-01' }]);
  assert.deepEqual(toggleStarredEntry(added, 'a', null), []);
});

test('toggleStarredId adds and removes', () => {
  assert.deepEqual(toggleStarredId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleStarredId(['a', 'b'], 'a'), ['b']);
});

test('the outline star shows only on expanded cards and fills when starred', async () => {
  const [grid, button, styles] = await Promise.all([
    readFile(new URL('EventsGrid.tsx', app), 'utf8'),
    readFile(new URL('EventStarButton.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
  ]);
  // inside the lifted front, so it moves with the 3D lift
  assert.ok(grid.indexOf('styles.boxLift') < grid.indexOf('<EventStarButton'));
  assert.ok(grid.indexOf('<EventStarButton') < grid.indexOf('<BoxEdge'));
  assert.match(button, /event\.stopPropagation\(\)/);
  assert.match(button, /dataset\.starred = String\(starred\)/);
  assert.match(styles, /\.star\n  position: absolute\n  z-index: 4/);
  assert.match(styles, /path\n    fill: transparent/);
  assert.match(styles, /&\[aria-pressed='true'\] \.starShape\n    fill: currentColor/);
  // hidden on closed cards, starred or not; shown once the card is expanded
  assert.match(
    styles,
    /\.block:not\(:has\(\[data-event-card-detail\]\[data-expanded='true'\]\)\) \.star\n  display: none/,
  );
  assert.match(styles, /\n\.block:has\(\[data-event-card-detail\]\[data-expanded='true'\]\)\n/);
  // no hover-only reveal
  const starBlock = styles.slice(styles.indexOf('\n.star\n'), styles.indexOf('\n.starRing\n'));
  assert.doesNotMatch(starBlock, /opacity: 0\n|:hover/);
});
