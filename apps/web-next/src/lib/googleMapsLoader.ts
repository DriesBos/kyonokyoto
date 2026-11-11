// Google Maps JS bootstrap, kept out of GoogleMapCanvas so the page can start loading the API
// (and warm the connection) before the map chunk itself has downloaded. Loading the script is
// free; Google only bills when a Map is constructed, which still happens in GoogleMapCanvas.

export type MapsWindow = Window &
  typeof globalThis & {
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
        Map?: unknown;
        __ib__?: () => void;
      };
    };
    __kyoGoogleMapsLoader?: Promise<void>;
  };

export const ensureGoogleMapsLoader = (apiKey: string, mapId: string) => {
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
        : (mapWindow.google?.maps ?? {});
    });
  };

  mapWindow.google.maps.importLibrary = bootstrapImportLibrary;
};

// Sent by MapExperience when the map panel closes (the canvas itself stays mounted).
export const MAP_CLOSED_EVENT = 'map:closed';

export const mapLibraries = ['maps', 'marker', 'core'] as const;

// Starts downloading the API and the libraries the map needs, without creating a map.
export const warmGoogleMaps = (apiKey: string, mapId: string) => {
  if (!apiKey || !mapId) return;
  ensureGoogleMapsLoader(apiKey, mapId);
  const importLibrary = (window as MapsWindow).google?.maps?.importLibrary;
  mapLibraries.forEach((library) => {
    void importLibrary?.(library)?.catch(() => {
      // GoogleMapCanvas reports load failures when it opens.
    });
  });
};
