'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import styles from './ThemeButton.module.sass';

const holdDuration = 3000;

// Debug dot on the blocks landing: hold it for 3 seconds to toggle the prototype controls.
// Light/dark lives in the header (ColorSchemeToggle), so the dot no longer cycles themes.
export default function ThemeButton({
  contained = false,
  controlsId,
  controlsOpen = false,
  onLongPress,
}: {
  contained?: boolean;
  controlsId?: string;
  controlsOpen?: boolean;
  onLongPress?: () => void;
}) {
  const holdTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const keyboardPress = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimer.current === null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const startHold = () => {
    clearHoldTimer();
    longPressTriggered.current = false;
    if (!onLongPress) return;

    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      longPressTriggered.current = true;
      onLongPress();
    }, holdDuration);
  };

  const isHoldKey = (event: KeyboardEvent<HTMLButtonElement>) =>
    event.key === 'Enter' || event.key === ' ';

  useEffect(() => () => clearHoldTimer(), []);

  return (
    <button
      type="button"
      className={styles.button}
      data-contained={contained || undefined}
      aria-label="Hold for 3 seconds to toggle prototype controls"
      aria-controls={controlsId}
      aria-expanded={controlsId ? controlsOpen : undefined}
      onClick={(event) => {
        if (longPressTriggered.current) {
          event.preventDefault();
          longPressTriggered.current = false;
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startHold();
      }}
      onPointerUp={clearHoldTimer}
      onPointerCancel={() => {
        clearHoldTimer();
        longPressTriggered.current = false;
      }}
      onKeyDown={(event) => {
        if (!onLongPress || !isHoldKey(event) || event.repeat) return;
        event.preventDefault();
        keyboardPress.current = true;
        startHold();
      }}
      onKeyUp={(event) => {
        if (!keyboardPress.current || !isHoldKey(event)) return;
        event.preventDefault();
        keyboardPress.current = false;
        clearHoldTimer();
        longPressTriggered.current = false;
      }}
      onBlur={() => {
        clearHoldTimer();
        keyboardPress.current = false;
        longPressTriggered.current = false;
      }}
      onContextMenu={onLongPress ? (event) => event.preventDefault() : undefined}
    />
  );
}
