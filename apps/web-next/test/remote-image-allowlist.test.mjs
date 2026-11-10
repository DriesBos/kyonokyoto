import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { remoteImagePatterns } = await import('../next.config.mjs');
const { imageCdnAllowsSource } = await import('../src/lib/mediaDelivery.ts');

const toml = await readFile(new URL('../../../netlify.toml', import.meta.url), 'utf8');
const patterns = remoteImagePatterns(toml).map((pattern) => new RegExp(`^(?:${pattern})$`));

test('remote image allowlist: every netlify.toml entry is read, TOML escapes undone', () => {
  const block = toml.split('remote_images = [')[1].split(']')[0];
  assert.equal(patterns.length, (block.match(/^\s*"/gm) ?? []).length);
  assert.ok(patterns.length > 100);
  assert.ok(remoteImagePatterns(toml).every((pattern) => !pattern.includes('\\\\')));
});

test('remote image allowlist: listed hosts use the CDN, new hosts load directly', () => {
  assert.equal(imageCdnAllowsSource('https://4-6-4-9.jp/a.jpg', patterns), true);
  assert.equal(
    imageCdnAllowsSource('https://kyotoshunju.com/sL7hryut/wp-content/uploads/x.jpg', patterns),
    true,
  );
  assert.equal(imageCdnAllowsSource('https://kyotoshunju.com/other/x.jpg', patterns), false);
  assert.equal(imageCdnAllowsSource('https://new-gallery.example/x.jpg', patterns), false);
  // the dot is escaped, so look-alike hosts do not match
  assert.equal(imageCdnAllowsSource('https://4-6-4-9xjp/a.jpg', patterns), false);
  assert.equal(imageCdnAllowsSource('/venues/some-venue.jpg', patterns), true);
  // no allowlist known (tests, local dev): keep using the CDN
  assert.equal(imageCdnAllowsSource('https://new-gallery.example/x.jpg', null), true);
});
