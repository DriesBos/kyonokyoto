'use client';

import { useEffect, useState } from 'react';
import {
  COLOR_SCHEME_ATTRIBUTE,
  COLOR_SCHEME_STORAGE_KEY,
  normalizeColorScheme,
  type ColorScheme,
} from '@/lib/colorScheme';
import { uiText, type AppLocale } from '@/lib/i18n';
import styles from './GridDensityControls.module.sass';

const systemScheme = (): ColorScheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const currentScheme = () =>
  normalizeColorScheme(document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE)) ??
  systemScheme();

// Matching the system setting clears the stored choice, so the page follows the system again.
const applyScheme = (scheme: ColorScheme) => {
  const root = document.documentElement;
  const followSystem = scheme === systemScheme();
  if (followSystem) root.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
  else root.setAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
  try {
    if (followSystem) window.localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
    else window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // Private mode or blocked storage: the choice still applies for this page view.
  }
};

// Header square (Figma header 621:3718): switches between the light and dark city palette.
export default function ColorSchemeToggle({ locale = 'en' }: { locale?: AppLocale }) {
  const [scheme, setScheme] = useState<ColorScheme>('light');

  useEffect(() => {
    setScheme(currentScheme());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setScheme(currentScheme());
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

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
