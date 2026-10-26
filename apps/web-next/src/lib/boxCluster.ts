// the cluster is a jittered grid: each layout picks random cells, and each box sits at a
// random spot inside its cell, so spacing varies but boxes never overlap
export const boxClusterGrids = {
  wide: { cols: 7, rows: 3, count: 16 },
  medium: { cols: 4, rows: 3, count: 10 },
  small: { cols: 2, rows: 4, count: 7 },
} as const;

export type BoxClusterGrid = keyof typeof boxClusterGrids;

export type ClusterSlot = {
  col: number;
  row: number;
  // 0..1 position inside the cell
  x: number;
  y: number;
};

export type ClusterBox = {
  label: string;
  // extra depth when raised (1 = one more box depth)
  lift: number;
  // missing when the box is hidden in that layout
  slots: Partial<Record<BoxClusterGrid, ClusterSlot>>;
};

const hashSeed = (value: string) => {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
};

// mulberry32: deterministic so server and client render identical boxes
const seededRandom = (seed: string) => {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1);

export function boxClusterLabels(heading: string, cheer: string, soon: string) {
  const title = capitalize(heading);
  return [
    '↓',
    `${title} ↓`,
    capitalize(cheer),
    '↓↓↓',
    `↓ ${capitalize(soon)}`,
    `↓↓ ${title}`,
    '↓',
  ];
}

export function boxClusterLayout(labels: string[], seed: string) {
  const random = seededRandom(seed);
  const round = (value: number) => Number(value.toFixed(3));
  const boxes = Array.from(
    { length: boxClusterGrids.wide.count },
    (_, index): ClusterBox => ({
      label: labels[index % labels.length],
      lift: round(0.8 + random() * 1.2),
      slots: {},
    }),
  );
  for (const [name, grid] of Object.entries(boxClusterGrids) as [BoxClusterGrid, (typeof boxClusterGrids)[BoxClusterGrid]][]) {
    const cells = Array.from({ length: grid.cols * grid.rows }, (_, cell) => cell);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    cells.slice(0, grid.count).forEach((cell, index) => {
      boxes[index].slots[name] = {
        col: cell % grid.cols,
        row: Math.floor(cell / grid.cols),
        x: round(random()),
        y: round(random()),
      };
    });
  }
  return boxes;
}

// ms the box rests at either end before moving again; the move itself is a CSS transition
export const boxClusterHold = (random: () => number = Math.random) => 700 + random() * 1800;
