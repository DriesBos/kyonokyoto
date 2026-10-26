import assert from 'node:assert/strict';
import test from 'node:test';

const { boxClusterGrids, boxClusterHold, boxClusterLabels, boxClusterLayout } =
  await import('../src/lib/boxCluster.ts');

test('Box cluster labels capitalise the copy and keep arrows', () => {
  const labels = boxClusterLabels('upcoming', 'get ready!', 'coming soon');
  assert.ok(labels.includes('Upcoming ↓'));
  assert.ok(labels.includes('Get ready!'));
  assert.ok(labels.includes('↓ Coming soon'));
});

test('Box cluster layout is deterministic per seed and scatters boxes over distinct cells', () => {
  const labels = boxClusterLabels('upcoming', 'get ready!', 'coming soon');
  const first = boxClusterLayout(labels, 'kyoto-upcoming');
  assert.deepEqual(first, boxClusterLayout(labels, 'kyoto-upcoming'));
  assert.notDeepEqual(first, boxClusterLayout(labels, 'kyoto-permanent'));
  for (const [name, grid] of Object.entries(boxClusterGrids)) {
    const slots = first.flatMap((box) => (box.slots[name] ? [box.slots[name]] : []));
    assert.equal(slots.length, grid.count);
    assert.equal(new Set(slots.map((slot) => `${slot.col}:${slot.row}`)).size, grid.count);
    for (const slot of slots) {
      assert.ok(slot.col < grid.cols && slot.row < grid.rows);
      assert.ok(slot.x >= 0 && slot.x <= 1 && slot.y >= 0 && slot.y <= 1);
    }
  }
  // smaller layouts reuse the first boxes, so hiding is index based
  assert.ok(first.slice(0, boxClusterGrids.small.count).every((box) => box.slots.small));
  for (const box of first) assert.ok(box.lift >= 0.8 && box.lift <= 2);
});

test('Box cluster holds between 0.7s and 2.5s', () => {
  assert.equal(
    boxClusterHold(() => 0),
    700,
  );
  assert.equal(
    boxClusterHold(() => 1),
    2500,
  );
});
