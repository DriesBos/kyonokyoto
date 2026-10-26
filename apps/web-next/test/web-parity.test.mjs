import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const app = new URL('../src/app/', import.meta.url);
const lib = new URL('../src/lib/', import.meta.url);

test('every route carries the security headers apps/web sends', async () => {
  const { contentSecurityPolicy, securityHeaders } = await import(new URL('next.config.mjs', root));
  const headers = Object.fromEntries(securityHeaders().map(({ key, value }) => [key, value]));

  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
  assert.match(headers['Content-Security-Policy'], /object-src 'none'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(contentSecurityPolicy(), /unsafe-eval/);
  assert.match(contentSecurityPolicy({ dev: true }), /unsafe-eval/);
});

test('service worker ships and only registers in production', async () => {
  const [worker, layout, register] = await Promise.all([
    readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('RootDocument.tsx', app), 'utf8'),
    readFile(new URL('ServiceWorker.tsx', app), 'utf8'),
  ]);

  // next/font serves the font from /_next/static, so the precache list must not name /fonts.
  assert.doesNotMatch(worker, /\/fonts\//);
  assert.match(worker, /url\.pathname === '\/\.netlify\/images'/);
  assert.match(layout, /<ServiceWorker register=\{process\.env\.NODE_ENV === 'production'\} \/>/);
  assert.match(register, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(register, /registration\.unregister\(\)/);
});

test('beta sources stay out of production and render dimmed in dev', async () => {
  const [events, grid, styles] = await Promise.all([
    readFile(new URL('cityEvents.ts', lib), 'utf8'),
    readFile(new URL('EventsGrid.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
  ]);

  assert.match(events, /const showBeta = \(\) => process\.env\.NODE_ENV !== 'production'/);
  assert.match(events, /showBeta\(\) \|\| !source\.beta/);
  assert.match(events, /showBeta\(\) \|\| !item\.beta/);
  assert.match(events, /beta: Boolean\(truth\.source\?\.beta\)/);
  assert.match(grid, /data-beta=\{event\.beta \|\| undefined\}/);
  assert.match(styles, /\.block\[data-beta\]\n\s+opacity: 0\.5/);
});

test('category filters use dimension-scoped tokens from data/categories.mjs', async () => {
  const events = await readFile(new URL('cityEvents.ts', lib), 'utf8');

  assert.match(events, /flattenTaxonomy\(assertTaxonomy\(taxonomy, owner\)\)/);
  assert.match(events, /parseCategoryToken\(token\)/);
  assert.match(events, /CATEGORY_DIMENSIONS\.indexOf\(left\.dimension\)/);
});

test('Yutaka images go through the in-app proxy route', async () => {
  const route = await readFile(new URL('api/yutaka-image/route.ts', app), 'utf8');
  assert.match(route, /export const GET = \(request: Request\) => proxyYutakaImage\(request\)/);
});

test('Google Analytics loads the apps/web property in production only', async () => {
  const [analytics, layout, config] = await Promise.all([
    readFile(new URL('GoogleAnalytics.tsx', app), 'utf8'),
    readFile(new URL('RootDocument.tsx', app), 'utf8'),
    import(new URL('next.config.mjs', root)),
  ]);

  assert.match(analytics, /G-4EYJPD08Y4/);
  assert.match(analytics, /strategy="lazyOnload"/);
  assert.match(layout, /process\.env\.NODE_ENV === 'production' && <GoogleAnalytics \/>/);
  assert.match(
    config.contentSecurityPolicy(),
    /script-src[^;]*https:\/\/www\.googletagmanager\.com/,
  );
  assert.match(
    config.contentSecurityPolicy(),
    /connect-src[^;]*https:\/\/\*\.google-analytics\.com/,
  );
});
