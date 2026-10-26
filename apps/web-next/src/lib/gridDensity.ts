// Grid density: the user can move one step either side of the breakpoint's default column
// count. We store the step (-1, 0, 1), not a column count, so it follows every breakpoint.

export type GridDensity = -1 | 0 | 1;

export const GRID_DENSITY_STORAGE_KEY = 'kyo-grid-density';
export const GRID_DENSITY_ATTRIBUTE = 'data-grid-density';
export const MIN_GRID_DENSITY: GridDensity = -1;
export const MAX_GRID_DENSITY: GridDensity = 1;

export const normalizeGridDensity = (value: unknown): GridDensity => {
  const step = Math.round(Number(value));
  if (!Number.isFinite(step)) return 0;
  return Math.min(MAX_GRID_DENSITY, Math.max(MIN_GRID_DENSITY, step)) as GridDensity;
};

export const stepGridDensity = (current: GridDensity, delta: number) =>
  normalizeGridDensity(current + delta);

// Runs in <head> before first paint so a saved density never flashes the default grid.
export const gridDensityInitScript = `try{var d=Math.round(Number(localStorage.getItem('${GRID_DENSITY_STORAGE_KEY}')));if(d===1||d===-1)document.documentElement.setAttribute('${GRID_DENSITY_ATTRIBUTE}',String(d))}catch(e){}`;

// Default columns per events-panel width, widest first. blocks/page.module.sass holds the same
// steps as media and container queries; test/grid-density.test.mjs keeps the two in sync.
export const GRID_COLUMN_BREAKPOINTS = [
  { maxWidth: null, columns: 5 },
  { maxWidth: 1440, columns: 4 },
  { maxWidth: 1100, columns: 3 },
  { maxWidth: 800, columns: 2 },
] as const;

export const columnsForDensity = (columns: number, density: GridDensity) =>
  Math.max(1, columns + density);
