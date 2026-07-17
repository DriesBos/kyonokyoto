import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWebFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public pages expose crawlable, canonical, localized metadata', async () => {
  const layout = await readWebFile('src/layouts/BaseLayout.astro');
  const landing = await readWebFile('src/components/Landing.astro');
  const robots = await readWebFile('src/pages/robots.txt.ts');
  const sitemap = await readWebFile('src/pages/sitemap.xml.ts');

  assert.doesNotMatch(layout, /noindex|nofollow/);
  assert.match(layout, /rel="canonical"/);
  assert.match(layout, /hreflang="x-default"/);
  assert.match(layout, /application\/ld\+json/);
  assert.match(layout, /twitter:title/);
  assert.match(landing, /<h1 class="landing__heading">/);
  assert.match(robots, /Allow: \/.*Sitemap:/s);
  assert.match(sitemap, /cityConfigs\.flatMap/);
  assert.match(sitemap, /hreflang="x-default"/);
});
