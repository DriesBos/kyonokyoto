import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('map panel opens as a city-colour block and the map fades in once tiles load', async () => {
  const layout = await read('../src/app/MapExperience.module.sass');
  const canvas = await read('../src/app/GoogleMapCanvas.module.sass');
  const map = await read('../src/app/GoogleMapCanvas.tsx');
  const mapBlock = layout.slice(
    layout.indexOf('\n.map\n'),
    layout.indexOf('.content[data-map-visible]'),
  );
  assert.match(mapBlock, /background: var\(--color-text\)/);
  assert.match(canvas, /\.canvas\n[\s\S]*?background: var\(--color-text\)/);
  assert.match(canvas, /\.canvas\[data-map-ready\]\n  \.viewport,\n  \.controls\n    opacity: 1/);
  assert.match(map, /addListener\?\.\('tilesloaded'/);
  assert.match(map, /setAttribute\('data-map-ready', ''\)/);
});

test('map open always animates from the laid-out closed state', async () => {
  const experience = await read('../src/app/MapExperience.tsx');
  assert.match(
    experience,
    /useLayoutEffect\(\(\) => \{\n    if \(!mapOpen \|\| !mapMounted \|\| mapVisible\) return;\n    mapSectionRef\.current\?\.getBoundingClientRect\(\);\n    setMapVisible\(true\);/,
  );
  assert.doesNotMatch(experience, /requestAnimationFrame\(\(\) => setMapVisible/);
});

test('maps API is warmed on intent, chunk on idle, connections preconnected, no request APIs', async () => {
  const experience = await read('../src/app/MapExperience.tsx');
  const loader = await read('../src/lib/googleMapsLoader.ts');
  assert.match(experience, /preconnect\('https:\/\/maps\.googleapis\.com'\)/);
  assert.match(experience, /whenIdle\(\(\) => void loadGoogleMapCanvas\(\)\)/);
  assert.match(experience, /closest\?\.\('\[data-map-toggle\]'\)\) warmMap\(\)/);
  assert.match(loader, /export const warmGoogleMaps/);
  // ISR: city pages must not read the request
  assert.doesNotMatch(experience, /headers\(\)|cookies\(\)/);
});

test('the map canvas stays mounted after the first open, so reopening reuses the map', async () => {
  const experience = await read('../src/app/MapExperience.tsx');
  assert.match(experience, /\{mapCreated && \(\n\s*<section/);
  assert.match(experience, /dispatchEvent\(new CustomEvent\(MAP_CLOSED_EVENT\)\)/);
  const map = await read('../src/app/GoogleMapCanvas.tsx');
  assert.match(map, /addEventListener\(MAP_CLOSED_EVENT, onMapClosed\)/);
});

test('card details load on demand from the city details route, JSON-LD is capped', async () => {
  const grid = await read('../src/app/EventsGrid.tsx');
  const detail = await read('../src/app/EventCardDetail.tsx');
  const { eventDetailsPath, eventCardDetailFor } = await import(
    new URL('../src/lib/eventDetails.ts', import.meta.url)
  );
  assert.equal(eventDetailsPath('kyoto', 'ja'), '/api/event-details/kyoto/ja/');
  assert.match(grid, /detailsUrl=\{eventDetailsPath\(city, locale\)\}/);
  assert.doesNotMatch(grid, /description=\{event\.description\}/);
  assert.match(detail, /useEventCardDetail\(eventId, expanded\)/);
  const data = eventCardDetailFor({
    id: 'a',
    description: 'Text',
    mapsUrl: 'm',
    sourceUrl: 's',
    appleCalendar: null,
    googleCalendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&details=Text',
  });
  assert.equal(new URL(data.googleCalendarUrl).searchParams.has('details'), false);
  const { structuredData, CITY_STRUCTURED_DATA_LIMIT } = await import(
    new URL('../src/lib/seo.ts', import.meta.url)
  );
  const events = Array.from({ length: 30 }, (_, i) => ({
    name: `E${i}`,
    startDate: '2026-11-11',
    endDate: null,
    place: null,
    address: null,
    image: null,
    url: null,
  }));
  assert.equal(
    structuredData({ city: 'kyoto', locale: 'en', events }).mainEntity.itemListElement.length,
    CITY_STRUCTURED_DATA_LIMIT,
  );
});

test('map: markers follow visible cards via one index, hover labels, fit to filters, theme', async () => {
  const map = await read('../src/app/GoogleMapCanvas.tsx');
  const markerStyles = await read('../src/app/GoogleMapCanvas.module.sass');
  assert.match(map, /const cardsByLocation = \(\) =>/);
  assert.doesNotMatch(map, /matchesFilterState|categories/);
  assert.match(map, /map\.fitBounds\(bounds, FIT_PADDING\)/);
  assert.match(map, /addListener\?\.\('dragstart', markUserMoved\)/);
  assert.match(map, /mapTypeId: 'roadmap'/);
  assert.match(map, /dark \? ColorScheme\?\.DARK : ColorScheme\?\.LIGHT/);
  assert.match(markerStyles, /@media \(hover: hover\)\n  \.marker:hover/);
});

test('header is split: motion hooks, wordmark, URL hash and the dev-only venue panel', async () => {
  const header = await read('../src/app/SiteHeader.tsx');
  assert.match(header, /from '\.\/header\/headerMotion'/);
  assert.match(header, /useFilterHash\(\{/);
  assert.match(header, /dynamic\(\(\) => import\('\.\/header\/DevVenuePanel'\)\)/);
  assert.doesNotMatch(header, /from 'gsap'/);
  assert.match(header, /applyCardFilters\(\{/);
});
