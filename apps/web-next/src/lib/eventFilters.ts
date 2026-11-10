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

// The map reads the picked filters from the header's pressed buttons.
export const pressedFilterState = () =>
  filterStateFrom(
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-filter-token][aria-pressed='true']"),
      (button) => button.dataset.filterToken ?? '',
    ),
  );
