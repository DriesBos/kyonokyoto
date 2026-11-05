// Grid density: the user can move one step either side of the breakpoint's default column
// count. We keep the step (-1, 0, 1), not a column count, so it follows every breakpoint.
// It lives only on <html> for the current page view: a reload resets it to the default.

export type GridDensity = -1 | 0 | 1;

export const GRID_DENSITY_ATTRIBUTE = 'data-grid-density';
export const MIN_GRID_DENSITY: GridDensity = -1;
export const MAX_GRID_DENSITY: GridDensity = 1;

export const normalizeGridDensity = (value: unknown): GridDensity => {
  const step = Math.round(Number(value));
  if (!Number.isFinite(step)) return 0;
  return Math.min(MAX_GRID_DENSITY, Math.max(MIN_GRID_DENSITY, step)) as GridDensity;
};

export const stepGridDensity = (
  current: GridDensity,
  delta: number,
  min: GridDensity = MIN_GRID_DENSITY,
) => normalizeGridDensity(Math.max(min, current + delta));

// Viewport where the default is one column, so the lowest step would change nothing
export const SINGLE_COLUMN_QUERY = '(max-width: 375px)';

// Default columns per events-panel width, widest first. blocks/page.module.sass holds the same
// steps as media and container queries; test/grid-density.test.mjs keeps the two in sync.
// At 375px and below the list is one column: + gives two, and − stops at one (minDensity 0).
export const GRID_COLUMN_BREAKPOINTS = [
  { maxWidth: null, columns: 5, minDensity: -1 },
  { maxWidth: 1440, columns: 4, minDensity: -1 },
  { maxWidth: 1100, columns: 3, minDensity: -1 },
  { maxWidth: 800, columns: 2, minDensity: -1 },
  { maxWidth: 375, columns: 1, minDensity: 0 },
] as const;

export const columnsForDensity = (columns: number, density: GridDensity) =>
  Math.max(1, columns + density);

// `sizes` for event card images. Lazy images use "auto" (the rendered width, so density, map
// width and expanded cards are all exact). The list after it is the default-density grid for the
// eager first image and for browsers without auto support.
export const EVENT_CARD_IMAGE_SIZES = [
  'auto',
  ...[...GRID_COLUMN_BREAKPOINTS]
    .reverse()
    .filter(({ maxWidth }) => maxWidth !== null)
    .map(({ maxWidth, columns }) => `(max-width: ${maxWidth}px) ${Math.round(100 / columns)}vw`),
  `${100 / GRID_COLUMN_BREAKPOINTS[0].columns}vw`,
].join(', ');
