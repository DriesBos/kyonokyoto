import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

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
