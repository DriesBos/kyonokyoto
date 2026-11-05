'use client';

import { useEffect, useState } from 'react';
import {
  GRID_DENSITY_ATTRIBUTE,
  MAX_GRID_DENSITY,
  MIN_GRID_DENSITY,
  normalizeGridDensity,
  SINGLE_COLUMN_QUERY,
  stepGridDensity,
  type GridDensity,
} from '@/lib/gridDensity';
import { uiText, type AppLocale } from '@/lib/i18n';
import styles from './GridDensityControls.module.sass';

const applyDensity = (density: GridDensity) => {
  const root = document.documentElement;
  if (density === 0) root.removeAttribute(GRID_DENSITY_ATTRIBUTE);
  else root.setAttribute(GRID_DENSITY_ATTRIBUTE, String(density));
};

// Plus/minus icons drawn with CSS bars at var(--stroke-width), so the minus and the plus's
// horizontal bar sit exactly on the header buttons' top lines.
export default function GridDensityControls({ locale = 'en' }: { locale?: AppLocale }) {
  const copy = uiText[locale];
  const [density, setDensity] = useState<GridDensity>(0);
  // At 375px and below the default is already one column, so − stops at the default there
  const [minDensity, setMinDensity] = useState<GridDensity>(MIN_GRID_DENSITY);

  useEffect(() => {
    setDensity(
      normalizeGridDensity(document.documentElement.getAttribute(GRID_DENSITY_ATTRIBUTE) ?? 0),
    );
    const query = window.matchMedia(SINGLE_COLUMN_QUERY);
    const sync = () => {
      const min: GridDensity = query.matches ? 0 : MIN_GRID_DENSITY;
      setMinDensity(min);
      setDensity((current) => {
        if (current >= min) return current;
        applyDensity(min);
        return min;
      });
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const change = (delta: number) => {
    const next = stepGridDensity(density, delta, minDensity);
    if (next === density) return;
    setDensity(next);
    applyDensity(next);
  };

  const atMax = density === MAX_GRID_DENSITY;
  const atMin = density <= minDensity;

  return (
    <div className={styles.controls} role="group" aria-label={copy.itemsPerRow}>
      <button
        type="button"
        className={styles.step}
        aria-label={copy.moreItemsPerRow}
        aria-disabled={atMax || undefined}
        data-grid-density-step="up"
        onClick={() => change(1)}
      >
        <span className={`${styles.icon} ${styles.plus}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.step}
        aria-label={copy.fewerItemsPerRow}
        aria-disabled={atMin || undefined}
        data-grid-density-step="down"
        onClick={() => change(-1)}
      >
        <span className={styles.icon} aria-hidden="true" />
      </button>
    </div>
  );
}
