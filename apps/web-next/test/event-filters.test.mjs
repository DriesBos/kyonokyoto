import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { filterTagsFor, matchesFilterState, CATEGORY_REGISTRY } = await import(
  new URL('../../../data/categories.mjs', import.meta.url)
);

test('filter tags derive type, sub-picks and venue from existing taxonomy tokens', () => {
  assert.deepEqual(
    filterTagsFor(['venue_category:gallery', 'display_category:photography', 'event_category:exhibition']),
    ['type:art', 'sub:art:photography', 'place:gallery'],
  );
  // an architecture festival is architecture only, still a festival
  assert.deepEqual(
    filterTagsFor(['venue_category:festival', 'display_category:architecture', 'event_category:festival']),
    ['type:architecture', 'place:festival'],
  );
  // temple openings stay historic (not art); temple/shrine/palace come from the venue name
  assert.deepEqual(
    filterTagsFor(
      ['venue_category:historic-site', 'venue_category:garden', 'event_category:special-opening', 'event_category:exhibition'],
      { venueNames: ['清水寺'] },
    ),
    ['type:historic', 'sub:historic:temple', 'type:garden'],
  );
  assert.deepEqual(filterTagsFor(['venue_category:historic-site'], { venueNames: ['Shimogamo Shrine'] }), [
    'type:historic',
    'sub:historic:shrine',
  ]);
  assert.deepEqual(filterTagsFor(['venue_category:historic-site'], { venueNames: ['二条城'] }), [
    'type:historic',
    'sub:historic:palace-castle',
  ]);
  // untagged events fall back to art so a type pick never hides them by accident
  assert.deepEqual(filterTagsFor([]), ['type:art']);
  assert.ok(!CATEGORY_REGISTRY.venue_category.includes('temple'));
});

test('filters: OR within a row, AND across rows, a sub-pick narrows only its type', () => {
  const photoGallery = ['type:art', 'sub:art:photography', 'place:gallery'];
  const paintingMuseum = ['type:art', 'sub:art:painting', 'place:museum'];
  const temple = ['type:historic', 'sub:historic:temple'];
  const pick = (state) =>
    Object.entries({ photoGallery, paintingMuseum, temple })
      .filter(([, tags]) => matchesFilterState(tags, state))
      .map(([name]) => name);

  assert.deepEqual(pick({}), ['photoGallery', 'paintingMuseum', 'temple']);
  assert.deepEqual(pick({ types: ['art'] }), ['photoGallery', 'paintingMuseum']);
  assert.deepEqual(pick({ types: ['art'], subs: ['art:photography', 'art:painting'] }), [
    'photoGallery',
    'paintingMuseum',
  ]);
  assert.deepEqual(pick({ types: ['art', 'historic'], subs: ['art:photography'] }), ['photoGallery', 'temple']);
  assert.deepEqual(pick({ types: ['art'], places: ['museum'] }), ['paintingMuseum']);
  // a sub-pick under a type with no button of its own (one type on the page) still applies
  assert.deepEqual(pick({ subs: ['art:painting'] }), ['paintingMuseum']);
});

test('saved filter ANDs with every other row and matches on the card star, not tags', async () => {
  const { filterStateFrom, matchesCard, isFilterToken } = await import('../src/lib/eventFilters.ts');
  const cards = {
    starredPhoto: { tags: ['type:art', 'sub:art:photography', 'place:gallery'], starred: true },
    photo: { tags: ['type:art', 'sub:art:photography', 'place:gallery'], starred: false },
    starredTemple: { tags: ['type:historic', 'sub:historic:temple'], starred: true },
  };
  const pick = (tokens) =>
    Object.entries(cards)
      .filter(([, card]) => matchesCard(card, filterStateFrom(tokens)))
      .map(([name]) => name);
  assert.deepEqual(pick([]), ['starredPhoto', 'photo', 'starredTemple']);
  assert.deepEqual(pick(['saved']), ['starredPhoto', 'starredTemple']);
  assert.deepEqual(pick(['saved', 'type:art']), ['starredPhoto']);
  assert.deepEqual(pick(['saved', 'place:museum']), []);
  assert.deepEqual(pick(['type:art']), ['starredPhoto', 'photo']);
  // a `saved` tag on the server side never counts as starred
  assert.equal(matchesCard({ tags: ['saved', 'type:art'], starred: false }, filterStateFrom(['saved'])), false);
  // saved is not a server filter token, so it never rides the locale handoff
  assert.equal(isFilterToken('saved'), false);
});

test('saved block sits above the when row, map reads the saved token', async () => {
  const header = await readFile(new URL('../src/app/SiteHeader.tsx', import.meta.url), 'utf8');
  const map = await readFile(new URL('../src/app/GoogleMapCanvas.tsx', import.meta.url), 'utf8');
  assert.match(header, /data-saved-filter[\s\S]*aria-label="when"/);
  assert.match(header, /categories: Array\.from\(activeFilters\)/);
  assert.doesNotMatch(map, /data-starred-button/);
  assert.match(map, /filterState\.saved/);
  assert.match(map, /STARS_UPDATED_EVENT, onStarsUpdate/);
});

test('header filter rows: when, type, sub-picks per picked type, venue', async () => {
  const header = await readFile(new URL('../src/app/SiteHeader.tsx', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/lib/cityEvents.ts', import.meta.url), 'utf8');
  assert.match(header, /aria-label="when"[\s\S]*aria-label="type"[\s\S]*data-sub-filters[\s\S]*aria-label="venue"/);
  assert.match(header, /Unpicking a type also drops its sub-picks/);
  assert.match(events, /timings: useful\(events, \['ending', 'ongoing', 'upcoming', 'permanent'\]/);
  assert.match(events, /count > 0 && count < scope\.length/);
});
