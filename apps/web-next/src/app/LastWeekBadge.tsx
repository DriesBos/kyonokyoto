import styles from './LastWeekBadge.module.sass';

// Card pills: a filled oval in the city colour at the image's top-right (Dries picked this of 3
// designs, 2026-11-10). "Last week" for ongoing events ending within 6 days (CityEvent.endsSoon),
// "Coming soon" for upcoming events starting within 7 days (CityEvent.startsSoon). Never both.
export function LastWeekPill({ label, kind = 'last-week' }: { label: string; kind?: 'last-week' | 'coming-soon' }) {
  return (
    <span className={styles.pill} data-event-pill={kind}>
      {label}
    </span>
  );
}
