import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWebFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('event SSR query filters city and requested locale without schema fallback ladder', async () => {
  const events = await readWebFile('src/lib/events.ts');
  const page = await readWebFile('src/pages/[city]/[locale]/index.astro');

  assert.match(events, /\.eq\('city', city\)/);
  assert.match(events, /\.eq\('event_translations\.locale', locale\)/);
  assert.match(events, /schedule_type, occurrence_dates/);
  assert.doesNotMatch(events, /selectAttempts|eventSelectWithoutCoordinates/);
  assert.match(page, /fetchPublishedEvents\(\{ city, locale \}\)/);
  assert.doesNotMatch(page, /data-locale-payload|displayEventsByLocale/);
});

test('locale switch uses route navigation and viewport keeps browser zoom', async () => {
  const header = await readWebFile('src/components/Header.astro');
  const layout = await readWebFile('src/layouts/BaseLayout.astro');

  assert.match(header, /href=\{localePathFor\(nextLocale\)\}/);
  assert.doesNotMatch(header, /initLocaleToggle|data-locale-option/);
  assert.match(layout, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(layout, /maximum-scale|user-scalable/);
});

test('time divider repeats native text without inline SVG nodes', async () => {
  const divider = await readWebFile('src/components/TimeDivider.astro');

  assert.match(divider, /repeatedTrackText/);
  assert.match(divider, /↓/);
  assert.doesNotMatch(divider, /<Icon|<svg/);
  assert.match(divider, /timeline\.fromTo\(track/);
});

test('map marker inserts source names as text', async () => {
  const map = await readWebFile('src/scripts/googleMap.ts');

  assert.match(map, /label\.textContent = source\.name/);
  assert.doesNotMatch(map, /map-marker__label[^\n]*\$\{source\.name\}/);
});

test('event cards use sibling disclosure control and native inert content', async () => {
  const card = await readWebFile('src/components/EventCard.astro');
  const controls = await readWebFile('src/scripts/eventCardControls.ts');
  const article = card.match(/<article(?<attributes>[\s\S]*?)>/)?.groups?.attributes ?? '';

  assert.doesNotMatch(article, /role="button"|tabindex=|aria-pressed=/);
  assert.match(card, /data-event-card-disclosure/);
  assert.match(card, /aria-expanded="false"/);
  assert.match(card, /aria-controls=\{cardDetailsId\}/);
  assert.match(card, /aria-hidden="true"\s+inert/);
  assert.match(controls, /const cardSelector = '\[data-event-card\]'/);
  assert.match(controls, /disclosure\.setAttribute\('aria-expanded', String\(isActive\)\)/);
  assert.match(controls, /content\.toggleAttribute\('inert', !isActive\)/);
  assert.match(controls, /content\.setAttribute\('aria-hidden', String\(!isActive\)\)/);
  assert.doesNotMatch(controls, /card\.setAttribute\('aria-pressed'/);
});
