// Favicon: the five header-style lines in the city colour on the page background.
// public/favicons/<city>.svg are the static copies (test/favicon.test.mjs keeps them in sync);
// app/LiveFavicon.tsx swaps in a data URL with the colours currently on screen.

import { cityConfigs, type AppCity } from './cities.ts';
import { DARK_BACKGROUNDS, LIGHT_BACKGROUND } from './colorScheme.ts';

const LINE_YS = [0.5, 4, 7.5, 11.5, 15.5];

const lines = (color: string) =>
  LINE_YS.map((y) => `<line y1="${y}" x2="16" y2="${y}" stroke="${color}"/>`).join('');

export const faviconSvg = (color: string, background: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="${background}"/>${lines(color)}</svg>`;

// Static file per city: light background, dark one under prefers-color-scheme (Chrome, Firefox).
export const staticFaviconSvg = (city: AppCity) => {
  const color = cityConfigs.find((config) => config.slug === city)?.themeColor ?? '#138e00';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><style>@media (prefers-color-scheme: dark){.bg{fill:${DARK_BACKGROUNDS[city]}}}</style><rect class="bg" width="16" height="16" fill="${LIGHT_BACKGROUND}"/>${lines(color)}</svg>\n`;
};

export const faviconPath = (city: AppCity) => `/favicons/${city}.svg`;

export const faviconDataUrl = (color: string, background: string) =>
  `data:image/svg+xml,${encodeURIComponent(faviconSvg(color, background))}`;
