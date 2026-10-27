// Light/dark colour scheme. Every page load starts light (Dries, 2026-10-26): no stored choice
// and no prefers-color-scheme. Dark mode only comes from pressing the header square toggle, and
// lasts until the next full page load.

import type { AppCity } from './cities';

export type ColorScheme = 'light' | 'dark';

export const COLOR_SCHEME_ATTRIBUTE = 'data-color-scheme';
export const LIGHT_BACKGROUND = '#efefef';

// Dark mode keeps each city's type colour and swaps the beige for a near-black tinted
// towards that colour. styles/variables.sass holds the same values (test/color-scheme.test.mjs).
export const DARK_BACKGROUNDS: Record<AppCity, string> = {
  kyoto: '#0d120c',
  osaka: '#0b0910',
  tokyo: '#080b0f',
  'hong-kong': '#0f0d09',
};

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// WCAG 2 contrast ratio between two #rrggbb colours.
export const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
