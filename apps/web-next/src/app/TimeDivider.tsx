'use client';

import { useEffect, useId, useRef } from 'react';
import styles from './TimeDivider.module.sass';

const repeatedTrackText = (value: string) =>
  Array.from({ length: 20 }, () => `${value}\u00a0\u00a0↓\u00a0\u00a0`).join('');

const tracks = [
  { travel: 16 },
  { travel: 14, start: -28, end: -10, alternate: true },
  { travel: 12 },
  { travel: 14, mobile: true },
  { travel: 17, mobile: true },
  { travel: 15, mobile: true },
];

export default function TimeDivider({
  label,
  readyLabel,
  ariaLabel,
}: {
  label: string;
  readyLabel: string;
  ariaLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cleanup = () => {};
    let frame = 0;

    const build = async () => {
      cleanup();
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (!root.isConnected) return;
      gsap.registerPlugin(ScrollTrigger);
      const section = root.closest<HTMLElement>('[data-events-section]');
      const scroller = section && section.scrollHeight > section.clientHeight + 1 ? section : undefined;
      const context = gsap.context(() => {
        root.querySelectorAll<HTMLElement>('[data-time-divider-track]').forEach((track, index) => {
          const travel = Number(track.dataset.travel ?? 14);
          const start = Number(track.dataset.start ?? -travel);
          const end = Number(track.dataset.end ?? 0);
          gsap.fromTo(track, { xPercent: start }, {
            xPercent: end,
            ease: 'none',
            scrollTrigger: {
              id: `${id}-${index}`,
              trigger: root,
              scroller,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.33,
              invalidateOnRefresh: true,
            },
          });
        });
      }, root);
      cleanup = () => context.revert();
      ScrollTrigger.refresh();
    };

    const scheduleBuild = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void build());
    };
    scheduleBuild();
    document.addEventListener('event-filter:updated', scheduleBuild);
    document.addEventListener('map-layout:updated', scheduleBuild);
    window.addEventListener('resize', scheduleBuild);
    return () => {
      cancelAnimationFrame(frame);
      cleanup();
      document.removeEventListener('event-filter:updated', scheduleBuild);
      document.removeEventListener('map-layout:updated', scheduleBuild);
      window.removeEventListener('resize', scheduleBuild);
    };
  }, [id]);

  return (
    <div ref={rootRef} className={styles.root} aria-label={ariaLabel}>
      <div className={styles.viewport}>
        <div className={styles.scroller} aria-hidden="true">
          {tracks.map((track, index) => {
            const text = repeatedTrackText(track.alternate ? readyLabel : label);
            return (
              <div
                className={`${styles.track} ${track.mobile ? styles.mobileTrack : ''}`}
                data-time-divider-track
                data-travel={track.travel}
                data-start={track.start}
                data-end={track.end}
                key={index}
              >
                <div>{text}</div>
                <div>{text}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
