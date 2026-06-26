import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const componentPath = resolve(import.meta.dirname, '../src/components/Landing.astro');
const scriptPath = resolve(import.meta.dirname, '../src/scripts/landingSlider.ts');

test('landing slider styles target JS-created elements globally', async () => {
  const component = await readFile(componentPath, 'utf8');

  for (const selector of [
    '.landing__slide',
    '.landing__slide img',
    '.landing__slide[data-active]',
    '.landing__shutter-row',
    '.landing__shutter-fill',
  ]) {
    assert.match(
      component,
      new RegExp(`:global\\(${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
      `${selector} must be global because landingSlider.ts creates it at runtime`,
    );
  }
});

test('landing shutter fill can cover from bottom to top', async () => {
  const component = await readFile(componentPath, 'utf8');
  const script = await readFile(scriptPath, 'utf8');

  assert.match(component, /:global\(\.landing__shutter-fill\[data-fill-origin='bottom'\]\)/);
  assert.match(component, /bottom: 0/);
  assert.match(script, /animateFills\('100%', coverSeconds, 'bottom'\)/);
});
