import assert from 'node:assert/strict';
import test from 'node:test';

import { routePathFor, routeStateFromPath, routeUrlWithState } from '../src/lib/routeState.ts';

test('routePathFor builds canonical city and locale path', () => {
  assert.equal(routePathFor({ city: 'tokyo', locale: 'ja' }), '/tokyo/ja/');
});

test('routeStateFromPath reads city and locale from supported route shapes', () => {
  assert.deepEqual(routeStateFromPath('/osaka/ja/'), {
    city: 'osaka',
    locale: 'ja',
  });
  assert.deepEqual(routeStateFromPath('/ja/'), {
    city: null,
    locale: 'ja',
  });
  assert.deepEqual(routeStateFromPath('/unknown/fr/'), {
    city: null,
    locale: null,
  });
});

test('routeUrlWithState preserves current params, search, and hash', () => {
  const current = new URL('https://kyo.example/kyoto/ja/?timing=ongoing#events');

  assert.equal(
    routeUrlWithState(current, { city: 'tokyo' }).toString(),
    'https://kyo.example/tokyo/ja/?timing=ongoing#events',
  );
  assert.equal(
    routeUrlWithState(current, { locale: 'en' }).toString(),
    'https://kyo.example/kyoto/en/?timing=ongoing#events',
  );
});

test('routeUrlWithState uses explicit fallback when current path lacks a city', () => {
  const current = new URL('https://kyo.example/ja/');

  assert.equal(
    routeUrlWithState(current, { locale: 'en' }, { city: 'osaka' }).toString(),
    'https://kyo.example/osaka/en/',
  );
});
