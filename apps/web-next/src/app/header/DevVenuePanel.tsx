'use client';

import GeneralButton from '../GeneralButton';
import type { HeaderVenue } from '../SiteHeader';
import styles from '../SiteHeader.module.sass';
import { useDisclosurePanel } from './headerMotion';

// Testing aid (local builds only): filter the grid by source. Split from SiteHeader so production
// never downloads it.
export default function DevVenuePanel({
  venues,
  open,
  active,
  onToggle,
}: {
  venues: HeaderVenue[];
  open: boolean;
  active: ReadonlySet<string>;
  onToggle: (slug: string) => void;
}) {
  const panelRef = useDisclosurePanel(open);
  return (
    <div
      className={`${styles.panel} ${styles.venuesPanel}`}
      id="site-header-venues"
      ref={panelRef}
      data-open={open || undefined}
      aria-label="venues"
      role="group"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      {venues.map((venue) => (
        <GeneralButton
          key={venue.slug}
          verticalPadding="full"
          label={`${venue.label} (${venue.count})`}
          showDot
          pressed={active.has(venue.slug)}
          tabIndex={open ? undefined : -1}
          data-panel-button
          data-venue={venue.slug}
          onClick={() => onToggle(venue.slug)}
        />
      ))}
    </div>
  );
}
