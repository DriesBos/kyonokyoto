import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { DARK_BACKGROUNDS, contrastRatio } = await import('../src/lib/colorScheme.ts');
const { cityConfigs } = await import('../src/lib/cities.ts');

test('Every page load starts light: no stored or system colour scheme', async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const [globals, toggle, root, favicon] = await Promise.all([
    read('../src/styles/globals.sass'),
    read('../src/app/ColorSchemeToggle.tsx'),
    read('../src/app/RootDocument.tsx'),
    read('../src/app/LiveFavicon.tsx'),
  ]);
  for (const source of [globals, toggle, root, favicon]) {
    assert.doesNotMatch(source, /prefers-color-scheme/);
  }
  assert.doesNotMatch(toggle, /localStorage/);
  assert.doesNotMatch(root, /colorScheme/);
});

test('Dark backgrounds match the sass tokens', async () => {
  const sass = await readFile(new URL('../src/styles/variables.sass', import.meta.url), 'utf8');
  for (const [city, hex] of Object.entries(DARK_BACKGROUNDS)) {
    assert.match(sass, new RegExp(`\\$color-${city}-dark-background: ${hex}\\b`));
  }
});

test('Each city colour keeps at least 3:1 on its dark background', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(0), '21');
  for (const city of cityConfigs) {
    assert.ok(contrastRatio(city.themeColor, DARK_BACKGROUNDS[city.slug]) >= 3, city.slug);
  }
});
