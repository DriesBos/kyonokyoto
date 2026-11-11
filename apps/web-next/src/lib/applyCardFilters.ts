import { filterStateFrom, matchesCard, SAVED_FILTER_TOKEN } from './eventFilters.ts';

export type CardFilterInput = {
  tokens: Iterable<string>;
  timing: string;
  venues: ReadonlySet<string>;
  saved: boolean;
};

// Shows and hides the event cards, their groups, the dividers between groups and the empty
// state for the header's picks. Rows AND together: tags, timing, the dev venue filter, saved.
// Returns how many distinct cards on the page are starred (the header's saved count).
export function applyCardFilters(
  { tokens, timing, venues, saved }: CardFilterInput,
  root: ParentNode = document,
): { starredCount: number } {
  const state = filterStateFrom(saved ? [...tokens, SAVED_FILTER_TOKEN] : tokens);
  const groups = Array.from(root.querySelectorAll<HTMLElement>('[data-event-group]'));
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-event-card]'));
  // card[data-starred] is set by EventStarButton in a layout effect, so it is current here.
  const starredOnPage = new Set<string>();

  cards.forEach((card) => {
    const starred = card.dataset.starred === 'true';
    if (starred) starredOnPage.add(card.dataset.eventId ?? '');
    const tags = new Set((card.dataset.filterTags ?? '').split('|').filter(Boolean));
    const group =
      card.dataset.eventGroupName ??
      card.closest<HTMLElement>('[data-event-group]')?.dataset.eventGroupName ??
      '';
    const timingMatches =
      !timing || (timing === 'ending' ? card.dataset.endsSoon === 'true' : group === timing);
    const venueMatches = venues.size === 0 || venues.has(card.dataset.source ?? '');
    card.toggleAttribute(
      'hidden',
      !(matchesCard({ tags, starred }, state) && venueMatches && timingMatches),
    );
  });

  let visibleGroups = 0;
  groups.forEach((group) => {
    const visible = Boolean(group.querySelector('[data-event-card]:not([hidden])'));
    group.toggleAttribute('hidden', !visible);
    if (visible) visibleGroups += 1;
  });
  root.querySelectorAll<HTMLElement>('[data-event-divider]').forEach((divider) => {
    const before = groups.find(
      (group) => group.dataset.eventGroupName === divider.dataset.beforeGroup,
    );
    const after = groups.find(
      (group) => group.dataset.eventGroupName === divider.dataset.afterGroup,
    );
    divider.toggleAttribute(
      'hidden',
      visibleGroups < 2 || Boolean(before?.hidden) || Boolean(after?.hidden),
    );
  });
  root
    .querySelector<HTMLElement>('[data-filter-empty]')
    ?.toggleAttribute('hidden', visibleGroups > 0);
  return { starredCount: starredOnPage.size };
}
