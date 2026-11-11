import { useSyncExternalStore } from 'react';

// The filters the header has applied to the cards: one small store the header writes and the
// grid's neighbours (the map) read, instead of custom DOM events and pressed-button queries.
export type AppliedFilters = {
  tokens: readonly string[];
  timing: string;
  venues: readonly string[];
  saved: boolean;
  // bumps on every application, also when only stars changed what is visible
  version: number;
};

let applied: AppliedFilters = { tokens: [], timing: '', venues: [], saved: false, version: 0 };
const listeners = new Set<() => void>();

export const getAppliedFilters = () => applied;

export const publishAppliedFilters = (next: Omit<AppliedFilters, 'version'>) => {
  applied = { ...next, version: applied.version + 1 };
  listeners.forEach((listener) => listener());
};

export const subscribeAppliedFilters = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAppliedFilters = () =>
  useSyncExternalStore(subscribeAppliedFilters, getAppliedFilters, getAppliedFilters);
