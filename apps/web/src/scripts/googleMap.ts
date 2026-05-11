type MapSource = {
  slug: string;
  name: string;
  categories: string[];
  lat: number;
  lng: number;
};

type MapInstance = {
  panTo?: (position: { lat: number; lng: number }) => void;
  setZoom?: (zoom: number) => void;
};

type AdvancedMarkerInstance = {
  map: unknown | null;
  zIndex?: number | null;
  addEventListener?: (eventName: string, callback: () => void) => void;
  addListener?: (eventName: string, callback: () => void) => unknown;
};

type AdvancedMarkerConstructor = new (options: {
  map: unknown;
  position: { lat: number; lng: number };
  title: string;
  content: HTMLElement;
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
const mapElements = Array.from(document.querySelectorAll("[data-google-map]"));
const kyotoCenter = { lat: 35.0240977, lng: 135.7621436 };
const mobileMapQuery = window.matchMedia("(max-width: 768px)");
const getMapZoom = () => (mobileMapQuery.matches ? 13 : 14);

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
          reject(new Error("Google Maps namespace unavailable."));
          return;
        }

        const parameters = new URLSearchParams({
          key: apiKey,
          v: "weekly",
          libraries: Array.from(requestedLibraries).join(","),
          callback: "google.maps.__ib__",
        });

        if (mapId) {
          parameters.set("map_ids", mapId);
        }

        mapWindow.google.maps.__ib__ = resolve;

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
        script.async = true;
        script.onerror = () => reject(new Error("Google Maps JavaScript API could not load."));
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
  const placeholder = element.querySelector("[data-map-placeholder]");
  if (!(placeholder instanceof HTMLElement)) return;

  placeholder.hidden = false;
  if (message) {
    placeholder.querySelector("p")?.replaceChildren(message);
  }
};

const parseSources = (element: HTMLElement): MapSource[] => {
  const sourceScript = element.querySelector("[data-map-sources]");
  if (!(sourceScript instanceof HTMLScriptElement)) return [];

  try {
    const parsed = JSON.parse(sourceScript.textContent ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const createMarkerContent = (source: MapSource) => {
  const marker = document.createElement("button");
  marker.className = "map-marker";
  marker.type = "button";
  marker.dataset.sourceSlug = source.slug;
  marker.dataset.categories = source.categories.join("|");
  marker.setAttribute("aria-label", source.name);
  marker.innerHTML = `<span class="map-marker__dot" aria-hidden="true"></span>`;
  return marker;
};

const getActiveMapCategory = () => {
  const activeButton = document.querySelector("[data-category-button][aria-pressed='true']");
  return activeButton instanceof HTMLElement ? activeButton.dataset.category ?? "" : "";
};

const initMap = async (element: Element) => {
  if (!(element instanceof HTMLElement)) return;

  const apiKey = element.dataset.apiKey?.trim() ?? "";
  const mapId = element.dataset.mapId?.trim() ?? "";
  const sources = parseSources(element);

  if (!apiKey || !mapId) {
    showPlaceholder(element);
    return;
  }

  if (sources.length === 0) {
    showPlaceholder(element, "No map locations available.");
    return;
  }

  try {
    ensureGoogleMapsLoader(apiKey, mapId);
    const [mapsLibrary, markerLibrary, coreLibrary] = await Promise.all([
      mapWindow.google?.maps?.importLibrary?.("maps"),
      mapWindow.google?.maps?.importLibrary?.("marker"),
      mapWindow.google?.maps?.importLibrary?.("core"),
    ]);
    const MapConstructor = (mapsLibrary as { Map?: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance })
      ?.Map ?? mapWindow.google?.maps?.Map;
    const AdvancedMarkerElement = (markerLibrary as { AdvancedMarkerElement?: AdvancedMarkerConstructor })
      ?.AdvancedMarkerElement;
    const ColorScheme = (coreLibrary as { ColorScheme?: { LIGHT?: unknown } })?.ColorScheme;

    if (!MapConstructor || !AdvancedMarkerElement) {
      throw new Error("Google Maps constructors unavailable.");
    }

    element.querySelector("[data-map-placeholder]")?.setAttribute("hidden", "");

    const map = new MapConstructor(element, {
      center: kyotoCenter,
      zoom: getMapZoom(),
      mapId,
      mapTypeId: "terrain",
      ...(ColorScheme?.LIGHT ? { colorScheme: ColorScheme.LIGHT } : {}),
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: "greedy",
      keyboardShortcuts: true,
    });

    const getFirstVisibleSourceCard = (sourceSlug: string) => {
      const eventsSection = document.querySelector("[data-events-section]");
      if (!(eventsSection instanceof HTMLElement)) return null;

      const escapedSourceSlug = sourceSlug.replace(/["\\]/g, "\\$&");
      const sourceCards = Array.from(
        document.querySelectorAll(`[data-event-card][data-map-source-slug="${escapedSourceSlug}"]`)
      );
      const targetCard = sourceCards.find((card) => {
        if (!(card instanceof HTMLElement)) return false;
        return !card.hidden && !card.closest("[hidden]") && card.getClientRects().length > 0;
      });

      return targetCard instanceof HTMLElement ? targetCard : null;
    };

    const scrollToSourceEvent = (sourceSlug: string) => {
      const eventsSection = document.querySelector("[data-events-section]");
      if (!(eventsSection instanceof HTMLElement)) return;

      const targetCard = getFirstVisibleSourceCard(sourceSlug);
      if (!(targetCard instanceof HTMLElement)) return;

      const eventsSectionRect = eventsSection.getBoundingClientRect();
      const cardRect = targetCard.getBoundingClientRect();
      const mainHeader = eventsSection.querySelector("[data-main-header]");
      const pagePaddingY = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--page-padding-y")
      );
      const stickyOffset = mainHeader instanceof HTMLElement ? mainHeader.offsetHeight : 0;
      const scrollPadding = stickyOffset + (Number.isFinite(pagePaddingY) ? pagePaddingY : 0);
      const nextScrollTop = eventsSection.scrollTop + cardRect.top - eventsSectionRect.top - scrollPadding;

      eventsSection.scrollTo({
        top: Math.max(0, nextScrollTop),
        behavior: "smooth",
      });
    };

    const activateSourceEvent = (sourceSlug: string) => {
      const targetCard = getFirstVisibleSourceCard(sourceSlug);
      if (!(targetCard instanceof HTMLElement)) return;

      document.dispatchEvent(
        new CustomEvent("event-card:activate", {
          detail: {
            eventId: targetCard.dataset.eventId || "",
            sourceSlug,
          },
        })
      );
    };

    let lastMarkerActivationSlug = "";
    let lastMarkerActivationTime = 0;
    const activateMarkerSource = (sourceSlug: string) => {
      const now = performance.now();

      if (lastMarkerActivationSlug === sourceSlug && now - lastMarkerActivationTime < 80) return;

      lastMarkerActivationSlug = sourceSlug;
      lastMarkerActivationTime = now;
      highlightSource(sourceSlug, true);
      activateSourceEvent(sourceSlug);
      scrollToSourceEvent(sourceSlug);
    };

    const markerRecords = sources.map((source) => {
      const content = createMarkerContent(source);
      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: source.lat, lng: source.lng },
        title: source.name,
        content,
        gmpClickable: true,
      });
      marker.zIndex = 0;

      content.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateMarkerSource(source.slug);
      });
      marker.addEventListener?.("gmp-click", () => activateMarkerSource(source.slug));
      marker.addListener?.("click", () => activateMarkerSource(source.slug));

      return { marker, source, content };
    });
    const markerRecordsBySlug = new Map(markerRecords.map((record) => [record.source.slug, record]));
    let highlightedSourceSlug = "";

    const isMapVisible = () => !element.closest("[hidden]") && element.getClientRects().length > 0;

    const clearHighlight = () => {
      if (!highlightedSourceSlug) return;

      const highlightedRecord = markerRecordsBySlug.get(highlightedSourceSlug);
      highlightedRecord?.content.removeAttribute("data-highlighted");
      if (highlightedRecord?.marker) highlightedRecord.marker.zIndex = 0;
      highlightedSourceSlug = "";
    };

    const highlightSource = (sourceSlug: string, shouldPan: boolean) => {
      const record = markerRecordsBySlug.get(sourceSlug);

      if (!record || record.content.hasAttribute("data-hidden")) {
        clearHighlight();
        return;
      }

      clearHighlight();
      highlightedSourceSlug = sourceSlug;
      record.content.toggleAttribute("data-highlighted", true);
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

      const sourceSlug = activeCard.dataset.mapSourceSlug || "";
      if (!sourceSlug) {
        clearHighlight();
        return;
      }

      highlightSource(sourceSlug, true);
    };

    const applyMapFilter = () => {
      const activeCategory = getActiveMapCategory();

      markerRecords.forEach(({ marker, source, content }) => {
        const matches = !activeCategory || source.categories.includes(activeCategory);
        marker.map = matches ? map : null;
        content.toggleAttribute("data-hidden", !matches);
      });

      if (highlightedSourceSlug) {
        const highlightedRecord = markerRecordsBySlug.get(highlightedSourceSlug);
        if (!highlightedRecord || highlightedRecord.content.hasAttribute("data-hidden")) {
          clearHighlight();
        }
      }
    };

    document.addEventListener("event-card:active-change", (event) => {
      if (!isMapVisible()) return;
      if (!(event instanceof CustomEvent)) return;

      const detail = event.detail ?? {};
      const sourceSlug = typeof detail.sourceSlug === "string" ? detail.sourceSlug : "";

      if (!detail.active) {
        syncActiveCardHighlight();
        return;
      }

      if (!sourceSlug) {
        clearHighlight();
        return;
      }

      highlightSource(sourceSlug, true);
    });
    document.addEventListener("event-filter:updated", applyMapFilter);
    document.addEventListener("map-layout:updated", syncActiveCardHighlight);
    mobileMapQuery.addEventListener("change", () => {
      if (isMapVisible()) map.setZoom?.(getMapZoom());
    });
    applyMapFilter();
    syncActiveCardHighlight();
  } catch (error) {
    console.error(error);
    showPlaceholder(element, "Map failed to load.");
  }
};

const initMapOnce = (element: Element) => {
  if (!(element instanceof HTMLElement)) return;
  if (element.dataset.mapInitialized === "true") return;

  element.dataset.mapInitialized = "true";
  initMap(element);
};

mapElements.forEach((element) => {
  if (element.closest("[hidden]")) {
    const initWhenVisible = () => {
      if (element.closest("[hidden]")) return;

      document.removeEventListener("map-layout:updated", initWhenVisible);
      initMapOnce(element);
    };

    document.addEventListener("map-layout:updated", initWhenVisible);
    return;
  }

  initMapOnce(element);
});
