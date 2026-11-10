import styles from './LastWeekBadge.module.sass';

// "Last week" badge for ongoing events that end within 6 days (CityEvent.endsSoon): a filled oval
// in the city colour at the image's top-right (Dries picked this of 3 designs, 2026-11-10).
export function LastWeekPill({ label }: { label: string }) {
  return (
    <span className={styles.pill} data-last-week>
      {label}
    </span>
  );
}
