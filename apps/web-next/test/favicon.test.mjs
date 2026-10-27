import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { faviconDataUrl, faviconPath, staticFaviconSvg } = await import('../src/lib/favicon.ts');
const { LIGHT_BACKGROUND } = await import('../src/lib/colorScheme.ts');
const { cityConfigs } = await import('../src/lib/cities.ts');
const { buildMetadata } = await import('../src/lib/seo.ts');

test('Static city favicons match the generator', async () => {
  for (const { slug, themeColor } of cityConfigs) {
    const file = await readFile(new URL(`../public${faviconPath(slug)}`, import.meta.url), 'utf8');
    assert.equal(file, staticFaviconSvg(slug));
    assert.ok(file.includes(`stroke="${themeColor}"`));
    assert.ok(file.includes(`fill="${LIGHT_BACKGROUND}"`));
    // Pages always load light, so the static icon has no dark variant.
    assert.doesNotMatch(file, /prefers-color-scheme/);
  }
});

test('City metadata points at its own favicon', () => {
  const icons = buildMetadata({ city: 'osaka', locale: 'en' }).icons.icon;
  assert.equal(icons[0].url, '/favicons/osaka.svg');
});

test('Live favicon is an SVG data URL with the given colours', () => {
  const svg = decodeURIComponent(faviconDataUrl('#7d4cff', '#0b0910').split(',')[1]);
  assert.match(svg, /<rect width="16" height="16" fill="#0b0910"\/>/);
  assert.equal(svg.match(/stroke="#7d4cff"/g).length, 5);
});
