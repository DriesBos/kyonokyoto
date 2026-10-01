import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lib = new URL('../src/lib/', import.meta.url);

test('city event data selects festival identity and programme linkage', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  assert.match(source, /'event_kind'/);
  assert.match(source, /'festival_id'/);
  assert.match(source, /'festival_slug'/);
  assert.match(source, /event\.event_kind !== 'festival'/);
  assert.match(
    source,
    /dedupeEvents\(visibleRows\.filter\(\(event\) => event\.event_kind !== 'festival_program'\)\)/,
  );
  assert.match(
    source,
    /\.\.\.visibleRows\.filter\(\(event\) => event\.event_kind === 'festival_program'\)/,
  );
  assert.match(source, /festival_id: `eq\.\$\{festival\.id\}`/);
  assert.match(source, /event_kind: 'eq\.festival_program'/);
});

test('festival programmes inherit missing edition dates and expose festival links', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  assert.match(
    source,
    /const dateInherited =\s*!event\.start_date &&\s*!event\.calendar_starts_at &&\s*!event\.schedule_segments\?\.length/,
  );
  assert.match(source, /start_date: dateInherited \? festival\.start_date : event\.start_date/);
  assert.match(
    source,
    /calendar_starts_at: dateInherited \? festival\.calendar_starts_at : event\.calendar_starts_at/,
  );
  assert.match(source, /festival:\s*event\.event_kind === 'festival_program'/);
  assert.match(source, /festivalDateInherited: dateInherited/);
  assert.match(
    source,
    /festivalSourceSlug: sources \? sourceSlugForEvent\(festival, sources\) : null/,
  );
  assert.match(
    source,
    /visibleSource\(event\.festivalSourceSlug \?\? sourceSlugForEvent\(event, sources\)\)/,
  );
  assert.match(source, /program\.festivalDateInherited \?\?/);
  assert.match(source, /event\.event_kind === 'festival_program' \? event\.lat/);
});

test('festival detail lookup returns no public detail for beta sources', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  assert.match(source, /export async function fetchFestivalDetail/);
  assert.match(source, /festival_slug: `eq\.\$\{slug\}`/);
  assert.match(source, /process\.env\.NODE_ENV === 'production' && source\.beta/);
  assert.match(
    source,
    /if \(!source \|\| \(process\.env\.NODE_ENV === 'production' && source\.beta\)\) return null/,
  );
});

test('festival UI omits inherited-date warning labels', async () => {
  const [page, grid] = await Promise.all([
    readFile(new URL('../src/app/FestivalPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/EventsGrid.tsx', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(page, /Festival-wide dates|フェスティバル全体の開催期間/);
  assert.doesNotMatch(grid, /Festival-wide dates|フェスティバル全体の開催期間/);
});
