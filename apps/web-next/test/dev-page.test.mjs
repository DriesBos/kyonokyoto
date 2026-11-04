import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../src/app/', import.meta.url);

test('dev tools only exist outside production, and the header has no dev button', async () => {
  const [flag, landing, header, seo] = await Promise.all([
    readFile(new URL('../src/lib/devPage.ts', import.meta.url), 'utf8'),
    readFile(new URL('dev/landing/page.tsx', app), 'utf8'),
    readFile(new URL('SiteHeader.tsx', app), 'utf8'),
    readFile(new URL('../src/lib/seo.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(flag, /DEV_PAGE_ENABLED = process\.env\.NODE_ENV !== 'production'/);
  assert.match(landing, /if \(!DEV_PAGE_ENABLED\) notFound\(\)/);
  assert.doesNotMatch(seo, /\/dev/);
  assert.doesNotMatch(header, /DEV_PAGE|label="dev"/);
});

test('city theme colours match the sass palette', async () => {
  const { cityConfigs } = await import('../src/lib/cities.ts');
  const variables = await readFile(
    new URL('../src/styles/variables.sass', import.meta.url),
    'utf8',
  );
  for (const { slug, themeColor } of cityConfigs) {
    assert.match(variables, new RegExp(`\\$color-${slug}: ${themeColor}\\n`));
  }
});
