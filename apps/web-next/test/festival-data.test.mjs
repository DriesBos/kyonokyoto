import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lib = new URL('../src/lib/', import.meta.url);

test('city listing keeps festival editions and excludes programme child rows', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  assert.match(source, /'event_kind'/);
  assert.match(
    source,
    /dedupeEvents\(rows\.filter\(\(event\) => event\.event_kind !== 'festival_program'\)\)/,
  );
  assert.match(source, /eventKind: event\.event_kind === 'festival' \? 'festival' : 'event'/);
  assert.match(source, /event\.event_kind === 'festival' && event\.festival_slug/);
  assert.match(source, /withConfiguredFestivalMedia\(event, sources\)/);
  assert.doesNotMatch(source, /filter\(\(event\) => event\.event_kind !== 'festival'\)/);

  const grid = await readFile(new URL('../src/app/EventsGrid.tsx', import.meta.url), 'utf8');
  assert.match(grid, /event\.eventKind === 'festival' \? ' — FESTIVAL' : null/);
});

test('festival detail fetches one parent record and creates date-range calendar actions', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  const detailFunction = source.slice(source.indexOf('export async function fetchFestivalDetail'));
  assert.match(detailFunction, /festival_slug:/);
  assert.match(detailFunction, /event_kind: 'eq\.festival'/);
  assert.doesNotMatch(detailFunction, /festival_id|festival_program|programsEndpoint/);
  assert.match(
    detailFunction,
    /googleCalendarUrl: appleCalendar \? googleCalendarUrl\(calendarInput\) : null/,
  );
  assert.match(detailFunction, /appleCalendar,/);
  assert.match(detailFunction, /festival\.external_id/);
  assert.match(source, /filterEventMediaByMinimumHeight\(festivalWithMedia\) as EventRow/);
});

test('festival page links cover and previews to official site and exposes calendar actions', async () => {
  const page = await readFile(new URL('../src/app/FestivalPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /festival\.name/);
  assert.match(page, /festival\.year/);
  assert.match(page, /festival\.date/);
  assert.match(page, /festival\.title/);
  assert.match(page, /festival\.description/);
  assert.match(page, /festival\.images\.slice\(1, 5\)/);
  assert.match(page, /eventMediaDeliveryUrl\(/);
  assert.match(page, /eventMediaDeliverySrcSet\(/);
  assert.match(page, /googleCalendarUrl=\{festival\.googleCalendarUrl\}/);
  assert.match(page, /appleCalendar=\{festival\.appleCalendar\}/);
  assert.match(page, /href=\{festival\.sourceUrl\}/);
  assert.doesNotMatch(page, /program|programme/i);
});
