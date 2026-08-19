'use client';

import { useState, type ReactNode, type TransitionEvent } from 'react';
import { useCloseDebugControls } from './DebugControls';
import styles from './ControlPanel.module.sass';

type ControlPanelProps = {
  children: ReactNode;
  onReset: () => void;
};

type RangeControlProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
};

type ToggleControlProps = {
  label: string;
  pressed: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: () => void;
};

export function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: RangeControlProps) {
  return (
    <li className={`${styles.cell} ${styles.rangeCell}`}>
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{`${value}${suffix}`}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </li>
  );
}

export function ToggleControl({
  label,
  pressed,
  activeLabel,
  inactiveLabel,
  onToggle,
}: ToggleControlProps) {
  return (
    <li className={styles.cell}>
      <button className={styles.cellButton} type="button" aria-pressed={pressed} onClick={onToggle}>
        <span>{label}</span>
        <span>{pressed ? activeLabel : inactiveLabel}</span>
      </button>
    </li>
  );
}

export default function ControlPanel({ children, onReset }: ControlPanelProps) {
  const closeDebugControls = useCloseDebugControls();
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <aside
      className={styles.panel}
      aria-label="Design controls"
      data-closing={closing}
      onTransitionEnd={(event: TransitionEvent<HTMLElement>) => {
        if (closing && event.currentTarget === event.target) setVisible(false);
      }}
    >
      <ul className={styles.controlList}>
        {children}
        <li className={styles.cell}>
          <button className={styles.cellButton} type="button" onClick={onReset}>
            Reset
          </button>
        </li>
        <li className={styles.cell}>
          <button
            className={styles.cellButton}
            type="button"
            onClick={() => (closeDebugControls ? closeDebugControls() : setClosing(true))}
          >
            Close
          </button>
        </li>
      </ul>
    </aside>
  );
}
