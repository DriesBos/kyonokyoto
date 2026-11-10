import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const descriptions = readJson('../../../data/venue-descriptions.json');
const cities = ['kyoto', 'osaka', 'tokyo', 'hong-kong'];
const japaneseCities = new Set(['kyoto', 'osaka', 'tokyo']);

// Same rule as venueSourceFor in src/lib/cityEvents.ts, with beta sources included.
const venueSlugsFor = (city) => {
  const payload = readJson(`../../../data/sources/${city}-sources.json`);
  const sources = Array.isArray(payload) ? payload : payload.sources;
  return sources
    .filter((source) => source.source_kind !== 'aggregator' && source.is_active !== false)
    .map((source) => source.slug);
};

for (const city of cities) {
  test(`every ${city} venue page has a written introduction`, () => {
    const slugs = venueSlugsFor(city);
    assert.ok(slugs.length > 0);
    for (const slug of slugs) {
      const entry = descriptions[slug];
      assert.ok(entry, `${slug} has no description`);
      assert.ok(entry.en?.trim(), `${slug} has no en description`);
      if (japaneseCities.has(city)) assert.ok(entry.ja?.trim(), `${slug} has no ja description`);
    }
  });
}

test('venue introductions contain no placeholder text', () => {
  for (const [slug, entry] of Object.entries(descriptions)) {
    for (const text of Object.values(entry)) {
      assert.doesNotMatch(text, /lorem/i, `${slug} still holds placeholder text`);
    }
  }
});
