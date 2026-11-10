'use client';

import { FILTER_RESET_EVENT } from '@/lib/eventFilters';
import GeneralButton from './GeneralButton';

// Empty-state button under "NO EVENTS!": SiteHeader listens and clears every filter row.
export default function UnsetFiltersButton({ label }: { label: string }) {
  return (
    <GeneralButton
      verticalPadding="full"
      label={label}
      data-filter-reset
      onClick={() => document.dispatchEvent(new CustomEvent(FILTER_RESET_EVENT))}
    />
  );
}
