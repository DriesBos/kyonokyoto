import { matchesFilterState } from '../../../../data/categories.mjs';

// Header filter state as tokens: type:<type>, sub:<type>:<sub>, place:<place>
// (data/categories.mjs filterTagsFor / matchesFilterState), plus `saved` (starred events only).
// Saved is client-only (lib/eventStars.ts): it matches on card[data-starred], never server tags,
// and never goes into URLs or shareable state.
export type FilterState = { types: string[]; subs: string[]; places: string[]; saved: boolean };

export const SAVED_FILTER_TOKEN = 'saved';
// Sent by the empty state's "unset filters" button; SiteHeader clears every row.
export const FILTER_RESET_EVENT = 'event-filter:reset';

export const isFilterToken = (token: string) => /^(type|sub|place):/.test(token);

// City pages open with these types picked (Dries, 2026-11-11). Only types that have a button on
// the page (FilterOptions.types) are picked, so the default never hides everything and can be unset.
export const DEFAULT_CITY_FILTER_TYPES = ['art', 'architecture'] as const;

export const defaultCityFilterTokens = (options: { types: readonly string[] }) =>
  DEFAULT_CITY_FILTER_TYPES.filter((type) => options.types.includes(type)).map(
    (type) => `type:${type}`,
  );

export const filterStateFrom = (tokens: Iterable<string>): FilterState => {
  const state: FilterState = { types: [], subs: [], places: [], saved: false };
  for (const token of tokens) {
    if (token === SAVED_FILTER_TOKEN) {
      state.saved = true;
      continue;
    }
    const [kind, ...rest] = token.split(':');
    const value = rest.join(':');
    if (kind === 'type') state.types.push(value);
    else if (kind === 'sub') state.subs.push(value);
    else if (kind === 'place') state.places.push(value);
  }
  return state;
};

// One card against every row: rows AND together, saved included.
export const matchesCard = (
  card: { tags: Iterable<string>; starred: boolean },
  state: FilterState,
) =>
  (!state.saved || card.starred) &&
  matchesFilterState(card.tags instanceof Set ? card.tags : new Set(card.tags), state);

// Picked filters live in the URL hash (#type=art,architecture&sub=art:photography&place=museum
// &when=ending), so links share them and reload/back keep them. The hash never reaches the server
// or the CDN cache key. The page's default picks give a clean URL; nothing picked is `#all`.
// Saved and the dev venue filter stay out (client-only).
export type HashFilters = { tokens: string[]; timing: string };

const HASH_KEYS = { type: 'type', sub: 'sub', place: 'place' } as const;
export const ALL_FILTERS_HASH = 'all';

export const filterHashFor = (
  { tokens, timing }: HashFilters,
  defaults: readonly string[],
): string => {
  const sorted = [...tokens].sort();
  if (!timing && sorted.join('|') === [...defaults].sort().join('|')) return '';
  if (!timing && sorted.length === 0) return ALL_FILTERS_HASH;
  const state = filterStateFrom(sorted);
  const params = new URLSearchParams();
  if (state.types.length) params.set(HASH_KEYS.type, state.types.join(','));
  if (state.subs.length) params.set(HASH_KEYS.sub, state.subs.join(','));
  if (state.places.length) params.set(HASH_KEYS.place, state.places.join(','));
  if (timing) params.set('when', timing);
  // keep , and : readable in the address bar
  return params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
};

// null when the hash holds no filters (none, or another anchor such as #events).
export const filtersFromHash = (hash: string): HashFilters | null => {
  const value = hash.replace(/^#/, '');
  if (value === ALL_FILTERS_HASH) return { tokens: [], timing: '' };
  const params = new URLSearchParams(value);
  const list = (key: string) =>
    (params.get(key) ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const tokens = [
    ...list(HASH_KEYS.type).map((type) => `type:${type}`),
    ...list(HASH_KEYS.sub).map((sub) => `sub:${sub}`),
    ...list(HASH_KEYS.place).map((place) => `place:${place}`),
  ];
  const timing = params.get('when') ?? '';
  return tokens.length || timing ? { tokens, timing } : null;
};

// Only picks that have a button on this page count, so an old or edited link never hides
// everything behind a filter the visitor can't unset.
export const pickableFilters = (
  { tokens, timing }: HashFilters,
  options: {
    timings: readonly string[];
    types: readonly string[];
    openTypes: readonly string[];
    subs: Record<string, readonly string[]>;
    places: readonly string[];
  },
): HashFilters => ({
  tokens: tokens.filter((token) => {
    const [kind, first, second] = token.split(':');
    if (kind === 'type') return options.types.includes(first);
    if (kind === 'sub') return (options.subs[first] ?? []).includes(second);
    if (kind === 'place') return options.places.includes(first);
    return false;
  }),
  timing: options.timings.includes(timing) ? timing : '',
});
