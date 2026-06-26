import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { cityConfigFor, cityConfigs, nextCityFor, normalizeCity } from '../src/lib/cities.ts';
import {
  loadAllSourcesConfig,
  loadSourcesConfig,
  validateSourceConfig,
} from '../../../data/sources/source-config.mjs';

const projectRoot = resolve(import.meta.dirname, '../../..');

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), 'utf8'));
}

test('city registry normalizes supported routes and cycles in header order', () => {
  assert.equal(normalizeCity('kyoto'), 'kyoto');
  assert.equal(normalizeCity('Osaka'), 'osaka');
  assert.equal(normalizeCity('tokyo'), 'tokyo');
  assert.equal(normalizeCity('nagoya'), null);

  assert.equal(cityConfigFor('kyoto')?.themeColor, '#138e00');
  assert.equal(cityConfigFor('kyoto')?.label, 'Kyōtō');
  assert.equal(cityConfigFor('kyoto')?.brandLabel, 'Kyō-no-Kyōto');
  assert.equal(cityConfigFor('osaka')?.label, 'Osaka');
  assert.equal(cityConfigFor('osaka')?.brandLabel, 'Kyō-nō-Osaka');
  assert.equal(cityConfigFor('tokyo')?.label, 'Tōkiō');
  assert.equal(cityConfigFor('tokyo')?.brandLabel, 'Kyō-nō-Tōkiō');
  assert.deepEqual(cityConfigFor('tokyo')?.mapCenter, {
    lat: 35.6651,
    lng: 139.7125,
  });
  assert.equal(nextCityFor('kyoto').slug, 'osaka');
  assert.equal(nextCityFor('osaka').slug, 'tokyo');
  assert.equal(nextCityFor('tokyo').slug, 'kyoto');
});

test('each city has source and permanent files', async () => {
  for (const city of cityConfigs) {
    const sources = await readJson(`data/sources/${city.sourceFile}`);
    const permanent = await readJson(`data/permanent/${city.permanentFile}`);

    assert.equal(sources.version, 1);
    assert.ok(Array.isArray(sources.sources));
    assert.equal(permanent.version, 1);
    assert.ok(Array.isArray(permanent.items));
  }
});

test('city source configs validate and inject file city', async () => {
  for (const city of cityConfigs) {
    const sources = await loadSourcesConfig({ city: city.slug });

    for (const source of sources) {
      assert.equal(source.city, city.slug);
      assert.deepEqual(validateSourceConfig(source), []);
    }
  }
});

test('source slugs are globally unique across cities', async () => {
  const sources = await loadAllSourcesConfig();
  const slugs = sources.map((source) => source.slug);

  assert.equal(slugs.length, new Set(slugs).size);
});
