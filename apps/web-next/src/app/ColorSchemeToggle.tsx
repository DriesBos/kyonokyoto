'use client';

import { useState } from 'react';
import { COLOR_SCHEME_ATTRIBUTE, type ColorScheme } from '@/lib/colorScheme';
import { uiText, type AppLocale } from '@/lib/i18n';
import styles from './GridDensityControls.module.sass';

// Not stored and not read from the system: every page load starts light (lib/colorScheme.ts).
const applyScheme = (scheme: ColorScheme) => {
  const root = document.documentElement;
  if (scheme === 'dark') root.setAttribute(COLOR_SCHEME_ATTRIBUTE, 'dark');
  else root.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
};

// Header square (Figma header 621:3718): switches between the light and dark city palette.
export default function ColorSchemeToggle({ locale = 'en' }: { locale?: AppLocale }) {
  // Starts from the attribute, so a client-side route change keeps the scheme already on screen.
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE) === 'dark'
      ? 'dark'
      : 'light',
  );

  const toggle = () => {
    const next = scheme === 'dark' ? 'light' : 'dark';
    setScheme(next);
    applyScheme(next);
  };

  return (
    <button
      type="button"
      className={styles.step}
      aria-label={uiText[locale].darkMode}
      aria-pressed={scheme === 'dark'}
      data-color-scheme-toggle
      onClick={toggle}
    >
      <span className={`${styles.icon} ${styles.square}`} aria-hidden="true" />
    </button>
  );
}
