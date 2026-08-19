'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import GoogleMapCanvas, { type GoogleMapCanvasProps } from './GoogleMapCanvas';
import styles from './MapExperience.module.sass';

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

export default function MapExperience({
  header,
  children,
  defaultOpen = false,
  className,
  ...mapProps
}: MapExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mapOpen, setMapOpen] = useState(defaultOpen);
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
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!mapOpen) return;
    const root = rootRef.current;
    if (!root) return;
    event.currentTarget.setPointerCapture(event.pointerId);
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
      <div className={[styles.shell, className].filter(Boolean).join(' ')}>
        {header}
        <div
          className={styles.content}
          data-content-container
          data-map-visible={mapOpen || undefined}
          ref={rootRef}
          style={panelStyle}
        >
          <section className={styles.events} data-events-section>
            {children}
          </section>
          {mapOpen && (
            <>
              <div
                className={styles.resizer}
                data-map-resizer
                role="separator"
                tabIndex={0}
                aria-label="Resize map"
                aria-orientation={isMobile ? 'horizontal' : 'vertical'}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onSeparatorKeyDown}
              />
              <section className={styles.map} id="map-section" data-map-section>
                <GoogleMapCanvas {...mapProps} />
              </section>
            </>
          )}
        </div>
      </div>
    </MapExperienceContext.Provider>
  );
}

export const MapLayout = MapExperience;
