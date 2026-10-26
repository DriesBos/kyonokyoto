# Colour palettes and contrast

How the city palettes in `apps/web-next` work, how the dark mode backgrounds were picked, and how to check contrast when you add a city or change a colour.

## Where the values live

| What | File |
| --- | --- |
| City type colour (`themeColor`) | `apps/web-next/src/lib/cities.ts` |
| Same colours as sass tokens | `apps/web-next/src/styles/variables.sass` (`$color-<city>`) |
| Light background (shared beige) | `$color-city-background` in `variables.sass`, `LIGHT_BACKGROUND` in `src/lib/colorScheme.ts` |
| Dark background per city | `$color-<city>-dark-background` in `variables.sass`, `DARK_BACKGROUNDS` in `src/lib/colorScheme.ts` |
| Contrast function | `contrastRatio()` in `src/lib/colorScheme.ts` |
| Live overview | `/dev` (local only), "colours" section: both palettes per city with their ratio |

`test/color-scheme.test.mjs` fails if the sass and TypeScript dark backgrounds drift apart, or if a city colour drops below 3:1 on its dark background.

## Current palettes (2026-10-26)

| City | Type colour | Light bg | Light ratio | Dark bg | Dark ratio |
| --- | --- | --- | --- | --- | --- |
| Kyoto | `#138e00` | `#efefef` | 3.73 | `#0d120c` | 4.42 |
| Osaka | `#7d4cff` | `#efefef` | 4.20 | `#0b0910` | 4.10 |
| Tokyo | `#006fd6` | `#efefef` | 4.30 | `#080b0f` | 3.99 |
| Hong Kong | `#8c6500` | `#efefef` | 4.59 | `#0f0d09` | 3.68 |

## How a dark background is picked

The rule: the city type colour never changes. Only the background goes dark.

1. Take the hue of the city colour (HSL). Kyoto `#138e00` is hue 112, so its background uses hue ~110.
2. Use a near-black with that hue: **saturation 20–30%, lightness 4.5–6%**. That is dark enough for contrast but still reads as tinted, not as flat black.
3. Check the ratio (below). It must be **at least 3:1**. Then aim for the highest ratio you can get without losing the tint, which in practice means lightness under ~6%.
4. Lower lightness raises the ratio, but only a little: pure black `#000000` is the ceiling.

| City | Dark bg | Hue | Sat | Light |
| --- | --- | --- | --- | --- |
| Kyoto | `#0d120c` | 110 | 20% | 5.9% |
| Osaka | `#0b0910` | 257 | 28% | 4.9% |
| Tokyo | `#080b0f` | 214 | 30% | 4.5% |
| Hong Kong | `#0f0d09` | 40 | 25% | 4.7% |

## How contrast is calculated (WCAG 2)

1. For each sRGB channel (0–255), divide by 255, then linearise it:
   `c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4`
2. Relative luminance: `L = 0.2126 R + 0.7152 G + 0.0722 B` (0 = black, 1 = white).
3. Ratio: `(L_lighter + 0.05) / (L_darker + 0.05)`. It runs from 1:1 to 21:1.

Thresholds (WCAG 2.2 AA):

- **4.5:1** for body text (anything under 24px, or under 18.66px bold).
- **3:1** for large text, and for lines, icons and other UI parts.

## What this means for our colours

The city colours are all mid-luminance (L 0.15–0.19). Even on pure black their best ratio is: Kyoto 4.90, Osaka 4.35, Tokyo 4.24, Hong Kong 3.98. So in both modes every city passes 3:1, but only some reach 4.5:1 for body text. If body text ever has to meet AA, the fix is a lighter version of the type colour in dark mode (and a darker one in light mode), not a different background.

## Checking a colour

From the repo root:

```sh
node --experimental-strip-types -e "import('./apps/web-next/src/lib/colorScheme.ts').then(({ contrastRatio }) => console.log(contrastRatio('#138e00', '#0d120c').toFixed(2)))"
```

Or open `/dev` locally and read the ratios under the palette swatches.

## Adding a city

1. Add `themeColor` in `cities.ts` and `$color-<city>` in `variables.sass`, plus the city to the `@each` maps in `src/styles/globals.sass`.
2. Pick a dark background with the recipe above. Add it to `DARK_BACKGROUNDS` and as `$color-<city>-dark-background`.
3. Run `pnpm --filter kyo-no-kyoto-web-next test` and check `/dev`.
4. Add the row to the tables in this file.
