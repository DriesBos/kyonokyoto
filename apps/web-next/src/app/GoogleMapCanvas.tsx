'use client';

import { useEffect, useRef } from 'react';
import { uiText, type AppLocale } from '@/lib/i18n';
import styles from './GoogleMapCanvas.module.sass';

export type MapSource = {
  id: string;
  sourceSlug: string;
  name: string;
  categories: string[];
  lat: number;
  lng: number;
};

type MapPosition = { lat: number; lng: number };

type MapInstance = {
  panTo?: (position: MapPosition) => void;
  setZoom?: (zoom: number) => void;
};

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

type MapsWindow = Window &
  typeof globalThis & {
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
        Map?: GoogleMapConstructor;
        __ib__?: () => void;
      };
    };
    __kyoGoogleMapsLoader?: Promise<void>;
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

const ensureGoogleMapsLoader = (apiKey: string, mapId: string) => {
  const mapWindow = window as MapsWindow;
  mapWindow.google ??= {};
  mapWindow.google.maps ??= {};

  if (mapWindow.google.maps.importLibrary) return;

  const requestedLibraries = new Set<string>();
  const bootstrapImportLibrary = (libraryName: string) => {
    requestedLibraries.add(libraryName);

    if (!mapWindow.__kyoGoogleMapsLoader) {
      mapWindow.__kyoGoogleMapsLoader = new Promise((resolve, reject) => {
        const maps = mapWindow.google?.maps;
        if (!maps) {
          reject(new Error('Google Maps namespace unavailable.'));
          return;
        }

        const parameters = new URLSearchParams({
          key: apiKey,
          v: 'weekly',
          libraries: Array.from(requestedLibraries).join(','),
          callback: 'google.maps.__ib__',
        });
        if (mapId) parameters.set('map_ids', mapId);

        maps.__ib__ = resolve;
        queueMicrotask(() => {
          parameters.set('libraries', Array.from(requestedLibraries).join(','));
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
          script.async = true;
          script.onerror = () => reject(new Error('Google Maps JavaScript API could not load.'));
          document.head.append(script);
        });
      });
    }

    return mapWindow.__kyoGoogleMapsLoader.then(() => {
      const importLibrary = mapWindow.google?.maps?.importLibrary;
      return importLibrary && importLibrary !== bootstrapImportLibrary
        ? importLibrary(libraryName)
        : mapWindow.google?.maps ?? {};
    });
  };

  mapWindow.google.maps.importLibrary = bootstrapImportLibrary;
};

const isVisible = (element: HTMLElement) =>
  !element.hidden && !element.closest('[hidden]') && element.getClientRects().length > 0;

const activeCategoryGroups = () => {
  const groups = new Map<string, string[]>();
  document
    .querySelectorAll<HTMLElement>("[data-category-button][aria-pressed='true']")
    .forEach((button) => {
      const category = button.dataset.category;
      const dimension = button.dataset.categoryDimension;
      if (category && dimension) {
        groups.set(dimension, [...(groups.get(dimension) ?? []), category]);
      }
    });
  return groups;
};

const matchesCategories = (categories: string[], groups: Map<string, string[]>) =>
  [...groups.values()].every((group) => group.some((category) => categories.includes(category)));

const sourceCards = (locationId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-event-card]')).filter(
    (card) => card.dataset.mapLocationId === locationId,
  );

const markerContent = (source: MapSource) => {
  const marker = document.createElement('button');
  marker.type = 'button';
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
  const copy = uiText[locale];

  useEffect(() => {
    const viewport = viewportRef.current;
    const placeholder = placeholderRef.current;
    const findMeButton = findMeButtonRef.current;
    if (!viewport || !placeholder || !findMeButton) return;

    const showPlaceholder = (message: string, detail?: string) => {
      placeholder.hidden = false;
      placeholder.querySelector('[data-map-placeholder-message]')?.replaceChildren(message);
      if (detail) placeholder.querySelector('[data-map-placeholder-detail]')?.replaceChildren(detail);
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
    const markerRecords: { marker: AdvancedMarkerInstance; source: MapSource; content: HTMLElement }[] = [];
    const listeners: [string, EventListener][] = [];

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
        const ColorScheme = (coreLibrary as { ColorScheme?: { LIGHT?: unknown } })?.ColorScheme;
        if (!MapConstructor || !AdvancedMarkerElement) throw new Error('Google Maps constructors unavailable.');

        const map = new MapConstructor(viewport, {
          center: mapCenter,
          zoom: window.matchMedia('(max-width: 768px)').matches ? 13 : 14,
          mapId,
          mapTypeId: 'terrain',
          ...(ColorScheme?.LIGHT ? { colorScheme: ColorScheme.LIGHT } : {}),
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: true,
        });
        placeholder.hidden = true;

        const scrollToSource = (locationId: string) => {
          const card = sourceCards(locationId).find(isVisible);
          if (!card) return;
          const events = card.closest<HTMLElement>('[data-events-section]');
          if (events && events.scrollHeight > events.clientHeight) {
            events.scrollTo({ top: Math.max(0, card.offsetTop - events.offsetTop), behavior: 'smooth' });
          } else {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        };

        const highlighted = new Map<string, { marker: AdvancedMarkerInstance; content: HTMLElement }>();
        const clearHighlight = () => {
          highlighted.forEach(({ marker, content }) => {
            content.removeAttribute('data-highlighted');
            marker.zIndex = 0;
          });
          highlighted.clear();
        };
        const applyFilters = () => {
          const groups = activeCategoryGroups();
          const starredOnly = document.querySelector("[data-starred-button][aria-pressed='true']") !== null;
          markerRecords.forEach(({ marker, source, content }) => {
            const cards = sourceCards(source.id);
            const visibleCards = cards.filter(isVisible);
            const visible = matchesCategories(source.categories, groups)
              && (!cards.length || visibleCards.length > 0)
              && (!starredOnly || visibleCards.some((card) => card.dataset.starred === 'true'));
            marker.map = visible ? map : null;
            content.toggleAttribute('data-hidden', !visible);
            content.toggleAttribute('data-starred', cards.some((card) => card.dataset.starred === 'true'));
          });
          clearHighlight();
          const activeCard = document.querySelector<HTMLElement>("[data-event-card][data-active='true']");
          const id = activeCard?.dataset.mapLocationId;
          const record = id ? markerRecords.find(({ source }) => source.id === id) : undefined;
          if (id && record && !record.content.hasAttribute('data-hidden')) {
            record.content.setAttribute('data-highlighted', '');
            record.marker.zIndex = 1000;
            highlighted.set(id, record);
          }
        };

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
          marker.addEventListener?.('gmp-click', () => scrollToSource(source.id));
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
        const onFilterUpdate: EventListener = () => applyFilters();
        const onActiveChange: EventListener = () => applyFilters();
        document.addEventListener('event-filter:updated', onFilterUpdate);
        document.addEventListener('event-stars:updated', onFilterUpdate);
        document.addEventListener('event-card:active-change', onActiveChange);
        listeners.push(
          ['event-filter:updated', onFilterUpdate],
          ['event-stars:updated', onFilterUpdate],
          ['event-card:active-change', onActiveChange],
        );
        applyFilters();

        return () => findMeButton.removeEventListener('click', onFindMe);
      } catch (error) {
        console.error(error);
        showPlaceholder(copy.mapFailed);
      }
    };

    let dispose: (() => void) | undefined;
    void initialize().then((cleanup) => {
      if (cleanup) dispose = cleanup;
    });
    return () => {
      cancelled = true;
      dispose?.();
      stopUserTracking();
      markerRecords.forEach(({ marker }) => { marker.map = null; });
      listeners.forEach(([name, listener]) => document.removeEventListener(name, listener));
    };
  }, [apiKey, copy, mapCenter, mapId, sources]);

  return (
    <div className={styles.canvas} role="application" aria-label={`${cityLabel} cultural map`}>
      <div className={styles.viewport} ref={viewportRef} />
      <div className={styles.controls}>
        <button ref={findMeButtonRef} className={styles.findMe} type="button" aria-pressed="false" aria-describedby="map-find-me-status">
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
