import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWebFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('time dividers refresh after scroller content shifts and lazy media settles', async () => {
  const divider = await readWebFile('src/components/TimeDivider.astro');

  assert.match(divider, /const layoutRefreshDelayMs = 80/);
  assert.match(divider, /addEventListener\('load', this\.handleMediaSettled, true\)/);
  assert.match(divider, /addEventListener\('error', this\.handleMediaSettled, true\)/);
  assert.match(divider, /this\.resizeObserver\.observe\(layoutRoot\)/);
  assert.match(divider, /Array\.from\(layoutRoot\.children\)\.forEach/);
  assert.match(divider, /this\.resizeObserver\?\.observe\(child\)/);
  assert.match(divider, /const nextScrollRoot = this\.getScrollRoot\(\)/);
  assert.match(divider, /nextScrollRoot !== this\.activeScrollRoot/);
  assert.match(divider, /this\.activeScrollRoot = scrollRoot/);
});

test('footer is half a viewport tall and renders current city', async () => {
  const footer = await readWebFile('src/components/Footer.astro');
  const page = await readWebFile('src/pages/[city]/[locale]/index.astro');

  assert.match(footer, /cityLabel\?: string/);
  assert.match(footer, /<p>Enjoy \{cityLabel\} Culture<\/p>/);
  assert.match(footer, /\.site-footer\s*\n(?:    .+\n)*?    flex: 0 0 50vh/);
  assert.match(footer, /\.site-footer\s*\n(?:    .+\n)*?    height: 50vh/);
  assert.match(footer, /\.site-footer__credit\s*\n\s+padding-left: var\(--page-padding-x\)/);
  assert.match(page, /<Footer cityLabel=\{cityConfig\.label\} \/>/);
});
