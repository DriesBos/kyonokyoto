'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  readStarredIds,
  subscribeStarredIds,
  toggleStarredId,
  writeStarredIds,
} from '@/lib/eventStars';
import styles from './blocks/page.module.sass';

const STAR_PATH =
  'M12.5 1.75L15.77 8.38L23.08 9.45L17.79 14.6L19.04 21.88L12.5 18.44L5.96 21.88L7.21 14.6L1.92 9.45L9.23 8.38L12.5 1.75Z';
const NO_STARS: string[] = [];

// Favourite toggle in the card's top-right image corner. Always visible; filled when starred.
// It sits inside the lifted front so it moves with the 3D lift, and stops the click so the
// card underneath doesn't expand.
export default function EventStarButton({
  eventId,
  label,
  starLabel,
  unstarLabel,
}: {
  eventId: string;
  label: string;
  starLabel: string;
  unstarLabel: string;
}) {
  const starredIds = useSyncExternalStore(subscribeStarredIds, readStarredIds, () => NO_STARS);
  const starred = starredIds.includes(eventId);
  const [burst, setBurst] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The map and filters read the state from the card itself.
  useEffect(() => {
    const card = buttonRef.current?.closest<HTMLElement>('[data-event-card]');
    if (card) card.dataset.starred = String(starred);
  }, [starred]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.star}
      data-event-card-part="star"
      aria-pressed={starred}
      aria-label={`${starred ? unstarLabel : starLabel} ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!starred) setBurst((count) => count + 1);
        writeStarredIds(toggleStarredId(readStarredIds(), eventId));
      }}
    >
      <svg viewBox="0 0 25 25" aria-hidden="true" focusable="false" key={burst}>
        {burst > 0 && (
          <>
            <path className={styles.starRing} d={STAR_PATH} />
            <path className={styles.starRing} d={STAR_PATH} />
          </>
        )}
        <path className={styles.starShape} d={STAR_PATH} data-burst={burst > 0 || undefined} />
      </svg>
    </button>
  );
}
