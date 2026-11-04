import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../src/app/', import.meta.url);
const lib = new URL('../src/lib/', import.meta.url);

test('production route renders block cards with groups, maps, and box-cluster dividers', async () => {
  const [component, page, styles, events] = await Promise.all([
    readFile(new URL('EventsGrid.tsx', app), 'utf8'),
    readFile(new URL('CityEventsPage.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
    readFile(new URL('cityEvents.ts', lib), 'utf8'),
  ]);

  assert.match(events, /imageUrls: string\[\]/);
  assert.match(events, /\.filter\(Boolean\)\.slice\(0, 3\)/);
  assert.match(component, /groupOrder = \['ongoing', 'upcoming', 'permanent'\]/);
  assert.match(component, /<BoxCluster/);
  assert.match(component, /data-event-card/);
  assert.match(component, /data-map-location-id/);
  assert.match(component, /<EventCardMedia/);
  assert.match(component, /<EventCardDetail/);
  assert.match(page, /<BlocksLanding/);
  assert.match(page, /<MapExperience/);
  assert.match(page, /<EventsGrid/);
  assert.match(
    styles,
    /--cols: var\(--block-cols, max\(1, calc\(var\(--cols-default, 5\) \+ var\(--grid-density, 0\)\)\)\)/,
  );
  assert.match(styles, /grid-column: span min\(var\(--block-expanded-span, 2\), var\(--cols\)\)/);
});

test('block controls remain accessible and legacy routes canonicalize', async () => {
  const [themeStyles, blocks, blockStyles, cityPage, proxy] = await Promise.all([
    readFile(new URL('ThemeButton.module.sass', app), 'utf8'),
    readFile(new URL('blocks/BlockControls.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
    readFile(new URL('[city]/(single)/page.tsx', app), 'utf8'),
    readFile(new URL('../proxy.ts', app), 'utf8'),
  ]);

  assert.match(themeStyles, /display: flex/);
  assert.match(themeStyles, /gap: 1rem/);
  assert.match(themeStyles, /\.stepButton[\s\S]*color: var\(--color-text\)/);
  // the hold-for-3-seconds dot and its prototype drawer are gone (Dries 2026-11-04)
  assert.doesNotMatch(blocks, /ControlPanel|DebugControls|<ThemeButton|onLongPress/);
  assert.match(
    proxy,
    /normalizeCity\(request\.cookies\.get\(CITY_COOKIE\)\?\.value\) \?\? 'kyoto'/,
  );
  assert.match(proxy, /citySupportsLocale\(city, requestedLocale\)/);
  assert.match(proxy, /routePathFor\(\{ city: city\.slug, locale \}\)/);
  assert.match(cityPage, /redirect\(routePathFor\(\{ city: city\.slug, locale \}\)\)/);
  assert.match(blocks, /aria-label="Show fewer items per row"/);
  assert.match(blocks, /aria-label="Show more items per row"/);
  assert.match(blocks, /style\.setProperty\('--block-cols', String\(next\)\)/);
  assert.match(
    blocks,
    /style\.setProperty\('--block-expanded-span', String\(Math\.min\(next, 2\)\)\)/,
  );
  assert.match(
    blockStyles,
    /--cols: var\(--block-cols, max\(1, calc\(var\(--cols-default, 5\) \+ var\(--grid-density, 0\)\)\)\)/,
  );
  assert.match(
    blockStyles,
    /gap: var\(--block-gap-y, calc\(.*--block-lift, 2\) \+ var\(--space\)\)\) var\(--block-gap-x, calc\(/,
  );
  assert.match(blockStyles, /--space: clamp\(12px, calc\(6px \+ \.78125cqi\), 16px\)/);
  assert.match(
    blockStyles,
    /@container \(max-width: 768px\)\n  \.grid\n    --grid-side-gap: var\(--space\)/,
  );
  assert.match(
    blockStyles,
    /grid-column: span min\(var\(--block-expanded-span, 2\), var\(--cols\)\)/,
  );
});
