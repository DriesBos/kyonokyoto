import {
  buildTemplePlaceIndex,
  findTemplePlaceUrl,
  extractTemplePlaceFacts,
} from './temple-places.mjs';
import {
  prefecturePlaceSearchUrl,
  findPrefecturePlaceUrl,
  extractPrefecturePlaceFacts,
} from './prefecture-places.mjs';

const INDEX_URLS = [7, 8, 11, 14].map(
  (id) => `https://ja.kyoto.travel/tourism/search.php?category_id=${id}`,
);
const kyotoAddress = (value) => /京都[府市]/.test(value ?? '');
export const isKyotoTempleSource = (source) =>
  source?.city === 'kyoto' &&
  source.source_kind === 'aggregator' &&
  ['kyoto-kobunka', 'kyoto-shunju', 'kyoto-tourism-openings', 'kyoto-prefecture-openings'].includes(
    source.slug,
  );

// One lazy directory index and one verified place fetch per venue, per source crawl.
export function createTemplePlaceEnricher({ fetchPage, maxDetails = 120, onMiss = () => {} }) {
  let indexPromise;
  const places = new Map();
  const prefectureLookups = new Map();
  const getPrefectureFacts = (venue) => {
    if (!prefectureLookups.has(venue) && prefectureLookups.size < maxDetails) {
      prefectureLookups.set(
        venue,
        (async () => {
          try {
            const search = await fetchPage(prefecturePlaceSearchUrl(venue));
            const url = findPrefecturePlaceUrl(search.html, venue);
            if (!url) return null;
            const page = await fetchPage(url);
            return extractPrefecturePlaceFacts(page.html, page.url, venue);
          } catch (error) {
            onMiss(venue, error);
            return null;
          }
        })(),
      );
    }
    return prefectureLookups.get(venue) ?? null;
  };
  const getIndex = () => {
    indexPromise ??= (async () => {
      const pages = [];
      for (const url of INDEX_URLS) {
        try {
          pages.push(await fetchPage(url));
        } catch (error) {
          onMiss(url, error);
        }
      }
      return buildTemplePlaceIndex(pages);
    })();
    return indexPromise;
  };
  return async (event) => {
    const missingAddress = !event.address_text;
    const missingImages = !event.image_urls?.length;
    if (
      (!missingAddress && !missingImages) ||
      !event.venue_name ||
      !event.title ||
      !event.start_date
    )
      return event;
    const index = await getIndex();
    const url = findTemplePlaceUrl(index, event.venue_name);
    if (url && !places.has(url) && places.size < maxDetails) {
      places.set(
        url,
        (async () => {
          try {
            return await fetchPage(url);
          } catch (error) {
            onMiss(url, error);
            return null;
          }
        })(),
      );
    }
    const page = url && (await places.get(url));
    const facts =
      (page && extractTemplePlaceFacts(page.html, page.url, event.venue_name)) ||
      (await getPrefectureFacts(event.venue_name));
    if (!facts || !kyotoAddress(facts.address_text)) return event;
    const address = event.address_text || facts.address_text;
    const images = missingImages ? facts.image_urls : event.image_urls;
    const importedCoordinates =
      (event.lat == null || event.lng == null) && facts.lat != null && facts.lng != null;
    return {
      ...event,
      address_text: address,
      directions_query: [event.venue_name, address].join(', '),
      lat: importedCoordinates ? facts.lat : event.lat,
      lng: importedCoordinates ? facts.lng : event.lng,
      primary_image_url: images[0] ?? null,
      image_urls: images,
      ...(missingAddress || importedCoordinates ? { location_source_url: facts.source_url } : {}),
      ...(missingImages && images.length ? { image_source_url: facts.source_url } : {}),
      _location_prefecture: kyotoAddress(address) ? 'Kyoto' : event._location_prefecture,
      _temple_warnings: (event._temple_warnings ?? []).filter(
        (warning) =>
          !(
            (missingAddress &&
              ['missing-event-address', 'unresolved-prefecture'].includes(warning)) ||
            (images.length && warning === 'missing-event-images')
          ),
      ),
    };
  };
}
