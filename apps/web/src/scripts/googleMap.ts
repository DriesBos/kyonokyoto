import { matchesCategoryGroups } from '../lib/sources';
import { scrollRootFor } from './scrollRoot';

type MapSource = {
  id: string;
  sourceSlug: string;
  name: string;
  categories: string[];
  lat: number;
  lng: number;
};

type MapInstance = {
  addListener?: (eventName: string, callback: () => void) => unknown;
  panTo?: (position: { lat: number; lng: number }) => void;
  setZoom?: (zoom: number) => void;
};

type AdvancedMarkerInstance = {
  map: unknown | null;
  position?: { lat: number; lng: number };
  zIndex?: number | null;
  addEventListener?: (eventName: string, callback: () => void) => void;
  addListener?: (eventName: string, callback: () => void) => unknown;
};

type AdvancedMarkerConstructor = new (options: {
  map: unknown;
  position: { lat: number; lng: number };
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
        Map?: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
        __ib__?: () => void;
      };
    };
    __kyoGoogleMapsLoader?: Promise<void>;
  };

const mapWindow = window as MapsWindow;
const mapElements = Array.from(document.querySelectorAll('[data-google-map]'));
const kyotoCenter = { lat: 35.0240977, lng: 135.7621436 };
const mobileMapQuery = window.matchMedia('(max-width: 768px)');
const getMapZoom = () => (mobileMapQuery.matches ? 13 : 14);
const getMapShell = (element: HTMLElement) => element.closest('.map-canvas') ?? element;
const pxFromCssVar = (name: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
};

const ensureGoogleMapsLoader = (apiKey: string, mapId: string) => {
  mapWindow.google = mapWindow.google ?? {};
  mapWindow.google.maps = mapWindow.google.maps ?? {};

  if (mapWindow.google.maps.importLibrary) return;

  const requestedLibraries = new Set<string>();

  const bootstrapImportLibrary = (libraryName: string) => {
    requestedLibraries.add(libraryName);

    if (!mapWindow.__kyoGoogleMapsLoader) {
      mapWindow.__kyoGoogleMapsLoader = new Promise((resolve, reject) => {
        if (!mapWindow.google?.maps) {
          reject(new Error('Google Maps namespace unavailable.'));
          return;
        }

        const parameters = new URLSearchParams({
          key: apiKey,
          v: 'weekly',
          libraries: Array.from(requestedLibraries).join(','),
          callback: 'google.maps.__ib__',
        });

        if (mapId) {
          parameters.set('map_ids', mapId);
        }

        mapWindow.google.maps.__ib__ = resolve;

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
        script.async = true;
        script.onerror = () => reject(new Error('Google Maps JavaScript API could not load.'));
        document.head.append(script);
      });
    }

    return mapWindow.__kyoGoogleMapsLoader.then(() => {
      const importLibrary = mapWindow.google?.maps?.importLibrary;

      if (importLibrary && importLibrary !== bootstrapImportLibrary) {
        return importLibrary(libraryName);
      }

      return mapWindow.google?.maps ?? {};
    });
  };

  mapWindow.google.maps.importLibrary = bootstrapImportLibrary;
};

const showPlaceholder = (element: Element, message?: string) => {
  const mapShell = element instanceof HTMLElement ? getMapShell(element) : element;
  if (mapShell instanceof HTMLElement) {
    mapShell.removeAttribute('data-map-loading');
  }

  const placeholder = mapShell.querySelector('[data-map-placeholder]');
  if (!(placeholder instanceof HTMLElement)) return;

  placeholder.hidden = false;
  if (message) {
    placeholder.querySelector('p')?.replaceChildren(message);
  }
};

const parseSources = (element: HTMLElement): MapSource[] => {
  const sourceScript = getMapShell(element).querySelector('[data-map-sources]');
  if (!(sourceScript instanceof HTMLScriptElement)) return [];

  try {
    const parsed = JSON.parse(sourceScript.textContent ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseMapCenter = (element: HTMLElement) => {
  const lat = Number(element.dataset.mapCenterLat);
  const lng = Number(element.dataset.mapCenterLng);

  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }

  return kyotoCenter;
};

const createMarkerContent = (source: MapSource) => {
  const marker = document.createElement('button');
  marker.className = 'map-marker';
  marker.type = 'button';
  marker.dataset.locationId = source.id;
  marker.dataset.sourceSlug = source.sourceSlug;
  marker.dataset.categories = source.categories.join('|');
  marker.setAttribute('aria-label', source.name);
  marker.innerHTML = `
    <span class="map-marker__dot" aria-hidden="true"></span>
    <span class="map-marker__star" aria-hidden="true">
      <svg viewBox="0 0 25 25" focusable="false">
        <path fill="var(--color-green)" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12.5 1.75L15.77 8.38L23.08 9.45L17.79 14.6L19.04 21.88L12.5 18.44L5.96 21.88L7.21 14.6L1.92 9.45L9.23 8.38L12.5 1.75Z" />
      </svg>
    </span>
    <span class="map-marker__label"></span>
  `;
  const label = marker.querySelector('.map-marker__label');
  if (label) label.textContent = source.name;
  return marker;
};

const createUserMarkerContent = () => {
  const marker = document.createElement('div');
  marker.className = 'map-user-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = `
    <span class="map-user-marker__ring"></span>
    <span class="map-user-marker__ring map-user-marker__ring--second"></span>
    <span class="map-user-marker__pointer"></span>
  `;
  return marker;
};

const getActiveMapCategories = () => {
  const groups = new Map<string, string[]>();
  document.querySelectorAll("[data-category-button][aria-pressed='true']").forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    const category = button.dataset.category ?? '';
    const dimension = button.dataset.categoryDimension ?? '';
    if (!category || !dimension) return;
    groups.set(dimension, [...(groups.get(dimension) ?? []), category]);
  });
  return groups;
};

const getActiveMapStarred = () => {
  const activeButton = document.querySelector("[data-starred-button][aria-pressed='true']");
  return activeButton instanceof HTMLElement;
};

const initMap = async (element: Element) => {
  if (!(element instanceof HTMLElement)) return;

  const apiKey = element.dataset.apiKey?.trim() ?? '';
  const mapId = element.dataset.mapId?.trim() ?? '';
  const mapCenter = parseMapCenter(element);
  const sources = parseSources(element);

  if (!apiKey || !mapId) {
    showPlaceholder(element);
    return;
  }

  if (sources.length === 0) {
    showPlaceholder(element, 'No map locations available.');
    return;
  }

  try {
    ensureGoogleMapsLoader(apiKey, mapId);
    const [mapsLibrary, markerLibrary, coreLibrary] = await Promise.all([
      mapWindow.google?.maps?.importLibrary?.('maps'),
      mapWindow.google?.maps?.importLibrary?.('marker'),
      mapWindow.google?.maps?.importLibrary?.('core'),
    ]);
    const MapConstructor =
      (
        mapsLibrary as {
          Map?: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
        }
      )?.Map ?? mapWindow.google?.maps?.Map;
    const AdvancedMarkerElement = (
      markerLibrary as { AdvancedMarkerElement?: AdvancedMarkerConstructor }
    )?.AdvancedMarkerElement;
    const ColorScheme = (coreLibrary as { ColorScheme?: { LIGHT?: unknown } })?.ColorScheme;

    if (!MapConstructor || !AdvancedMarkerElement) {
      throw new Error('Google Maps constructors unavailable.');
    }

    const mapShell = getMapShell(element);

    mapShell.querySelector('[data-map-placeholder]')?.setAttribute('hidden', '');
    if (mapShell instanceof HTMLElement) {
      mapShell.removeAttribute('data-map-loading');
    }

    const map = new MapConstructor(element, {
      center: mapCenter,
      zoom: getMapZoom(),
      mapId,
      mapTypeId: 'terrain',
      ...(ColorScheme?.LIGHT ? { colorScheme: ColorScheme.LIGHT } : {}),
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      keyboardShortcuts: true,
    });
    const findMeButton = mapShell.querySelector('[data-map-find-me]');
    const findMeStatus = mapShell.querySelector('[data-map-find-me-status]');
    let userWatchId: number | null = null;
    let userMarker: AdvancedMarkerInstance | null = null;
    let userMarkerContent: HTMLElement | null = null;
    let hasCenteredUserLocation = false;

    const setFindMeStatus = (message = '') => {
      if (findMeStatus instanceof HTMLElement) {
        findMeStatus.textContent = message;
      }
    };

    const setFindMePressed = (isPressed: boolean) => {
      if (findMeButton instanceof HTMLElement) {
        findMeButton.setAttribute('aria-pressed', String(isPressed));
      }
    };

    const stopUserTracking = () => {
      if (userWatchId !== null) {
        navigator.geolocation.clearWatch(userWatchId);
        userWatchId = null;
      }

      if (userMarker) {
        userMarker.map = null;
      }

      hasCenteredUserLocation = false;
      setFindMePressed(false);
      setFindMeStatus('');
    };

    const updateUserMarker = (position: GeolocationPosition) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const nextPosition = { lat, lng };
      const heading = Number.isFinite(position.coords.heading) ? position.coords.heading : 0;

      if (!userMarkerContent) {
        userMarkerContent = createUserMarkerContent();
      }

      userMarkerContent.style.setProperty('--map-user-heading', `${heading}deg`);

      if (!userMarker) {
        userMarker = new AdvancedMarkerElement({
          map,
          position: nextPosition,
          title: 'Your location',
          content: userMarkerContent,
        });
        userMarker.zIndex = 2000;
      } else {
        userMarker.position = nextPosition;
        userMarker.map = map;
        userMarker.zIndex = 2000;
      }

      if (!hasCenteredUserLocation) {
        map.panTo?.(nextPosition);
        map.setZoom?.(mobileMapQuery.matches ? 14 : 15);
        hasCenteredUserLocation = true;
      }

      setFindMeStatus('');
    };

    const startUserTracking = () => {
      if (!('geolocation' in navigator)) {
        if (findMeButton instanceof HTMLButtonElement) {
          findMeButton.disabled = true;
        }
        setFindMeStatus('location unavailable');
        return;
      }

      setFindMeStatus('finding location');
      setFindMePressed(true);
      hasCenteredUserLocation = false;
      userWatchId = navigator.geolocation.watchPosition(
        updateUserMarker,
        () => {
          stopUserTracking();
          setFindMeStatus('location unavailable');
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 12000,
        },
      );
    };

    if (findMeButton instanceof HTMLButtonElement) {
      findMeButton.addEventListener('click', () => {
        if (userWatchId !== null) {
          stopUserTracking();
          return;
        }

        startUserTracking();
      });
    }

    const getFirstVisibleLocationCard = (locationId: string) => {
      const eventsSection = document.querySelector('[data-events-section]');
      if (!(eventsSection instanceof HTMLElement)) return null;

      const escapedLocationId = locationId.replace(/["\\]/g, '\\$&');
      const locationCards = Array.from(
        document.querySelectorAll(`[data-event-card][data-map-location-id="${escapedLocationId}"]`),
      );
      const targetCard = locationCards.find((card) => {
        if (!(card instanceof HTMLElement)) return false;
        return !card.hidden && !card.closest('[hidden]') && card.getClientRects().length > 0;
      });

      return targetCard instanceof HTMLElement ? targetCard : null;
    };

    const scrollToLocationEvent = (locationId: string) => {
      const eventsSection = document.querySelector('[data-events-section]');
      if (!(eventsSection instanceof HTMLElement)) return;

      const targetCard = getFirstVisibleLocationCard(locationId);
      if (!(targetCard instanceof HTMLElement)) return;

      const scrollRoot = scrollRootFor(targetCard);
      const cardRect = targetCard.getBoundingClientRect();
      const mainHeader = eventsSection.querySelector('[data-main-header]');
      if (!scrollRoot) {
        const headerOffset =
          mainHeader instanceof HTMLElement ? mainHeader.getBoundingClientRect().bottom : 0;
        const strokeOffset = pxFromCssVar('--stroke-width');
        const scrollPadding = Math.max(0, headerOffset - strokeOffset);
        window.scrollTo({
          top: Math.max(0, window.scrollY + cardRect.top - scrollPadding),
          behavior: 'smooth',
        });
        return;
      }

      const eventsSectionRect = scrollRoot.getBoundingClientRect();
      const headerOffset =
        mainHeader instanceof HTMLElement
          ? mainHeader.getBoundingClientRect().bottom - eventsSectionRect.top
          : 0;
      const strokeOffset = pxFromCssVar('--stroke-width');
      const scrollPadding = Math.max(0, headerOffset - strokeOffset);
      const nextScrollTop =
        scrollRoot.scrollTop + cardRect.top - eventsSectionRect.top - scrollPadding;

      scrollRoot.scrollTo({
        top: Math.max(0, nextScrollTop),
        behavior: 'smooth',
      });
    };

    const waitForCardDeactivation = () =>
      new Promise<void>((resolve) => {
        const activeCards = document.querySelectorAll("[data-event-card][data-active='true']");

        if (activeCards.length === 0) {
          resolve();
          return;
        }

        document.addEventListener('event-card:deactivated-all', () => resolve(), { once: true });
        document.dispatchEvent(new CustomEvent('event-card:deactivate-all'));
      });

    let lastMarkerActivationId = '';
    let lastMarkerActivationTime = 0;
    let markerNavigationLocationId = '';
    const activateMarkerLocation = (locationId: string) => {
      const now = performance.now();

      if (lastMarkerActivationId === locationId && now - lastMarkerActivationTime < 80) return;

      lastMarkerActivationId = locationId;
      lastMarkerActivationTime = now;
      markerNavigationLocationId = locationId;
      highlightLocation(locationId, true);
      waitForCardDeactivation().then(() => {
        scrollToLocationEvent(locationId);
        highlightLocation(locationId, false);
        markerNavigationLocationId = '';
      });
    };

    const markerRecords = sources.map((source) => {
      const content = createMarkerContent(source);
      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: source.lat, lng: source.lng },
        title: source.name,
        content,
        anchorLeft: '-0.625rem',
        gmpClickable: true,
      });
      marker.zIndex = 0;

      content.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateMarkerLocation(source.id);
      });
      marker.addEventListener?.('gmp-click', () => activateMarkerLocation(source.id));
      marker.addListener?.('click', () => activateMarkerLocation(source.id));

      return { marker, source, content };
    });
    const markerRecordsById = new Map(markerRecords.map((record) => [record.source.id, record]));
    let highlightedLocationId = '';

    const isMapVisible = () => !element.closest('[hidden]') && element.getClientRects().length > 0;

    const syncStarredMarkers = () => {
      const starredLocationIds = new Set(
        Array.from(document.querySelectorAll("[data-event-card][data-starred='true']"))
          .map((card) => (card instanceof HTMLElement ? (card.dataset.mapLocationId ?? '') : ''))
          .filter(Boolean),
      );

      markerRecords.forEach(({ source, content }) => {
        content.toggleAttribute('data-starred', starredLocationIds.has(source.id));
      });
    };

    const clearHighlight = () => {
      if (!highlightedLocationId) return;

      const highlightedRecord = markerRecordsById.get(highlightedLocationId);
      highlightedRecord?.content.removeAttribute('data-highlighted');
      if (highlightedRecord?.marker) highlightedRecord.marker.zIndex = 0;
      highlightedLocationId = '';
    };

    const highlightLocation = (locationId: string, shouldPan: boolean) => {
      const record = markerRecordsById.get(locationId);

      if (!record || record.content.hasAttribute('data-hidden')) {
        clearHighlight();
        return;
      }

      clearHighlight();
      highlightedLocationId = locationId;
      record.content.toggleAttribute('data-highlighted', true);
      record.marker.zIndex = 1000;

      if (shouldPan) {
        map.panTo?.({ lat: record.source.lat, lng: record.source.lng });
      }
    };

    const syncActiveCardHighlight = () => {
      if (!isMapVisible()) return;

      const activeCard = document.querySelector("[data-event-card][data-active='true']");
      if (!(activeCard instanceof HTMLElement)) {
        clearHighlight();
        return;
      }

      const locationId = activeCard.dataset.mapLocationId || '';
      if (!locationId) {
        clearHighlight();
        return;
      }

      highlightLocation(locationId, true);
    };

    const getVisibleStarredLocationIds = () =>
      new Set(
        Array.from(document.querySelectorAll("[data-event-card][data-starred='true']"))
          .filter((card) => {
            if (!(card instanceof HTMLElement)) return false;
            return !card.hidden && !card.closest('[hidden]');
          })
          .map((card) => (card instanceof HTMLElement ? (card.dataset.mapLocationId ?? '') : ''))
          .filter(Boolean),
      );

    const applyMapFilter = () => {
      const activeCategories = getActiveMapCategories();
      const activeStarred = getActiveMapStarred();
      const visibleStarredLocationIds = activeStarred ? getVisibleStarredLocationIds() : null;

      markerRecords.forEach(({ marker, source, content }) => {
        const matchesCategory = matchesCategoryGroups(source.categories, activeCategories);
        const matchesStarred =
          !visibleStarredLocationIds || visibleStarredLocationIds.has(source.id);
        const matches = matchesCategory && matchesStarred;
        marker.map = matches ? map : null;
        content.toggleAttribute('data-hidden', !matches);
      });

      if (highlightedLocationId) {
        const highlightedRecord = markerRecordsById.get(highlightedLocationId);
        if (!highlightedRecord || highlightedRecord.content.hasAttribute('data-hidden')) {
          clearHighlight();
        }
      }
    };

    document.addEventListener('event-card:active-change', (event) => {
      if (!isMapVisible()) return;
      if (!(event instanceof CustomEvent)) return;

      const detail = event.detail ?? {};
      const locationId = typeof detail.locationId === 'string' ? detail.locationId : '';

      if (!detail.active) {
        if (markerNavigationLocationId) return;
        syncActiveCardHighlight();
        return;
      }

      if (!locationId) {
        clearHighlight();
        return;
      }

      highlightLocation(locationId, true);
    });
    document.addEventListener('event-filter:updated', applyMapFilter);
    document.addEventListener('event-stars:updated', syncStarredMarkers);
    document.addEventListener('map-layout:updated', syncActiveCardHighlight);
    mobileMapQuery.addEventListener('change', () => {
      if (isMapVisible()) map.setZoom?.(getMapZoom());
    });
    applyMapFilter();
    syncStarredMarkers();
    syncActiveCardHighlight();
  } catch (error) {
    console.error(error);
    showPlaceholder(element, 'Map failed to load.');
  }
};

const initMapOnce = (element: Element) => {
  if (!(element instanceof HTMLElement)) return;
  if (element.dataset.mapInitialized === 'true') return;

  element.dataset.mapInitialized = 'true';
  initMap(element);
};

mapElements.forEach((element) => {
  if (element.closest('[hidden]')) {
    const initWhenVisible = () => {
      if (element.closest('[hidden]')) return;

      document.removeEventListener('map-layout:updated', initWhenVisible);
      initMapOnce(element);
    };

    document.addEventListener('map-layout:updated', initWhenVisible);
    return;
  }

  initMapOnce(element);
});
