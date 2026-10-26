import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../src/app/', import.meta.url);

test('dev page and its header button only exist outside production', async () => {
  const [flag, page, header, seo] = await Promise.all([
    readFile(new URL('../src/lib/devPage.ts', import.meta.url), 'utf8'),
    readFile(new URL('dev/page.tsx', app), 'utf8'),
    readFile(new URL('SiteHeader.tsx', app), 'utf8'),
    readFile(new URL('../src/lib/seo.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(flag, /DEV_PAGE_ENABLED = process\.env\.NODE_ENV !== 'production'/);
  assert.match(page, /if \(!DEV_PAGE_ENABLED\) notFound\(\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.doesNotMatch(seo, /\/dev/);
  // The dev button sits before filter in the toolbar.
  const devButton = header.indexOf('{DEV_PAGE_ENABLED && (');
  const filterButton = header.indexOf('className={styles.filterToggle}');
  assert.ok(devButton > 0 && devButton < filterButton);
});

test('city theme colours match the sass palette', async () => {
  const { cityConfigs } = await import('../src/lib/cities.ts');
  const variables = await readFile(new URL('../src/styles/variables.sass', import.meta.url), 'utf8');
  for (const { slug, themeColor } of cityConfigs) {
    assert.match(variables, new RegExp(`\\$color-${slug}: ${themeColor}\\n`));
  }
});
