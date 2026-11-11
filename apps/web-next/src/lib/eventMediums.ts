import { parseCategoryToken } from '../../../../data/categories.mjs';

// The crawler's per-event medium check (apps/crawler/src/event-medium-check.mjs) leaves a
// `medium_check:` marker and the event's own display_category tokens. Those replace the venue's
// mediums; without the marker, or with no mediums found, the venue's stay (fallback).
export const withEventMediums = (venueTokens: string[], eventCategories: string[] | null) => {
  const categories = eventCategories ?? [];
  if (!categories.some((token) => token.startsWith('medium_check:'))) return venueTokens;
  const mediums = categories.filter(
    (token) => token.startsWith('display_category:') && parseCategoryToken(token),
  );
  if (mediums.length === 0) return venueTokens;
  return [
    ...venueTokens.filter((token) => !token.startsWith('display_category:')),
    ...new Set(mediums),
  ];
};
