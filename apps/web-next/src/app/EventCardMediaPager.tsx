'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import styles from './EventCardDetail.module.sass';

// Shares the open card's media scroll position between the media track and the dots in the meta.
type MediaPager = {
  count: number;
  active: number;
  setCount: (count: number) => void;
  setActive: (index: number) => void;
  scrollTo: { current: ((index: number) => void) | null };
};

const MediaPagerContext = createContext<MediaPager | null>(null);

export const useMediaPager = () => useContext(MediaPagerContext);

export function EventCardMediaPager({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(0);
  const [scrollTo] = useState<MediaPager['scrollTo']>(() => ({ current: null }));
  const value = useMemo(
    () => ({ count, active, setCount, setActive, scrollTo }),
    [count, active, scrollTo],
  );

  return <MediaPagerContext.Provider value={value}>{children}</MediaPagerContext.Provider>;
}

// label is a plain string (server-rendered cards can't pass functions): "Image" -> "Image 2 / 3".
export function EventCardMediaDots({ label }: { label: string }) {
  const pager = useMediaPager();
  if (!pager || pager.count < 2) return null;

  return (
    <div className={styles.dots} data-event-card-part="media-dots">
      {Array.from({ length: pager.count }, (_, index) => (
        <button
          key={index}
          type="button"
          className={styles.dot}
          aria-label={`${label} ${index + 1} / ${pager.count}`}
          aria-current={index === pager.active ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            pager.scrollTo.current?.(index);
          }}
        />
      ))}
    </div>
  );
}
