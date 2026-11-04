'use client';

import { useEffect, useState } from 'react';
import toolbarStyles from '../ThemeButton.module.sass';

// Desktop column stepper (top right). The hold-to-open prototype drawer and its dot were removed
// on 2026-11-04 (Dries); phones use the header box's +/- instead (hidden there in the sass).
const minColumns = 1;
const maxColumns = 8;

const clearOverrides = () => {
  document.documentElement.style.removeProperty('--block-cols');
  document.documentElement.style.removeProperty('--block-expanded-span');
};

export default function BlockControls() {
  const [columns, setColumns] = useState<number | null>(null);

  useEffect(() => clearOverrides, []);

  const changeColumns = (delta: number) => {
    const grid = document.querySelector('[data-event-grid]');
    if (!(grid instanceof HTMLElement)) return;

    const current = Number.parseInt(getComputedStyle(grid).getPropertyValue('--cols'), 10);
    const next = Math.min(maxColumns, Math.max(minColumns, current + delta));
    document.documentElement.style.setProperty('--block-cols', String(next));
    document.documentElement.style.setProperty('--block-expanded-span', String(Math.min(next, 2)));
    setColumns(next);
  };

  return (
    <div className={toolbarStyles.toolbar}>
      <button
        className={toolbarStyles.stepButton}
        type="button"
        aria-label="Show fewer items per row"
        disabled={columns === minColumns}
        onClick={() => changeColumns(-1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <button
        className={toolbarStyles.stepButton}
        type="button"
        aria-label="Show more items per row"
        disabled={columns === maxColumns}
        onClick={() => changeColumns(1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
