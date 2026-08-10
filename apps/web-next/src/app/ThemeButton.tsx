'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from './ThemeButton.module.sass';

const themes = ['blue', 'monochrome', 'dark', 'brown'] as const;
const holdDuration = 3000;

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
  const [themeIndex, setThemeIndex] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const keyboardPress = useRef(false);
  const suppressKeyboardClick = useRef(false);
  const nextThemeIndex = (themeIndex + 1) % themes.length;
  const nextTheme = themes[nextThemeIndex];

  const clearHoldTimer = () => {
    if (holdTimer.current === null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const cycleTheme = () => {
    document.documentElement.dataset.theme = nextTheme;
    setThemeIndex(nextThemeIndex);
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
      data-next-theme={nextTheme}
      aria-label={`Switch to ${nextTheme} theme${onLongPress ? '. Hold for 3 seconds to toggle prototype controls' : ''}`}
      aria-controls={controlsId}
      aria-expanded={controlsId ? controlsOpen : undefined}
      onClick={(event) => {
        if (suppressKeyboardClick.current || longPressTriggered.current) {
          event.preventDefault();
          longPressTriggered.current = false;
          return;
        }
        cycleTheme();
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
        suppressKeyboardClick.current = true;
        startHold();
      }}
      onKeyUp={(event) => {
        if (!keyboardPress.current || !isHoldKey(event)) return;
        event.preventDefault();
        keyboardPress.current = false;
        clearHoldTimer();
        if (!longPressTriggered.current) cycleTheme();
        longPressTriggered.current = false;
        window.setTimeout(() => {
          suppressKeyboardClick.current = false;
        });
      }}
      onBlur={() => {
        clearHoldTimer();
        keyboardPress.current = false;
        suppressKeyboardClick.current = false;
        longPressTriggered.current = false;
      }}
      onContextMenu={onLongPress ? (event) => event.preventDefault() : undefined}
    />
  );
}
