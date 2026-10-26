import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeGridDensity, stepGridDensity } = await import('../src/lib/gridDensity.ts');

test('Grid density stays one step either side of the default', () => {
  assert.equal(stepGridDensity(0, 1), 1);
  assert.equal(stepGridDensity(1, 1), 1);
  assert.equal(stepGridDensity(0, -1), -1);
  assert.equal(stepGridDensity(-1, -1), -1);
  assert.equal(stepGridDensity(-1, 1), 0);
});

test('Grid density ignores bad values', () => {
  assert.equal(normalizeGridDensity('1'), 1);
  assert.equal(normalizeGridDensity('-1'), -1);
  assert.equal(normalizeGridDensity('7'), 1);
  assert.equal(normalizeGridDensity('nope'), 0);
  assert.equal(normalizeGridDensity(null), 0);
});

test('Grid density is not persisted, so a reload resets it', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const sources = await Promise.all([
    read('../src/lib/gridDensity.ts'),
    read('../src/app/GridDensityControls.tsx'),
    read('../src/app/RootDocument.tsx'),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|gridDensityInitScript/);
  }
});

test('Grid column breakpoints match the block grid styles', async () => {
  const { readFile } = await import('node:fs/promises');
  const { GRID_COLUMN_BREAKPOINTS, columnsForDensity } = await import('../src/lib/gridDensity.ts');
  const styles = await readFile(
    new URL('../src/app/blocks/page.module.sass', import.meta.url),
    'utf8',
  );
  const [widest, ...steps] = GRID_COLUMN_BREAKPOINTS;
  assert.match(styles, new RegExp(`--cols-default, ${widest.columns}\\)`));
  for (const { maxWidth, columns, lockDensity } of steps) {
    for (const rule of ['@media', '@container']) {
      const lock = lockDensity ? '    --grid-density: 0\\n' : '';
      assert.match(
        styles,
        new RegExp(
          `${rule} \\(max-width: ${maxWidth}px\\)\\n  \\.grid\\n    --cols-default: ${columns}\\n${lock}`,
        ),
      );
    }
  }
  assert.equal(columnsForDensity(2, -1), 1);
  assert.equal(columnsForDensity(1, -1), 1);
  assert.equal(columnsForDensity(5, 1), 6);
});

test('card image sizes follow the rendered width, with the default grid as fallback', async () => {
  const { EVENT_CARD_IMAGE_SIZES } = await import('../src/lib/gridDensity.ts');
  assert.equal(
    EVENT_CARD_IMAGE_SIZES,
    'auto, (max-width: 374px) 100vw, (max-width: 800px) 50vw, (max-width: 1100px) 33vw, (max-width: 1440px) 25vw, 20vw',
  );
});
