import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = new URL('../src/components/EventCard.astro', import.meta.url);

test('event card title is clamped to three lines until the card is active', async () => {
  const component = await readFile(componentPath, 'utf8');
  const titleRule =
    component.match(/\n    &__title\s*\n(?<body>(?:      .+\n)+)/)?.groups?.body ?? '';
  const activeTitleRule =
    component.match(/&\[data-active='true'\] \.event-card__title\s*\n(?<body>(?:      .+\n)+)/)
      ?.groups?.body ?? '';

  assert.match(titleRule, /display: -webkit-box/);
  assert.match(titleRule, /-webkit-box-orient: vertical/);
  assert.match(titleRule, /-webkit-line-clamp: 3/);
  assert.match(titleRule, /overflow: hidden/);
  assert.match(activeTitleRule, /display: block/);
  assert.match(activeTitleRule, /-webkit-line-clamp: unset/);
  assert.match(activeTitleRule, /overflow: visible/);
});

test('event card exposes normalized dates as semantic time elements', async () => {
  const component = await readFile(componentPath, 'utf8');

  assert.match(component, /<time datetime=\{dateParts\.startDate\}>/);
  assert.match(component, /<time datetime=\{dateParts\.endDate\}>/);
  assert.match(component, /formatEventDateParts\(event\.start_date, event\.end_date/);
});
