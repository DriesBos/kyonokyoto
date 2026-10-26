'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_REGISTRY, categoryToken } from '../../../../../data/categories.mjs';
import gridStyles from '@/app/blocks/page.module.sass';
import { ActionIcon } from '@/app/EventCardDetail';
import GeneralButton from '@/app/GeneralButton';
import densityStyles from '@/app/GridDensityControls.module.sass';
import SiteHeader from '@/app/SiteHeader';
import { ArrowLong } from '@/app/SiteFooter';
import { cityConfigFor, cityConfigs } from '@/lib/cities';
import {
  GRID_COLUMN_BREAKPOINTS,
  GRID_DENSITY_ATTRIBUTE,
  columnsForDensity,
  normalizeGridDensity,
  type GridDensity,
} from '@/lib/gridDensity';
import styles from './DesignSystem.module.sass';

const kyoto = cityConfigFor('kyoto')!;
const densities: GridDensity[] = [-1, 0, 1];
// Every registered category, so the filter panel shows all of them.
const categories = Object.entries(CATEGORY_REGISTRY).flatMap(([dimension, list]) =>
  list.map((category) => ({
    slug: categoryToken(dimension, category),
    label: category,
    dimension,
  })),
);

// Shared tokens from styles/globals.sass; their values are read from the page at runtime.
const colorTokens = [
  { name: '--color-text', use: 'text (city colour)' },
  { name: '--stroke', use: 'lines and icons' },
  { name: '--color-background', use: 'background' },
  { name: '--color-pink', use: 'press dot, image placeholder' },
];

function useTokenValues() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setValues(
      Object.fromEntries(
        colorTokens.map(({ name }) => [name, computed.getPropertyValue(name).trim()]),
      ),
    );
  }, []);
  return values;
}

const breakpointLabel = (index: number) => {
  const { maxWidth } = GRID_COLUMN_BREAKPOINTS[index];
  return maxWidth === null ? `> ${GRID_COLUMN_BREAKPOINTS[1].maxWidth}px` : `≤ ${maxWidth}px`;
};

// Reads the live column count off the real grid, so the table can mark the active cell.
function useLiveColumns() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{
    columns: number;
    density: GridDensity;
    padding: { left: string; right: string };
  } | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const sync = () => {
      const computed = getComputedStyle(grid);
      setState({
        columns: computed.gridTemplateColumns.split(' ').length,
        padding: { left: computed.paddingLeft, right: computed.paddingRight },
        density: normalizeGridDensity(
          document.documentElement.getAttribute(GRID_DENSITY_ATTRIBUTE) ?? 0,
        ),
      });
    };
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(grid);
    const attributes = new MutationObserver(sync);
    attributes.observe(document.documentElement, { attributeFilter: [GRID_DENSITY_ATTRIBUTE] });
    return () => {
      resize.disconnect();
      attributes.disconnect();
    };
  }, []);

  return { gridRef, live: state };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      {children}
    </section>
  );
}

function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className={styles.specimen}>
      <div className={styles.sample}>{children}</div>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}

export default function DesignSystem() {
  const [mapOpen, setMapOpen] = useState(false);
  const [toggled, setToggled] = useState(false);
  const toggleMap = useCallback(() => setMapOpen((open) => !open), []);
  const { gridRef, live } = useLiveColumns();
  const tokenValues = useTokenValues();

  // The root layout only sets data-city on a full load, so a client-side visit from another
  // city keeps that city's colours. Force Kyoto while this page is open.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.city;
    root.dataset.city = 'kyoto';
    return () => {
      if (previous) root.dataset.city = previous;
    };
  }, []);

  return (
    <>
      <SiteHeader
        city="kyoto"
        locale="en"
        brandLabel={kyoto.brandLabel}
        categories={categories}
        mapOpen={mapOpen}
        onMapToggle={toggleMap}
      />
      <main className={styles.main}>
        <Section title="colours">
          <p className={styles.note}>
            Each city sets the text and stroke colour on the shared beige. This page uses Kyoto.
          </p>
          <div className={styles.row}>
            {cityConfigs.map((config) => (
              <Specimen key={config.slug} caption={`${config.label} ${config.themeColor}`}>
                <span className={styles.swatch} style={{ background: config.themeColor }} />
              </Specimen>
            ))}
          </div>
          <div className={styles.row}>
            {colorTokens.map(({ name, use }) => (
              <Specimen key={name} caption={`${name} ${tokenValues[name] ?? ''}, ${use}`}>
                <span className={styles.swatch} style={{ background: `var(${name})` }} />
              </Specimen>
            ))}
          </div>
        </Section>

        <Section title="button">
          <div className={styles.row}>
            <Specimen caption="default">
              <GeneralButton verticalPadding="full" label="button" />
            </Specimen>
            <Specimen caption="pressed">
              <GeneralButton verticalPadding="full" label="button" showDot pressed />
            </Specimen>
            <Specimen caption="toggle (try it)">
              <GeneralButton
                verticalPadding="full"
                label={toggled ? 'on' : 'off'}
                showDot
                pressed={toggled}
                onClick={() => setToggled((value) => !value)}
              />
            </Specimen>
            <Specimen caption="current page link">
              <GeneralButton
                verticalPadding="full"
                href="/dev/"
                label="dev"
                showDot
                aria-current="page"
              />
            </Specimen>
            <Specimen caption="disabled (0.5)">
              <GeneralButton verticalPadding="full" label="button" disabled />
            </Specimen>
          </div>
        </Section>

        <Section title="icons">
          <div className={styles.row}>
            <Specimen caption="plus">
              <span className={densityStyles.step}>
                <span className={`${densityStyles.icon} ${densityStyles.plus}`} />
              </span>
            </Specimen>
            <Specimen caption="minus">
              <span className={densityStyles.step}>
                <span className={densityStyles.icon} />
              </span>
            </Specimen>
            <Specimen caption="plus, at limit (0.5)">
              <span className={densityStyles.step} aria-disabled="true">
                <span className={`${densityStyles.icon} ${densityStyles.plus}`} />
              </span>
            </Specimen>
            <Specimen caption="minus, at limit (0.5)">
              <span className={densityStyles.step} aria-disabled="true">
                <span className={densityStyles.icon} />
              </span>
            </Specimen>
            <Specimen caption="arrow (footer)">
              <ArrowLong />
            </Specimen>
            {(['exit', 'map', 'calendar'] as const).map((name) => (
              <Specimen key={name} caption={`${name} (card)`}>
                <span className={styles.actionIcon}>
                  <ActionIcon name={name} />
                </span>
              </Specimen>
            ))}
          </div>
        </Section>

        <Section title="breakpoints">
          <p className={styles.note}>
            Columns follow the events panel width (viewport here). The header + and − shift
            every breakpoint by one step. The live cell is marked.
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">panel width</th>
                <th scope="col">−</th>
                <th scope="col">default</th>
                <th scope="col">+</th>
              </tr>
            </thead>
            <tbody>
              {GRID_COLUMN_BREAKPOINTS.map(({ columns }, index) => (
                <tr key={index}>
                  <th scope="row">{breakpointLabel(index)}</th>
                  {densities.map((density) => {
                    const active =
                      live?.density === density &&
                      columnsForDensity(columns, density) === live.columns;
                    return (
                      <td key={density} data-active={active || undefined}>
                        {columnsForDensity(columns, density)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.note}>Live grid: {live ? `${live.columns} columns` : '…'}</p>
          <div className={`${gridStyles.grid} ${styles.liveGrid}`} ref={gridRef}>
            {live && (
              <>
                <span className={styles.paddingGuide} style={{ left: 0, width: live.padding.left }} />
                <span
                  className={styles.paddingGuide}
                  style={{ right: 0, width: live.padding.right }}
                />
              </>
            )}
            {Array.from({ length: 10 }, (_, index) => (
              <div className={styles.cell} key={index}>
                {index + 1}
              </div>
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}
