'use client';

import { useEffect, useState } from 'react';
import ControlPanel, { RangeControl, ToggleControl } from '../ControlPanel';
import { DebugControls } from '../DebugControls';
import toolbarStyles from '../ThemeButton.module.sass';

type Control = {
  varName: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit: string;
};

const CONTROLS: Control[] = [
  { varName: '--block-dx', label: 'Offset X', min: -48, max: 48, step: 2, initial: 24, unit: 'px' },
  { varName: '--block-dy', label: 'Offset Y', min: -48, max: 48, step: 2, initial: 24, unit: 'px' },
  { varName: '--block-lift', label: 'Lift', min: 1, max: 4, step: 0.25, initial: 2, unit: '' },
  {
    varName: '--block-gap-x',
    label: 'Gap X',
    min: 0,
    max: 10,
    step: 0.5,
    initial: 5,
    unit: 'vmin',
  },
  {
    varName: '--block-gap-y',
    label: 'Gap Y',
    min: 0,
    max: 10,
    step: 0.5,
    initial: 5,
    unit: 'vmin',
  },
  { varName: '--block-shade', label: 'Shade', min: 0, max: 30, step: 1, initial: 12, unit: '%' },
];

const defaults = Object.fromEntries(CONTROLS.map((control) => [control.varName, control.initial]));
const minColumns = 1;
const maxColumns = 8;

const clearOverrides = () => {
  CONTROLS.forEach((control) => document.documentElement.style.removeProperty(control.varName));
  document.documentElement.style.removeProperty('--block-cols');
  document.documentElement.style.removeProperty('--block-expanded-span');
  document.documentElement.removeAttribute('data-blocks');
};

export default function BlockControls() {
  const [values, setValues] = useState<Record<string, number>>(defaults);
  const [wireframe, setWireframe] = useState(false);
  const [columns, setColumns] = useState<number | null>(null);

  useEffect(() => clearOverrides, []);

  const reset = () => {
    setValues(defaults);
    setWireframe(false);
    setColumns(null);
    clearOverrides();
  };

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
    <DebugControls
      toolbarControls={
        <>
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
        </>
      }
    >
      <ControlPanel onReset={reset}>
        {CONTROLS.map((control) => (
          <RangeControl
            id={`blocks-${control.varName.slice(2)}`}
            key={control.varName}
            label={control.label}
            min={control.min}
            max={control.max}
            step={control.step}
            suffix={control.unit}
            value={values[control.varName]}
            onChange={(value) => {
              setValues((current) => ({ ...current, [control.varName]: value }));
              document.documentElement.style.setProperty(
                control.varName,
                `${value}${control.unit}`,
              );
            }}
          />
        ))}
        <ToggleControl
          label="Mode"
          pressed={wireframe}
          activeLabel="Wireframe"
          inactiveLabel="Solid"
          onToggle={() => {
            const next = !wireframe;
            setWireframe(next);
            document.documentElement.dataset.blocks = next ? 'wireframe' : 'solid';
          }}
        />
      </ControlPanel>
    </DebugControls>
  );
}
