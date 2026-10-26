import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { DARK_BACKGROUNDS, colorSchemeInitScript, contrastRatio } = await import(
  '../src/lib/colorScheme.ts'
);
const { cityConfigs } = await import('../src/lib/cities.ts');

test('Colour scheme init script only sets light or dark', () => {
  const run = (stored) => {
    const attributes = {};
    const document = { documentElement: { setAttribute: (k, v) => (attributes[k] = v) } };
    const localStorage = { getItem: () => stored };
    new Function('document', 'localStorage', colorSchemeInitScript)(document, localStorage);
    return attributes['data-color-scheme'];
  };
  assert.equal(run('dark'), 'dark');
  assert.equal(run('light'), 'light');
  assert.equal(run('blue'), undefined);
  assert.equal(run(null), undefined);
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
