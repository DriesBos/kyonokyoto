import { useEffect, useRef } from 'react';
import type { FilterOptions } from '@/lib/cityEvents';
import { filterHashFor, filtersFromHash, pickableFilters } from '@/lib/eventFilters';

// Keeps the header's picks in the URL hash (lib/eventFilters filterHashFor), so links share them
// and reload/back keep them. The hash never reaches the server or the CDN cache key.
export function useFilterHash({
  enabled,
  filterOptions,
  defaultFilters,
  activeFilters,
  activeTiming,
  setActiveFilters,
  setActiveTiming,
}: {
  // off right after a language switch: the handoff restores the picks instead
  enabled: boolean;
  filterOptions: FilterOptions;
  defaultFilters: readonly string[];
  activeFilters: ReadonlySet<string>;
  activeTiming: string;
  setActiveFilters: (next: Set<string>) => void;
  setActiveTiming: (next: string) => void;
}) {
  // Filters from the URL hash (a shared link, a reload): read after hydration, since the
  // CDN-cached HTML is the same for every visitor. A language switch's handoff wins.
  useEffect(() => {
    const apply = () => {
      const fromHash = filtersFromHash(window.location.hash);
      if (!fromHash) return;
      const picked = pickableFilters(fromHash, filterOptions);
      setActiveFilters(new Set(picked.tokens));
      setActiveTiming(picked.timing);
    };
    if (enabled) apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [enabled, filterOptions, setActiveFilters, setActiveTiming]);

  // ...and written back on every change, in place (no new history entries). The mount run is
  // skipped: its state is the server default, not yet what the hash says.
  const skipHashWriteRef = useRef(true);
  useEffect(() => {
    if (skipHashWriteRef.current) {
      skipHashWriteRef.current = false;
      return;
    }
    const hash = filterHashFor(
      { tokens: [...activeFilters], timing: activeTiming },
      defaultFilters,
    );
    const current = window.location.hash.replace(/^#/, '');
    // leave other anchors (#events) alone while the filters are at their defaults
    if (!hash && !filtersFromHash(current)) return;
    if (hash === current) return;
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${search}${hash ? `#${hash}` : ''}`,
    );
  }, [activeFilters, activeTiming, defaultFilters]);
}
