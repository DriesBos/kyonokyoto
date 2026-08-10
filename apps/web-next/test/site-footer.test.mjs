import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../src/app/', import.meta.url);

test('production footer keeps V1 content without the ruled background', async () => {
  const [footer, styles, page, blocksStyles] = await Promise.all([
    readFile(new URL('SiteFooter.tsx', app), 'utf8'),
    readFile(new URL('SiteFooter.module.sass', app), 'utf8'),
    readFile(new URL('CityEventsPage.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
  ]);

  assert.match(footer, /Site by/);
  assert.match(footer, /Enjoy \{cityLabel\} Culture/);
  assert.match(footer, /aria-label=\{uiText\[locale\]\.scrollTop\}/);
  assert.match(footer, /M11\.5024 50\.02/);
  assert.match(styles, /border-bottom: var\(--footer-stroke\) solid currentColor/);
  assert.match(styles, /background: none/);
  assert.doesNotMatch(styles, /repeating-linear-gradient/);
  assert.match(page, /<SiteFooter compact className=\{styles\.blocksFooter\}/);
  assert.match(blocksStyles, /\.blocksFooter[\s\S]*padding-top: 10vmin/);
  assert.match(footer, /className\?: string/);
  assert.match(footer, /compact\?: boolean/);
  assert.match(footer, /\{!compact && \(/);
  assert.match(styles, /\&\[data-compact\][\s\S]*height: auto[\s\S]*position: static/);
});
