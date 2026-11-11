'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type TransitionEvent,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { preconnect } from 'react-dom';
import { MAP_CLOSED_EVENT, warmGoogleMaps } from '@/lib/googleMapsLoader';
import { uiText } from '@/lib/i18n';
import { readLocaleHandoff } from '@/lib/localeHandoff';
import type { GoogleMapCanvasProps } from './GoogleMapCanvas';
import styles from './MapExperience.module.sass';

// The map only mounts once opened. Its chunk is prefetched when the browser is idle, and the Maps
// API itself on intent (hover/focus/press on the map button), so neither waits for the click.
const loadGoogleMapCanvas = () => import('./GoogleMapCanvas');
const GoogleMapCanvas = dynamic(loadGoogleMapCanvas, { ssr: false });

export type { GoogleMapCanvasProps, MapSource } from './GoogleMapCanvas';

type MapExperienceState = {
  mapOpen: boolean;
  setMapOpen: (open: boolean) => void;
  toggleMap: () => void;
};

const MapExperienceContext = createContext<MapExperienceState | null>(null);

export const useMapExperience = () => {
  const value = useContext(MapExperienceContext);
  if (!value) throw new Error('useMapExperience must be used inside MapExperience.');
  return value;
};

export function MapToggleButton({
  children = 'Map',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { mapOpen, toggleMap } = useMapExperience();
  return (
    <button
      type="button"
      {...props}
      aria-expanded={mapOpen}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleMap();
      }}
    >
      {children}
    </button>
  );
}

type MapExperienceProps = GoogleMapCanvasProps & {
  header?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

type PanelStyle = CSSProperties & {
  '--events-panel-size'?: string;
  '--map-panel-size'?: string;
};

const desktopMinimum = 320;
const mobileMinimum = 160;
const step = 24;
// Fallback for when transitionend never fires; matches the sass duration plus headroom.
const closeFallbackMs = 360;

const whenIdle = (callback: () => void) => {
  // Safari has no requestIdleCallback
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 2000);
  return () => window.clearTimeout(id);
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MapExperience({
  header,
  children,
  defaultOpen = false,
  className,
  ...mapProps
}: MapExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapSectionRef = useRef<HTMLElement>(null);
  const { apiKey = '', mapId = '' } = mapProps;
  // Open the connections early (rendered into <head>, static markup, ISR-safe).
  if (apiKey && mapId) {
    preconnect('https://maps.googleapis.com');
    preconnect('https://maps.gstatic.com');
  }
  // after a language switch the map stays as it was (lib/localeHandoff)
  const [initialOpen] = useState(
    () => readLocaleHandoff(mapProps.locale ?? 'en')?.mapOpen ?? defaultOpen,
  );
  const [mapOpen, setMapOpen] = useState(initialOpen);
  // The map stays mounted while it slides out, and only becomes visible once its closed state has
  // been laid out, so the panel always transitions in from zero size (see the layout effect).
  const [mapMounted, setMapMounted] = useState(initialOpen);
  const [mapVisible, setMapVisible] = useState(initialOpen);
  // Once opened, the map canvas stays in the DOM (collapsed while closed), so reopening reuses the
  // same google.maps.Map: no new billed map load, no tile reload. mapMounted only drives layout.
  const [mapCreated, setMapCreated] = useState(initialOpen);
  const [isMobile, setIsMobile] = useState(false);
  const [eventsPanelSize, setEventsPanelSize] = useState<number>();
  const [mapPanelSize, setMapPanelSize] = useState<number>();
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    events: number;
    map: number;
  } | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const warmedRef = useRef(false);
  const warmMap = () => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void loadGoogleMapCanvas();
    warmGoogleMaps(apiKey, mapId);
  };

  // Prefetch only the map's own code when idle; the Maps API waits for intent, so visitors who
  // never open the map don't download it.
  useEffect(() => whenIdle(() => void loadGoogleMapCanvas()), []);

  useEffect(() => {
    if (mapOpen) {
      warmMap();
      setMapCreated(true);
      setMapMounted(true);
      return;
    }

    setMapVisible(false);
    // the kept-alive canvas stops location tracking and drops its venue pick (GoogleMapCanvas)
    document.dispatchEvent(new CustomEvent(MAP_CLOSED_EVENT));
    if (prefersReducedMotion()) {
      setMapMounted(false);
      return;
    }
    const timeout = window.setTimeout(() => setMapMounted(false), closeFallbackMs);
    return () => window.clearTimeout(timeout);
  }, [mapOpen]);

  // Runs after the mounted (closed, zero-size) panel is in the DOM but before paint. Reading its
  // size forces the browser to lay out that start state, so flipping data-map-visible right after
  // always animates. The earlier double requestAnimationFrame could land before React had
  // committed the mount (first open: map chunk and first render), and the panel then jumped open.
  useLayoutEffect(() => {
    if (!mapOpen || !mapMounted || mapVisible) return;
    mapSectionRef.current?.getBoundingClientRect();
    setMapVisible(true);
  }, [mapOpen, mapMounted, mapVisible]);

  const onIntent = (event: { target: EventTarget | null }) => {
    if (!mapOpen && (event.target as Element | null)?.closest?.('[data-map-toggle]')) warmMap();
  };

  const context = useMemo(
    () => ({ mapOpen, setMapOpen, toggleMap: () => setMapOpen((open) => !open) }),
    [mapOpen],
  );
  const emitLayoutUpdate = () => document.dispatchEvent(new CustomEvent('map-layout:updated'));
  const setDesktopSize = (value: number) => {
    const width = rootRef.current?.clientWidth ?? 0;
    setEventsPanelSize(
      Math.min(Math.max(value, desktopMinimum), Math.max(desktopMinimum, width - desktopMinimum)),
    );
    emitLayoutUpdate();
  };
  const setMobileSize = (value: number) => {
    const maximum = Math.max(mobileMinimum, window.innerHeight * 0.7);
    setMapPanelSize(Math.min(Math.max(value, mobileMinimum), maximum));
    emitLayoutUpdate();
  };
  const onMapTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    // Desktop sizes the map via max-width, mobile via max-height.
    if (!['max-width', 'max-height'].includes(event.propertyName)) return;
    if (!mapOpen) setMapMounted(false);
    emitLayoutUpdate();
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!mapOpen) return;
    const root = rootRef.current;
    if (!root) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    root.toggleAttribute('data-map-resizing', true);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      events:
        eventsPanelSize ??
        root.querySelector<HTMLElement>('[data-events-section]')?.getBoundingClientRect().width ??
        root.clientWidth / 2,
      map:
        mapPanelSize ??
        root.querySelector<HTMLElement>('[data-map-section]')?.getBoundingClientRect().height ??
        window.innerHeight * 0.45,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (isMobile) setMobileSize(drag.map + event.clientY - drag.y);
    else setDesktopSize(drag.events + event.clientX - drag.x);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    rootRef.current?.removeAttribute('data-map-resizing');
  };
  const onSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const validKey = isMobile ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (!mapOpen || !validKey.includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? step * 3 : step;
    if (isMobile) {
      setMobileSize(
        (mapPanelSize ?? mobileMinimum) + (event.key === 'ArrowDown' ? amount : -amount),
      );
    } else {
      setDesktopSize(
        (eventsPanelSize ?? desktopMinimum) + (event.key === 'ArrowRight' ? amount : -amount),
      );
    }
  };
  const panelStyle: PanelStyle = {
    '--events-panel-size': eventsPanelSize ? `${eventsPanelSize}px` : undefined,
    '--map-panel-size': mapPanelSize ? `${mapPanelSize}px` : undefined,
  };

  return (
    <MapExperienceContext.Provider value={context}>
      <div
        className={[styles.shell, className].filter(Boolean).join(' ')}
        onPointerOver={onIntent}
        onFocus={onIntent}
        onPointerDown={onIntent}
      >
        {header}
        <div
          className={styles.content}
          data-content-container
          data-map-mounted={mapMounted || undefined}
          data-map-visible={mapVisible || undefined}
          ref={rootRef}
          style={panelStyle}
        >
          <section className={styles.events} data-events-section>
            {children}
          </section>
          {mapMounted && (
            <div
              className={styles.resizer}
              data-map-resizer
              role="separator"
              tabIndex={mapOpen ? 0 : -1}
              inert={!mapOpen}
              aria-label={uiText[mapProps.locale ?? 'en'].resizeMap}
              aria-orientation={isMobile ? 'horizontal' : 'vertical'}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onSeparatorKeyDown}
            >
              <span className={styles.handle} aria-hidden="true" />
            </div>
          )}
          {mapCreated && (
            <section
              className={styles.map}
              id="map-section"
              data-map-section
              ref={mapSectionRef}
              inert={!mapOpen}
              onTransitionEnd={onMapTransitionEnd}
            >
              <GoogleMapCanvas {...mapProps} />
            </section>
          )}
        </div>
      </div>
    </MapExperienceContext.Provider>
  );
}
