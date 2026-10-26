'use client';

import { useEffect, useState } from 'react';
import {
  GRID_DENSITY_ATTRIBUTE,
  GRID_DENSITY_STORAGE_KEY,
  MAX_GRID_DENSITY,
  MIN_GRID_DENSITY,
  normalizeGridDensity,
  stepGridDensity,
  type GridDensity,
} from '@/lib/gridDensity';
import styles from './GridDensityControls.module.sass';

const applyDensity = (density: GridDensity) => {
  const root = document.documentElement;
  if (density === 0) root.removeAttribute(GRID_DENSITY_ATTRIBUTE);
  else root.setAttribute(GRID_DENSITY_ATTRIBUTE, String(density));
  try {
    if (density === 0) window.localStorage.removeItem(GRID_DENSITY_STORAGE_KEY);
    else window.localStorage.setItem(GRID_DENSITY_STORAGE_KEY, String(density));
  } catch {
    // Private mode or blocked storage: the choice still applies for this page view.
  }
};

// Plus/minus icons drawn with CSS bars at var(--stroke-width), so the minus and the plus's
// horizontal bar sit exactly on the header buttons' top lines.
export default function GridDensityControls() {
  const [density, setDensity] = useState<GridDensity>(0);

  useEffect(() => {
    setDensity(
      normalizeGridDensity(document.documentElement.getAttribute(GRID_DENSITY_ATTRIBUTE) ?? 0),
    );
  }, []);

  const change = (delta: number) => {
    const next = stepGridDensity(density, delta);
    if (next === density) return;
    setDensity(next);
    applyDensity(next);
  };

  const atMax = density === MAX_GRID_DENSITY;
  const atMin = density === MIN_GRID_DENSITY;

  return (
    <div className={styles.controls} role="group" aria-label="Items per row">
      <button
        type="button"
        className={styles.step}
        aria-label="More items per row"
        aria-disabled={atMax || undefined}
        data-grid-density-step="up"
        onClick={() => change(1)}
      >
        <span className={`${styles.icon} ${styles.plus}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.step}
        aria-label="Fewer items per row"
        aria-disabled={atMin || undefined}
        data-grid-density-step="down"
        onClick={() => change(-1)}
      >
        <span className={styles.icon} aria-hidden="true" />
      </button>
    </div>
  );
}
