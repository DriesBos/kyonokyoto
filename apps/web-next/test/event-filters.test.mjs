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

test('saved block sits above the when row, map reads saved from the filter store', async () => {
  const header = await readFile(new URL('../src/app/SiteHeader.tsx', import.meta.url), 'utf8');
  const map = await readFile(new URL('../src/app/GoogleMapCanvas.tsx', import.meta.url), 'utf8');
  assert.match(header, /data-saved-filter[\s\S]*aria-label="when"/);
  assert.match(header, /categories: Array\.from\(activeFilters\)/);
  assert.doesNotMatch(map, /data-starred-button/);
  // the header re-applies (and publishes) on star changes; the map follows the store
  assert.match(header, /\}, \[activeFilters, activeTiming, activeVenues, savedActive, starredIds\]\);/);
  assert.match(header, /publishAppliedFilters\(/);
  assert.match(map, /const \{ saved \} = getAppliedFilters\(\)/);
  assert.match(map, /subscribeAppliedFilters\(/);
  assert.doesNotMatch(map, /pressedFilterState|event-filter:updated/);
});

test('header filter rows: when, type, sub-picks per picked type, venue', async () => {
  const header = await readFile(new URL('../src/app/SiteHeader.tsx', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/lib/cityEvents.ts', import.meta.url), 'utf8');
  assert.match(header, /aria-label="when"[\s\S]*aria-label="type"[\s\S]*data-sub-filters[\s\S]*aria-label="venue"/);
  assert.match(header, /Unpicking a type also drops its sub-picks/);
  assert.match(events, /timings: useful\(events, \['ending', 'ongoing', 'upcoming', 'permanent'\]/);
  assert.match(events, /count > 0 && count < scope\.length/);
});

test('city pages open with art and architecture picked, only when they have a button', async () => {
  const { defaultCityFilterTokens } = await import('../src/lib/eventFilters.ts');
  assert.deepEqual(defaultCityFilterTokens({ types: ['art', 'architecture', 'historic', 'garden'] }), [
    'type:art',
    'type:architecture',
  ]);
  assert.deepEqual(defaultCityFilterTokens({ types: ['architecture', 'historic'] }), ['type:architecture']);
  // a page where every event is art has no type buttons: nothing is picked
  assert.deepEqual(defaultCityFilterTokens({ types: [] }), []);

  const page = await readFile(new URL('../src/app/CityEventsPage.tsx', import.meta.url), 'utf8');
  const header = await readFile(new URL('../src/app/SiteHeader.tsx', import.meta.url), 'utf8');
  const grid = await readFile(new URL('../src/app/EventsGrid.tsx', import.meta.url), 'utf8');
  assert.match(page, /defaultFilters={defaultFilters}/);
  assert.match(page, /initialFilters={defaultFilters}/);
  // a language switch keeps the reader's own picks (even none) over the default
  assert.match(header, /handoff \? handoff\.categories\.filter\(isFilterToken\) : defaultFilters/);
  assert.match(grid, /hidden={startsHidden\(event\)}/);
});

test('filter picks round-trip through the URL hash; defaults give a clean URL', async () => {
  const { filterHashFor, filtersFromHash, pickableFilters } = await import(
    new URL('../src/lib/eventFilters.ts', import.meta.url)
  );
  const defaults = ['type:art', 'type:architecture'];
  assert.equal(filterHashFor({ tokens: ['type:architecture', 'type:art'], timing: '' }, defaults), '');
  assert.equal(filterHashFor({ tokens: [], timing: '' }, defaults), 'all');
  const hash = filterHashFor(
    { tokens: ['type:art', 'sub:art:photography', 'place:museum'], timing: 'ending' },
    defaults,
  );
  assert.equal(hash, 'type=art&sub=art:photography&place=museum&when=ending');
  assert.deepEqual(filtersFromHash(`#${hash}`), {
    tokens: ['type:art', 'sub:art:photography', 'place:museum'],
    timing: 'ending',
  });
  assert.deepEqual(filtersFromHash('#all'), { tokens: [], timing: '' });
  assert.equal(filtersFromHash('#events'), null);
  assert.equal(filtersFromHash(''), null);
  // picks without a button on the page are dropped
  const options = { timings: ['ongoing'], types: ['art'], openTypes: [], subs: { art: ['painting'] }, places: [] };
  assert.deepEqual(
    pickableFilters({ tokens: ['type:art', 'type:garden', 'sub:art:photography', 'sub:art:painting', 'place:museum'], timing: 'ending' }, options),
    { tokens: ['type:art', 'sub:art:painting'], timing: '' },
  );
});

test('per-event mediums from the crawler replace the venue mediums, venue stays the fallback', async () => {
  const { withEventMediums } = await import(new URL('../src/lib/eventMediums.ts', import.meta.url));
  const venue = ['venue_category:gallery', 'display_category:photography', 'display_category:painting', 'event_category:exhibition'];
  assert.deepEqual(withEventMediums(venue, null), venue);
  // no marker: older rows keep the venue's mediums
  assert.deepEqual(withEventMediums(venue, ['display_category:sculpture']), venue);
  assert.deepEqual(
    withEventMediums(venue, ['venue_category:gallery', 'display_category:sculpture', 'medium_check:abc']),
    ['venue_category:gallery', 'event_category:exhibition', 'display_category:sculpture'],
  );
  // checked, nothing found: venue fallback
  assert.deepEqual(withEventMediums(venue, ['venue_category:gallery', 'medium_check:abc']), venue);
  assert.deepEqual(
    filterTagsFor(withEventMediums(venue, ['display_category:sculpture', 'medium_check:abc'])),
    ['type:art', 'sub:art:sculpture', 'place:gallery'],
  );
});
