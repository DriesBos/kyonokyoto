import assert from 'node:assert/strict';
import test from 'node:test';

const { gridDensityInitScript, normalizeGridDensity, stepGridDensity } =
  await import('../src/lib/gridDensity.ts');

test('Grid density stays one step either side of the default', () => {
  assert.equal(stepGridDensity(0, 1), 1);
  assert.equal(stepGridDensity(1, 1), 1);
  assert.equal(stepGridDensity(0, -1), -1);
  assert.equal(stepGridDensity(-1, -1), -1);
  assert.equal(stepGridDensity(-1, 1), 0);
});

test('Grid density ignores bad stored values', () => {
  assert.equal(normalizeGridDensity('1'), 1);
  assert.equal(normalizeGridDensity('-1'), -1);
  assert.equal(normalizeGridDensity('7'), 1);
  assert.equal(normalizeGridDensity('nope'), 0);
  assert.equal(normalizeGridDensity(null), 0);
});

test('Grid density init script only sets valid steps', () => {
  const run = (stored) => {
    const attributes = {};
    const document = { documentElement: { setAttribute: (k, v) => (attributes[k] = v) } };
    const localStorage = { getItem: () => stored };
    new Function('document', 'localStorage', gridDensityInitScript)(document, localStorage);
    return attributes['data-grid-density'];
  };
  assert.equal(run('1'), '1');
  assert.equal(run('-1'), '-1');
  assert.equal(run('0'), undefined);
  assert.equal(run('5'), undefined);
  assert.equal(run(null), undefined);
});
