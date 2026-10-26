'use client';

import { useEffect, useRef } from 'react';
import { type ClusterBox, boxClusterHold, boxClusterLayout } from '@/lib/boxCluster';
import { BoxEdge, BoxSides, boxLift } from './blocks/BoxFrame';
import styles from './BoxCluster.module.sass';

export default function BoxCluster({
  labels,
  seed,
  ariaLabel,
}: {
  labels: string[];
  seed: string;
  ariaLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxes = boxClusterLayout(labels, seed);

  // toggle each box between resting and raised on its own random clock;
  // the depth change itself is the same CSS transition the event cards use
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers = new Set<number>();
    const schedule = (box: HTMLElement, wait: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        box.toggleAttribute('data-raised');
        schedule(box, boxClusterHold());
      }, wait);
      timers.add(timer);
    };
    root.querySelectorAll<HTMLElement>('[data-cluster-box]').forEach((box) => {
      schedule(box, Math.random() * boxClusterHold());
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div ref={rootRef} className={styles.root} role="separator" aria-label={ariaLabel}>
      <div className={styles.field}>
        {boxes.map((box, index) => (
          <span
            className={`${styles.slot} ${box.slots.medium ? '' : styles.hiddenMedium} ${box.slots.small ? '' : styles.hiddenSmall}`}
            key={index}
            style={slotStyle(box)}
          >
            <span
              className={styles.box}
              aria-hidden="true"
              data-cluster-box
              style={{ '--bob-lift': box.lift } as React.CSSProperties}
            >
              <BoxSides />
              <span className={`${styles.front} ${boxLift}`}>{box.label}</span>
              <BoxEdge />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// per-layout cell + in-cell position, picked up by the media queries in the sass module
function slotStyle(box: ClusterBox) {
  const style: Record<string, number> = {};
  for (const [grid, slot] of Object.entries(box.slots)) {
    if (!slot) continue;
    style[`--${grid}-col`] = slot.col;
    style[`--${grid}-row`] = slot.row;
    style[`--${grid}-x`] = slot.x;
    style[`--${grid}-y`] = slot.y;
  }
  return style as React.CSSProperties;
}
