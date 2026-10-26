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
