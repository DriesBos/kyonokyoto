import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { mergeSourceProfiles } = await import('../src/lib/sourceProfiles.ts');
const { SOURCE_DISPLAY_KEYS, sourceDisplayProfile } =
  await import('../../../data/sources/source-display.mjs');

const bundled = [
  { slug: 'a', name: 'A (build)', beta: true },
  { slug: 'b', name: 'B (build)' },
];

test('source profiles: no rows keeps the bundled sources', () => {
  assert.equal(mergeSourceProfiles(bundled, null), bundled);
  assert.equal(mergeSourceProfiles(bundled, []), bundled);
});

test('source profiles: Supabase wins per slug and adds new sources', () => {
  const merged = mergeSourceProfiles(bundled, [
    { slug: 'a', profile: { slug: 'a', name: 'A (crawl)' } },
    { slug: 'new-gallery', profile: { name: 'New Gallery', beta: true } },
    { slug: 'broken', profile: {} },
    { slug: 'broken-2', profile: null },
  ]);
  assert.deepEqual(merged, [
    { slug: 'a', name: 'A (crawl)' },
    { slug: 'b', name: 'B (build)' },
    { slug: 'new-gallery', name: 'New Gallery', beta: true },
  ]);
});

test('source profiles: the synced profile covers every field the site reads', async () => {
  const cityEvents = await readFile(new URL('../src/lib/cityEvents.ts', import.meta.url), 'utf8');
  const block = cityEvents.match(/type SourceConfig = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const fields = [...block.matchAll(/^ {2}([a-z_]+)\??:/gm)].map((match) => match[1]);
  assert.ok(fields.length > 10);
  assert.deepEqual(
    fields.filter((field) => !SOURCE_DISPLAY_KEYS.includes(field)),
    [],
    'add new SourceConfig fields to data/sources/source-display.mjs',
  );
});

test('source profiles: crawl internals stay out of the public profile', () => {
  const profile = sourceDisplayProfile({
    slug: 'x',
    name: 'X',
    names: {},
    venue_locations: [],
    selectors: { title: 'h1' },
    crawl_hints: {},
    notes: 'internal',
  });
  assert.deepEqual(profile, { slug: 'x', name: 'X' });
});
