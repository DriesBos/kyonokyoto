import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function selectSourcesForSync(sources, requestedSlugs, pruneRequested = false) {
  if (!requestedSlugs) return sources;
  if (pruneRequested) throw new Error('Scoped source sync cannot prune');
  const slugs = [
    ...new Set(
      requestedSlugs
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  ];
  if (!slugs.length) throw new Error('Scoped source sync requires at least one source slug');
  const missing = slugs.filter((slug) => !sources.some((source) => source.slug === slug));
  if (missing.length) throw new Error(`Unknown source slugs: ${missing.join(', ')}`);
  return sources.filter((source) => slugs.includes(source.slug));
}

export function isLargePruneDiff(removedCount, existingCount) {
  return removedCount >= 5 || (removedCount > 0 && removedCount / existingCount >= 0.25);
}

export function assertPruneAllowed({
  configuredCount,
  existingCount,
  removedCount,
  confirmedCount,
  allowLargePrune,
}) {
  if (configuredCount === 0) {
    throw new Error('Refusing to prune from an empty source config');
  }

  if (removedCount === 0) return;

  if (confirmedCount !== removedCount) {
    throw new Error(`Prune requires --confirm-prune=${removedCount}`);
  }

  if (isLargePruneDiff(removedCount, existingCount) && !allowLargePrune) {
    throw new Error(
      `Prune would remove ${removedCount}/${existingCount} sources; add --allow-large-prune`,
    );
  }
}

function demo() {
  const fixtures = [{ slug: 'one' }, { slug: 'two' }, { slug: 'three' }];
  assert.deepEqual(selectSourcesForSync(fixtures, 'one,three'), [fixtures[0], fixtures[2]]);
  assert.throws(() => selectSourcesForSync(fixtures, 'missing'), /Unknown source/);
  assert.throws(() => selectSourcesForSync(fixtures, 'one', true), /cannot prune/);
  assert.equal(selectSourcesForSync(fixtures, null), fixtures);
  assert.doesNotThrow(() =>
    assertPruneAllowed({
      configuredCount: 49,
      existingCount: 50,
      removedCount: 1,
      confirmedCount: 1,
      allowLargePrune: false,
    }),
  );
  assert.throws(() =>
    assertPruneAllowed({
      configuredCount: 0,
      existingCount: 50,
      removedCount: 50,
      confirmedCount: 50,
      allowLargePrune: true,
    }),
  );
  assert.throws(() =>
    assertPruneAllowed({
      configuredCount: 49,
      existingCount: 50,
      removedCount: 1,
      confirmedCount: 0,
      allowLargePrune: false,
    }),
  );
  assert.throws(() =>
    assertPruneAllowed({
      configuredCount: 40,
      existingCount: 50,
      removedCount: 10,
      confirmedCount: 10,
      allowLargePrune: false,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) demo();
