import styles from './page.module.sass';

// The 3D box behind a block's front: back plane plus the two visible side faces, drawn as SVG
// so every line keeps the same width (non-scaling stroke), diagonals included. Geometry, depth
// and the mirroring for negative offsets all come from the --block-* vars in page.module.sass.
export function BoxSides() {
  return (
    <svg className={styles.boxSides} aria-hidden="true" focusable="false">
      <g className={styles.boxOrient}>
        <rect className={styles.boxBack} width="100%" height="100%" />
        <rect className={styles.boxFaceY} width="100%" />
        <rect className={styles.boxFaceX} height="100%" />
      </g>
    </svg>
  );
}

// Class for the box's front: shifts it toward the viewer by the extra depth
export const boxLift = styles.boxLift;

// The front's outline, layered above the front so its content never covers the line
export function BoxEdge() {
  return (
    <svg className={styles.boxEdge} aria-hidden="true" focusable="false">
      <rect width="100%" height="100%" />
    </svg>
  );
}
