import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWebFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('event SSR query filters city and requested locale without schema fallback ladder', async () => {
  const events = await readWebFile('src/lib/events.ts');
  const page = await readWebFile('src/pages/[city]/[locale]/index.astro');

  assert.match(events, /eventSourceSelect = 'sources\(slug\)'/);
  assert.match(events, /\$\{eventSelect\}, \$\{eventSourceSelect\}, \$\{eventTranslationSelect\}/);
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
  const page = await readWebFile('src/pages/[city]/[locale]/index.astro');

  assert.match(header, /href=\{localePathFor\(nextLocale\)\}/);
  assert.match(header, /showLanguageOption \? \(/);
  assert.match(header, /label=\{languageLabels\[nextLocale\]\}/);
  assert.match(header, /edge=\{showLanguageOption \? undefined : 'last'\}/);
  assert.doesNotMatch(header, /initLocaleToggle|data-locale-option/);
  assert.match(page, /Astro\.response\.headers\.set\('Netlify-Vary', 'country=jp,language=ja'\)/);
  assert.match(layout, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(layout, /maximum-scale|user-scalable/);
});

test('keyboard focus remains visible after pointer-focus reset', async () => {
  const styles = await readWebFile('src/styles/app.sass');

  assert.match(styles, /:focus:not\(:focus-visible\)/);
  assert.match(styles, /:focus-visible[\s\S]*outline: 2px solid currentColor !important/);
});

test('nonce CSP permits the custom cursor and keeps processed scripts external', async () => {
  const { preventJavaScriptInlining } = await import('../astro.config.mjs');
  const config = await readWebFile('astro.config.mjs');
  const layout = await readWebFile('src/layouts/BaseLayout.astro');

  assert.equal(preventJavaScriptInlining('_astro/cursor.js'), false);
  assert.equal(preventJavaScriptInlining('_astro/cursor.mjs'), false);
  assert.equal(preventJavaScriptInlining('_astro/icon.svg'), undefined);
  assert.match(config, /assetsInlineLimit: preventJavaScriptInlining/);
  assert.match(layout, /<script>\s+if \(!window\.__siteCursorBound\)/);
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
  assert.match(map, /marker\.addEventListener\?\.\('gmp-click'/);
  assert.doesNotMatch(map, /marker\.addListener\?\.\('click'/);
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

test('event card media uses native overflow scrolling', async () => {
  const card = await readWebFile('src/components/EventCard.astro');
  const controls = await readWebFile('src/scripts/eventCardControls.ts');

  assert.match(card, /class="event-card__media-track"/);
  assert.match(card, /overflow-x: auto/);
  assert.match(
    card,
    /> \.event-card__disclosure,\s*> \.event-card__star,\s*> \.event-card__media\s*pointer-events: auto/,
  );
  assert.match(card, /&__media-track[\s\S]*?display: flex[\s\S]*?inline-size: max-content/);
  assert.doesNotMatch(card, /touch-action|-webkit-overflow-scrolling|overscroll-behavior-x/);
  assert.doesNotMatch(controls, /mediaPointerState|setPointerCapture|\.scrollLeft\s*=/);
});
