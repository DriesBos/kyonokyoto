'use client';

import { useEffect, useRef, useState } from 'react';
import { COLOR_SCHEME_ATTRIBUTE } from '@/lib/colorScheme';
import { getAppliedFilters, subscribeAppliedFilters } from '@/lib/filterStore';
import { uiText, type AppLocale } from '@/lib/i18n';
import {
  ensureGoogleMapsLoader,
  MAP_CLOSED_EVENT,
  type MapsWindow as BaseMapsWindow,
} from '@/lib/googleMapsLoader';
import { scrollHeaderOverlap } from '@/lib/mapOverlap';
import styles from './GoogleMapCanvas.module.sass';

export type MapSource = {
  id: string;
  sourceSlug: string;
  name: string;
  lat: number;
  lng: number;
};

type MapPosition = { lat: number; lng: number };

type MapInstance = {
  addListener?: (eventName: string, callback: () => void) => { remove: () => void };
  panTo?: (position: MapPosition) => void;
  setZoom?: (zoom: number) => void;
  fitBounds?: (bounds: unknown, padding?: number) => void;
};

type LatLngBoundsInstance = { extend: (position: MapPosition) => void };
type LatLngBoundsConstructor = new () => LatLngBoundsInstance;

type GoogleMapConstructor = new (
  element: HTMLElement,
  options: Record<string, unknown>,
) => MapInstance;

type AdvancedMarkerInstance = {
  map: unknown | null;
  position?: MapPosition;
  zIndex?: number | null;
  addEventListener?: (eventName: string, callback: () => void) => void;
};

type AdvancedMarkerConstructor = new (options: {
  map: unknown;
  position: MapPosition;
  title: string;
  content: HTMLElement;
  anchorLeft?: string;
  gmpClickable?: boolean;
}) => AdvancedMarkerInstance;

type MapsWindow = BaseMapsWindow & {
  google?: { maps?: { Map?: GoogleMapConstructor } };
};

export type GoogleMapCanvasProps = {
  cityLabel: string;
  mapCenter: MapPosition;
  sources: MapSource[];
  apiKey?: string;
  mapId?: string;
  locale?: AppLocale;
};

const defaultCenter = { lat: 35.0240977, lng: 135.7621436 };

const isVisible = (element: HTMLElement) =>
  !element.hidden && !element.closest('[hidden]') && element.getClientRects().length > 0;

// Cards hidden by the filters (or in a hidden group) are out; cheap, no layout read.
const isFilteredIn = (card: HTMLElement) => !card.hidden && !card.closest('[hidden]');

// Every card on the page by map location, in one query (data-map-location-id, EventsGrid).
const cardsByLocation = () => {
  const index = new Map<string, HTMLElement[]>();
  document
    .querySelectorAll<HTMLElement>('[data-event-card][data-map-location-id]')
    .forEach((card) => {
      const id = card.dataset.mapLocationId ?? '';
      const cards = index.get(id);
      if (cards) cards.push(card);
      else index.set(id, [card]);
    });
  return index;
};

const sourceCards = (locationId: string) => cardsByLocation().get(locationId) ?? [];

// The map follows the site's colour scheme (the header toggle, lib/colorScheme). Cloud styling
// for the mapId needs a dark variant set up, else Google uses its default dark style.
const readDarkScheme = () =>
  document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE) === 'dark';
const useDarkScheme = () => {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => setDark(readDarkScheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributeFilter: [COLOR_SCHEME_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);
  return dark;
};

// Filter changes zoom the map to the venues left, up to this zoom (a single venue).
const FIT_MAX_ZOOM = 15;
const FIT_PADDING = 48;

const markerContent = (source: MapSource) => {
  // not a <button>: AdvancedMarkerElement (gmpClickable) is the focusable, clickable element, and
  // Maps warns about focusable children inside it
  const marker = document.createElement('div');
  marker.className = styles.marker;
  marker.dataset.locationId = source.id;
  marker.dataset.sourceSlug = source.sourceSlug;
  marker.setAttribute('aria-label', source.name);
  marker.innerHTML = `<span class="${styles.markerDot}" aria-hidden="true"></span><span class="${styles.markerStar}" aria-hidden="true"><svg viewBox="0 0 25 25" focusable="false"><path d="M12.5 1.75L15.77 8.38L23.08 9.45L17.79 14.6L19.04 21.88L12.5 18.44L5.96 21.88L7.21 14.6L1.92 9.45L9.23 8.38L12.5 1.75Z" /></svg></span><span class="${styles.markerLabel}"></span>`;
  marker.querySelector(`.${styles.markerLabel}`)?.replaceChildren(source.name);
  return marker;
};

const userMarkerContent = () => {
  const marker = document.createElement('div');
  marker.className = styles.userMarker;
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = `<span class="${styles.userRing}"></span><span class="${styles.userRing} ${styles.userRingSecond}"></span><span class="${styles.userPointer}"></span>`;
  return marker;
};

export default function GoogleMapCanvas({
  cityLabel,
  mapCenter = defaultCenter,
  sources,
  apiKey = '',
  mapId = '',
  locale = 'en',
}: GoogleMapCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const findMeButtonRef = useRef<HTMLButtonElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const copy = uiText[locale];
  // the map is built for one scheme (colorScheme is fixed per Map), so a toggle rebuilds it
  const dark = useDarkScheme();

  useEffect(() => {
    const viewport = viewportRef.current;
    const placeholder = placeholderRef.current;
    const findMeButton = findMeButtonRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !placeholder || !findMeButton || !canvas) return;

    const showPlaceholder = (message: string, detail?: string) => {
      placeholder.hidden = false;
      placeholder.querySelector('[data-map-placeholder-message]')?.replaceChildren(message);
      if (detail)
        placeholder.querySelector('[data-map-placeholder-detail]')?.replaceChildren(detail);
    };

    if (!apiKey || !mapId) {
      showPlaceholder(copy.mapUnavailable, copy.addMapsEnv);
      return;
    }
    if (sources.length === 0) {
      showPlaceholder(copy.noMapLocations);
      return;
    }

    let cancelled = false;
    let watchId: number | null = null;
    let hasCenteredUserLocation = false;
    let userMarker: AdvancedMarkerInstance | null = null;
    let userContent: HTMLElement | null = null;
    const markerRecords: {
      marker: AdvancedMarkerInstance;
      source: MapSource;
      content: HTMLElement;
    }[] = [];
    const listeners: [string, EventListener][] = [];
    // The panel shows the city colour until the first tiles are in, then the map fades in over it
    // (data-map-ready, GoogleMapCanvas.module.sass). The timeout covers maps that never report
    // tilesloaded, e.g. when Google rejects the key and draws its own error box.
    let revealTimeout: number | undefined;
    const reveal = () => {
      window.clearTimeout(revealTimeout);
      canvas.setAttribute('data-map-ready', '');
    };

    const setStatus = (message = '') => {
      if (statusRef.current) statusRef.current.textContent = message;
    };
    const stopUserTracking = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      if (userMarker) userMarker.map = null;
      hasCenteredUserLocation = false;
      findMeButton.setAttribute('aria-pressed', 'false');
      setStatus();
    };

    const initialize = async () => {
      try {
        ensureGoogleMapsLoader(apiKey, mapId);
        const mapWindow = window as MapsWindow;
        const [mapsLibrary, markerLibrary, coreLibrary] = await Promise.all([
          mapWindow.google?.maps?.importLibrary?.('maps'),
          mapWindow.google?.maps?.importLibrary?.('marker'),
          mapWindow.google?.maps?.importLibrary?.('core'),
        ]);
        if (cancelled) return;

        const MapConstructor =
          (mapsLibrary as { Map?: GoogleMapConstructor })?.Map ?? mapWindow.google?.maps?.Map;
        const AdvancedMarkerElement = (
          markerLibrary as { AdvancedMarkerElement?: AdvancedMarkerConstructor }
        )?.AdvancedMarkerElement;
        const { ColorScheme, LatLngBounds } = (coreLibrary ?? {}) as {
          ColorScheme?: { LIGHT?: unknown; DARK?: unknown };
          LatLngBounds?: LatLngBoundsConstructor;
        };
        const colorScheme = dark ? ColorScheme?.DARK : ColorScheme?.LIGHT;
        if (!MapConstructor || !AdvancedMarkerElement)
          throw new Error('Google Maps constructors unavailable.');

        const map = new MapConstructor(viewport, {
          center: mapCenter,
          zoom: window.matchMedia('(max-width: 768px)').matches ? 13 : 14,
          mapId,
          // roadmap: the only type vector maps (smooth zoom, cloud styling) render; terrain forced raster
          mapTypeId: 'roadmap',
          ...(colorScheme ? { colorScheme } : {}),
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: true,
        });
        placeholder.hidden = true;
        const tilesListener = map.addListener?.('tilesloaded', () => {
          tilesListener?.remove();
          reveal();
        });
        revealTimeout = window.setTimeout(reveal, 3000);

        // Scroll the venue's first visible card to the top of whatever scrolls the list (the events
        // panel, or the page under the sticky header or phone map). The card's scroll-margin
        // (.block in page.module.sass) keeps it clear of the header, the lifted front and the map.
        const scrollToSource = (locationId: string) => {
          const card = sourceCards(locationId).find(isVisible);
          if (!card) return;
          card.style.setProperty('--scroll-header', `${scrollHeaderOverlap(card)}px`);
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          card.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
        };

        // The venue picked on the map: its marker shows the venue name and its visible cards get the
        // inverted front (data-map-target), until the next click/tap anywhere or Escape.
        let selectedId: string | null = null;
        const markTargetCards = () => {
          document
            .querySelectorAll<HTMLElement>('[data-event-card][data-map-target]')
            .forEach((card) => card.removeAttribute('data-map-target'));
          if (!selectedId) return;
          sourceCards(selectedId)
            .filter(isVisible)
            .forEach((card) => card.setAttribute('data-map-target', ''));
        };
        const selectSource = (locationId: string | null) => {
          selectedId = locationId;
          markTargetCards();
          applyFilters();
        };

        const highlighted = new Map<
          string,
          { marker: AdvancedMarkerInstance; content: HTMLElement }
        >();
        const clearHighlight = () => {
          highlighted.forEach(({ marker, content }) => {
            content.removeAttribute('data-highlighted');
            marker.zIndex = 0;
          });
          highlighted.clear();
        };
        // A venue's marker shows while one of its cards does (the header's filters already decided
        // which cards show); with saved on, only venues with a visible starred card. A marker with
        // no cards on the page (a venue page's own pin) always shows, saved aside.
        const visibleMarkerIds = () => {
          const { saved } = getAppliedFilters();
          const index = cardsByLocation();
          const visible = new Set<string>();
          const starred = new Set<string>();
          markerRecords.forEach(({ source: { id } }) => {
            const cards = index.get(id) ?? [];
            if (cards.some((card) => card.dataset.starred === 'true')) starred.add(id);
            const shown = cards.filter(isFilteredIn);
            const show = saved
              ? shown.some((card) => card.dataset.starred === 'true')
              : cards.length === 0 || shown.length > 0;
            if (show) visible.add(id);
          });
          return { visible, starred };
        };
        const applyFilters = () => {
          const { visible, starred } = visibleMarkerIds();
          markerRecords.forEach(({ marker, source, content }) => {
            const shown = visible.has(source.id);
            marker.map = shown ? map : null;
            content.toggleAttribute('data-hidden', !shown);
            content.toggleAttribute('data-starred', starred.has(source.id));
          });
          clearHighlight();
          const id = selectedId;
          const record = id ? markerRecords.find(({ source }) => source.id === id) : undefined;
          if (id && record && !record.content.hasAttribute('data-hidden')) {
            record.content.setAttribute('data-highlighted', '');
            record.marker.zIndex = 1000;
            highlighted.set(id, record);
          }
        };

        // Filter changes fit the map to the venues still shown, unless the visitor has moved the
        // map themselves. A fit while the panel is collapsed (zero size) waits for it to open.
        let userMoved = false;
        let fitPending = false;
        const fitToVisible = () => {
          if (userMoved) return;
          if (viewport.clientWidth === 0 || viewport.clientHeight === 0) {
            fitPending = true;
            return;
          }
          fitPending = false;
          const shown = markerRecords.filter(({ content }) => !content.hasAttribute('data-hidden'));
          if (shown.length === 0) return;
          if (shown.length === 1 || !LatLngBounds || !map.fitBounds) {
            map.panTo?.({ lat: shown[0].source.lat, lng: shown[0].source.lng });
            map.setZoom?.(FIT_MAX_ZOOM);
            return;
          }
          const bounds = new LatLngBounds();
          shown.forEach(({ source }) => bounds.extend({ lat: source.lat, lng: source.lng }));
          map.fitBounds(bounds, FIT_PADDING);
          const zoomListener = map.addListener?.('idle', () => {
            zoomListener?.remove();
            const zoom = (map as { getZoom?: () => number }).getZoom?.();
            if (typeof zoom === 'number' && zoom > FIT_MAX_ZOOM) map.setZoom?.(FIT_MAX_ZOOM);
          });
        };
        const markUserMoved = () => {
          userMoved = true;
        };
        const dragListener = map.addListener?.('dragstart', markUserMoved);
        viewport.addEventListener('wheel', markUserMoved, { passive: true });
        viewport.addEventListener('keydown', markUserMoved);
        const onTouchMove = (event: TouchEvent) => {
          if (event.touches.length > 1) userMoved = true;
        };
        viewport.addEventListener('touchmove', onTouchMove, { passive: true });
        const resizeObserver = new ResizeObserver(() => {
          if (fitPending) fitToVisible();
        });
        resizeObserver.observe(viewport);

        sources.forEach((source) => {
          const content = markerContent(source);
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: source.lat, lng: source.lng },
            title: source.name,
            content,
            anchorLeft: '-0.625rem',
            gmpClickable: true,
          });
          marker.addEventListener?.('gmp-click', () => {
            selectSource(source.id);
            scrollToSource(source.id);
          });
          markerRecords.push({ marker, source, content });
        });

        const updateFindMe = (position: GeolocationPosition) => {
          const nextPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
          if (!userContent) userContent = userMarkerContent();
          const heading =
            typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading)
              ? position.coords.heading
              : 0;
          userContent.style.setProperty('--map-user-heading', `${heading}deg`);
          if (!userMarker) {
            userMarker = new AdvancedMarkerElement({
              map,
              position: nextPosition,
              title: 'Your location',
              content: userContent,
            });
          } else {
            userMarker.position = nextPosition;
            userMarker.map = map;
          }
          userMarker.zIndex = 2000;
          if (!hasCenteredUserLocation) {
            map.panTo?.(nextPosition);
            map.setZoom?.(window.matchMedia('(max-width: 768px)').matches ? 14 : 15);
            hasCenteredUserLocation = true;
          }
          setStatus();
        };
        const onFindMe = () => {
          if (watchId !== null) {
            stopUserTracking();
            return;
          }
          if (!navigator.geolocation) {
            findMeButton.disabled = true;
            setStatus(copy.locationUnavailable);
            return;
          }
          findMeButton.setAttribute('aria-pressed', 'true');
          setStatus(copy.findingLocation);
          hasCenteredUserLocation = false;
          watchId = navigator.geolocation.watchPosition(
            updateFindMe,
            () => {
              stopUserTracking();
              setStatus(copy.locationUnavailable);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
          );
        };
        findMeButton.addEventListener('click', onFindMe);
        // The header applied new picks (or stars changed what shows): only a change of the picks
        // themselves refits the view.
        let lastPicks = '';
        const picksKey = () => {
          const { tokens, timing, venues, saved } = getAppliedFilters();
          return JSON.stringify([[...tokens].sort(), timing, [...venues].sort(), saved]);
        };
        lastPicks = picksKey();
        const unsubscribeFilters = subscribeAppliedFilters(() => {
          applyFilters();
          markTargetCards();
          const picks = picksKey();
          if (picks !== lastPicks) {
            lastPicks = picks;
            fitToVisible();
          }
        });
        // Any new click/tap (on a card, the map, the header) or Escape ends the venue highlight.
        // A marker click lands after this pointerdown, so picking another venue still works.
        const onPointerDown: EventListener = () => {
          if (selectedId) selectSource(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape' && selectedId) selectSource(null);
        };
        const onMapClosed: EventListener = () => {
          stopUserTracking();
          if (selectedId) selectSource(null);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener(MAP_CLOSED_EVENT, onMapClosed);
        listeners.push([MAP_CLOSED_EVENT, onMapClosed]);
        applyFilters();

        return () => {
          unsubscribeFilters();
          dragListener?.remove();
          viewport.removeEventListener('wheel', markUserMoved);
          viewport.removeEventListener('keydown', markUserMoved);
          viewport.removeEventListener('touchmove', onTouchMove);
          resizeObserver.disconnect();
          findMeButton.removeEventListener('click', onFindMe);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
          selectedId = null;
          markTargetCards();
        };
      } catch (error) {
        console.error(error);
        showPlaceholder(copy.mapFailed);
        reveal();
      }
    };

    let dispose: (() => void) | undefined;
    void initialize().then((cleanup) => {
      if (cleanup) dispose = cleanup;
    });
    return () => {
      cancelled = true;
      window.clearTimeout(revealTimeout);
      dispose?.();
      stopUserTracking();
      markerRecords.forEach(({ marker }) => {
        marker.map = null;
      });
      listeners.forEach(([name, listener]) => document.removeEventListener(name, listener));
    };
  }, [apiKey, copy, dark, mapCenter, mapId, sources]);

  return (
    <div
      className={styles.canvas}
      ref={canvasRef}
      role="region"
      aria-label={copy.culturalMap(cityLabel)}
    >
      <div className={styles.viewport} ref={viewportRef} />
      <div className={styles.controls}>
        <button
          ref={findMeButtonRef}
          className={styles.findMe}
          type="button"
          aria-pressed="false"
          aria-describedby="map-find-me-status"
        >
          <span>{copy.findMe}</span>
        </button>
        <p className={styles.status} id="map-find-me-status" ref={statusRef} aria-live="polite" />
      </div>
      <div className={styles.placeholder} ref={placeholderRef} hidden>
        <p data-map-placeholder-message>{copy.mapUnavailable}</p>
        <p data-map-placeholder-detail>{copy.addMapsEnv}</p>
      </div>
    </div>
  );
}
