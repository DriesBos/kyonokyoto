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

test('landing is a fixed overlay dismissed without layout scroll', async () => {
  const component = await readFile(componentPath, 'utf8');
  const scrollScript = await readFile(
    resolve(import.meta.dirname, '../src/scripts/landingScroll.ts'),
    'utf8',
  );

  assert.match(component, /\.landing\s*\n(?:    .+\n)*    position: fixed/);
  assert.doesNotMatch(component, /100[lsd]?vh/);
  assert.doesNotMatch(scrollScript, /mainContentSelector|scrollToMainContent|window\.scrollTo/);
  assert.match(scrollScript, /landing\.hidden = true/);
  assert.match(scrollScript, /landing\.inert = true/);
});

test('landing reappears swiftly after city cycling and only resets on page entry', async () => {
  const script = await readFile(resolve(import.meta.dirname, '../src/scripts/landingScroll.ts'), 'utf8');

  assert.match(script, /cityCycleLandingKey/);
  assert.match(script, /\[data-city-toggle\]/);
  assert.match(script, /sessionStorage\.setItem\(cityCycleLandingKey/);
  assert.match(script, /sessionStorage\.removeItem\(cityCycleLandingKey\)/);
  assert.match(script, /yPercent: -100/);
  assert.match(script, /revealDurationSeconds/);
});

test('city-cycle landing reveal blocks touch and click during animation', async () => {
  const script = await readFile(resolve(import.meta.dirname, '../src/scripts/landingScroll.ts'), 'utf8');

  assert.match(script, /lockLandingInteractions/);
  assert.match(script, /unlockLandingInteractions/);
  assert.match(script, /'click'/);
  assert.match(script, /'touchstart'/);
  assert.match(script, /'touchmove'/);
  assert.match(script, /stopImmediatePropagation/);
  assert.match(script, /preventDefault/);
  assert.match(script, /lockLandingInteractions\(\);\s*gsap\.set\(landing, \{ yPercent: -100 \}\)/);
  assert.match(script, /onComplete: \(\) => \{[\s\S]*unlockLandingInteractions\(\)/);
});

test('landing and header render city-specific brand titles', async () => {
  const landing = await readFile(componentPath, 'utf8');
  const header = await readFile(resolve(import.meta.dirname, '../src/components/Header.astro'), 'utf8');
  const page = await readFile(
    resolve(import.meta.dirname, '../src/pages/[city]/[locale]/index.astro'),
    'utf8',
  );
  const logo = await readFile(resolve(import.meta.dirname, '../src/components/Logo.astro'), 'utf8');

  assert.match(landing, /brandLabel/);
  assert.match(landing, /<Logo label=\{brandLabel\}/);
  assert.match(header, /brandLabel/);
  assert.match(header, /<Logo label=\{brandLabel\}/);
  assert.match(page, /brandLabel=\{cityConfig\.brandLabel\}/);
  assert.match(logo, /logo-wordmark/);
});

test('mobile content keeps events panel scrollable so map has room to grow', async () => {
  const page = await readFile(
    resolve(import.meta.dirname, '../src/pages/[city]/[locale]/index.astro'),
    'utf8',
  );
  const header = await readFile(resolve(import.meta.dirname, '../src/components/Header.astro'), 'utf8');
  const footer = await readFile(resolve(import.meta.dirname, '../src/components/Footer.astro'), 'utf8');

  assert.match(header, /padding-top: max\(0\.5rem, env\(safe-area-inset-top\)\)/);
  assert.match(footer, /padding-bottom: calc\(var\(--page-padding-y\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(page, /100lvh/);
  assert.doesNotMatch(page, /overflow-x: clip/);
  assert.match(
    page,
    /\.content-container\[data-map-visible\] \.events-section\s*\n\s+flex: 1 1 auto\n\s+min-height: 0/,
  );
  assert.doesNotMatch(page, /\.content-container\s*\n(?:      .+\n)*?      height: auto/);
  assert.doesNotMatch(page, /\.events-section\s*\n\s+flex: 0 0 auto\n\s+height: auto/);
});

test('scroll helpers use page fallback when events section is not scrollable', async () => {
  const helper = await readFile(resolve(import.meta.dirname, '../src/scripts/scrollRoot.ts'), 'utf8');
  const files = await Promise.all(
    [
      '../src/components/Footer.astro',
      '../src/components/TimeDivider.astro',
      '../src/scripts/eventCardControls.ts',
      '../src/scripts/eventCardReveal.ts',
      '../src/scripts/googleMap.ts',
      '../src/scripts/headerControls.ts',
      '../src/scripts/youtubeAmbient.ts',
    ].map((path) => readFile(resolve(import.meta.dirname, path), 'utf8')),
  );

  assert.match(helper, /scrollRootFor/);
  assert.match(helper, /scrollHeight > element\.clientHeight \+ 1/);
  files.forEach((source) => assert.match(source, /scrollRootFor/));
});
