import type { EventRow } from './events';
import type { AppLocale } from './i18n';
import {
  assertTaxonomy,
  CATEGORY_DIMENSIONS,
  CATEGORY_REGISTRY,
  flattenTaxonomy,
  parseCategoryToken,
} from '../../../../data/categories.mjs';

export type Taxonomy = {
  venue_category: string[];
  display_category: string[];
  event_category: string[];
};

export type SourceConfig = {
  slug: string;
  name: string;
  names?: Partial<Record<'en' | 'ja', string>>;
  taxonomy: Taxonomy;
  base_url: string;
  start_urls?: string[];
  allowed_domains?: string[];
  event_page_patterns?: string[];
  address_text?: string;
  lat?: number;
  lng?: number;
  skip_og_image?: boolean;
  venue_locations?: {
    name?: string;
    match: string[];
    address_text?: string;
    directions_query?: string;
    lat: number;
    lng: number;
  }[];
  is_active?: boolean;
  beta?: boolean;
  map_visibility?: boolean;
};

export type MapSource = {
  id: string;
  sourceSlug: string;
  name: string;
  categories: string[];
  lat: number;
  lng: number;
};

export type CategoryOption = {
  slug: string;
  label: string;
  dimension: keyof Taxonomy;
};

type SourceRelation = { slug?: string | null } | { slug?: string | null }[] | null;

type EventSourceCandidate = {
  source_id?: string | null;
  source_url?: string | null;
  institution_name?: string | null;
  venue_name?: string | null;
  address_text?: string | null;
  directions_query?: string | null;
  categories?: string[] | null;
  lat?: number | null;
  lng?: number | null;
  title?: string | null;
  sources?: SourceRelation;
};

export type EventSourceTruth = {
  sourceSlug: string | null;
  institution_name: string;
  venue_name: string | null;
  address_text: string | null;
  directions_query: string | null;
  categories: string[];
  lat: number | null;
  lng: number | null;
};

export const normalizeCategory = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const normalizeCategoryList = (values: string[]) => [
  ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
];

export const matchesCategoryGroups = (categories: string[], activeGroups: Map<string, string[]>) =>
  [...activeGroups.values()].every((groupCategories) =>
    groupCategories.some((category) => categories.includes(category)),
  );

export const titleCaseCategory = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const allActiveSourcesFrom = (sources: SourceConfig[]) =>
  sources
    .filter((source) => source.is_active !== false)
    .map((source) => ({
      ...source,
      taxonomy: assertTaxonomy(source.taxonomy, source.slug) as Taxonomy,
    }));

export const configuredSourcesFrom = (sources: SourceConfig[]) =>
  sources
    .filter((source) => source.is_active !== false)
    .filter((source) => !source.beta || import.meta.env.DEV)
    .map((source) => ({
      ...source,
      taxonomy: assertTaxonomy(source.taxonomy, source.slug) as Taxonomy,
    }));

export const normalizeUrl = (value: string | undefined) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url;
  } catch {
    return null;
  }
};

export const sourceMatchScore = (eventUrl: string, source: SourceConfig) => {
  const url = normalizeUrl(eventUrl);
  if (!url) return 0;

  const hostname = url.hostname.toLowerCase();
  let score = 0;
  let matchesSourceHost = false;

  for (const domain of source.allowed_domains ?? []) {
    const normalizedDomain = domain.toLowerCase();
    if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) {
      matchesSourceHost = true;
      score = Math.max(score, 10);
    }
  }

  for (const candidateUrl of [source.base_url, ...(source.start_urls ?? [])]) {
    const normalizedCandidate = normalizeUrl(candidateUrl);
    if (!normalizedCandidate) continue;

    if (hostname === normalizedCandidate.hostname.toLowerCase()) {
      matchesSourceHost = true;
    }

    if (url.toString().startsWith(normalizedCandidate.toString())) {
      matchesSourceHost = true;
      score = Math.max(score, 100 + normalizedCandidate.pathname.length);
    }
  }

  if (!matchesSourceHost) return 0;

  for (const pattern of source.event_page_patterns ?? []) {
    if (pattern && url.pathname.includes(pattern)) {
      score = Math.max(score, 40 + pattern.length);
    }
  }

  return score;
};

export const sourceCategoriesForEvent = (event: EventRow, configuredSources: SourceConfig[]) => {
  return sourceTruthForEvent(event, configuredSources, 'en').categories;
};

const sourceBySlug = (configuredSources: SourceConfig[], sourceSlug: string | null) =>
  configuredSources.find((source) => source.slug === sourceSlug) ?? null;

const sourceSlugFromRelation = (relation: SourceRelation | undefined) => {
  const slug = Array.isArray(relation) ? relation[0]?.slug : relation?.slug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
};

const sourceSlugFromSourceId = (event: EventSourceCandidate, configuredSources: SourceConfig[]) => {
  const sourceId = typeof event.source_id === 'string' ? event.source_id.trim() : '';
  return sourceId && sourceBySlug(configuredSources, sourceId) ? sourceId : null;
};

const sourceSlugFromUrl = (event: EventSourceCandidate, configuredSources: SourceConfig[]) =>
  configuredSources
    .map((source) => ({
      source,
      score: sourceMatchScore(event.source_url ?? '', source),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.source.slug ?? null;

export const sourceSlugForEvent = (
  event: EventSourceCandidate,
  configuredSources: SourceConfig[],
) => {
  const relationSlug = sourceSlugFromRelation(event.sources);
  if (relationSlug && sourceBySlug(configuredSources, relationSlug)) return relationSlug;

  return (
    sourceSlugFromSourceId(event, configuredSources) ?? sourceSlugFromUrl(event, configuredSources)
  );
};

const localizedSourceName = (source: SourceConfig, activeLocale: AppLocale) =>
  source.names?.[activeLocale] || source.names?.en || source.names?.ja || source.name;

export const sourceDisplayNameForEvent = (
  event: EventSourceCandidate,
  configuredSources: SourceConfig[],
  activeLocale: AppLocale,
) => {
  return sourceTruthForEvent(event, configuredSources, activeLocale).institution_name;
};

const toCoordinate = (value: unknown) => {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
};

const coordinatePairFrom = (lat: unknown, lng: unknown) => {
  const parsedLat = toCoordinate(lat);
  const parsedLng = toCoordinate(lng);

  if (
    parsedLat === null ||
    parsedLng === null ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLng < -180 ||
    parsedLng > 180 ||
    (parsedLat === 0 && parsedLng === 0)
  ) {
    return null;
  }

  return { lat: parsedLat, lng: parsedLng };
};

const findVenueLocationForCoordinates = (
  source: SourceConfig | null,
  lat: number | null,
  lng: number | null,
) => {
  if (!source || lat === null || lng === null) return null;

  return (
    (source.venue_locations ?? []).find((location) => {
      const locationLat = toCoordinate(location.lat);
      const locationLng = toCoordinate(location.lng);
      return (
        locationLat !== null &&
        locationLng !== null &&
        locationLat.toFixed(6) === lat.toFixed(6) &&
        locationLng.toFixed(6) === lng.toFixed(6)
      );
    }) ?? null
  );
};

const normalizeLocationMatchText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const eventLocationMatchText = (event: EventSourceCandidate) =>
  [
    event.venue_name,
    event.address_text,
    event.directions_query,
    event.source_url,
    event.institution_name,
    event.title,
  ]
    .map(normalizeLocationMatchText)
    .filter(Boolean)
    .join(' ');

const findVenueLocationForText = (source: SourceConfig | null, event: EventSourceCandidate) => {
  if (!source) return null;

  const eventText = eventLocationMatchText(event);
  if (!eventText) return null;

  return (
    (source.venue_locations ?? []).find((location) =>
      (Array.isArray(location.match) ? location.match : [location.match ?? location.name])
        .map(normalizeLocationMatchText)
        .filter(Boolean)
        .some((matcher) => eventText.includes(matcher)),
    ) ?? null
  );
};

const venueLocationForEvent = (source: SourceConfig | null, event: EventSourceCandidate) => {
  const coordinates = coordinatePairFrom(event.lat, event.lng);
  return (
    findVenueLocationForText(source, event) ??
    findVenueLocationForCoordinates(source, coordinates?.lat ?? null, coordinates?.lng ?? null)
  );
};

export const sourceTruthForEvent = (
  event: EventSourceCandidate,
  configuredSources: SourceConfig[],
  activeLocale: AppLocale,
): EventSourceTruth => {
  const sourceSlug = sourceSlugForEvent(event, configuredSources);
  const source = sourceBySlug(configuredSources, sourceSlug);

  if (!source) {
    const fallbackCoordinates = coordinatePairFrom(event.lat, event.lng);
    return {
      sourceSlug: null,
      institution_name: event.institution_name ?? 'Unknown venue',
      venue_name: event.venue_name ?? null,
      address_text: event.address_text ?? null,
      directions_query: event.directions_query ?? null,
      categories: normalizeCategoryList(event.categories ?? []),
      lat: fallbackCoordinates?.lat ?? null,
      lng: fallbackCoordinates?.lng ?? null,
    };
  }

  const venueLocation = venueLocationForEvent(source, event);
  const sourceCoordinates = coordinatePairFrom(source.lat, source.lng);
  const eventCoordinates = coordinatePairFrom(event.lat, event.lng);
  const lat = venueLocation?.lat ?? sourceCoordinates?.lat ?? eventCoordinates?.lat ?? null;
  const lng = venueLocation?.lng ?? sourceCoordinates?.lng ?? eventCoordinates?.lng ?? null;
  const addressText =
    venueLocation?.address_text ?? source.address_text ?? event.address_text ?? null;
  const venueName = venueLocation?.name ?? source.name ?? event.venue_name ?? null;

  return {
    sourceSlug: source.slug,
    institution_name: localizedSourceName(source, activeLocale),
    venue_name: venueName,
    address_text: addressText,
    directions_query:
      venueLocation?.directions_query ??
      source.directions_query ??
      event.directions_query ??
      addressText,
    categories: flattenTaxonomy(source.taxonomy),
    lat,
    lng,
  };
};

const locationNameForEvent = (
  source: SourceConfig | null,
  lat: number | null,
  lng: number | null,
  fallbackName = 'Map location',
) => {
  const venueLocation = findVenueLocationForCoordinates(source, lat, lng);
  return venueLocation?.name || source?.name || fallbackName;
};

const locationCategoriesForSource = (source: SourceConfig) => {
  return flattenTaxonomy(source.taxonomy);
};

export const mapLocationIdForEvent = (
  event: EventRow,
  sourceSlug: string | null,
  configuredSources: SourceConfig[],
) => {
  const source = sourceBySlug(configuredSources, sourceSlug);
  const coordinates = mapCoordinatesForEvent(event, sourceSlug, configuredSources);
  const lat = coordinates?.lat ?? null;
  const lng = coordinates?.lng ?? null;

  if (lat === null || lng === null || !sourceSlug) return null;

  const venueKey = normalizeCategory(
    locationNameForEvent(source, lat, lng, event.institution_name),
  );
  return `${sourceSlug}:${lat.toFixed(6)}:${lng.toFixed(6)}:${venueKey}`;
};

export const mapCoordinatesForEvent = (
  event: EventRow,
  sourceSlug: string | null,
  configuredSources: SourceConfig[],
) => {
  const source = sourceBySlug(configuredSources, sourceSlug);
  const venueLocation = venueLocationForEvent(source, event);
  return (
    coordinatePairFrom(venueLocation?.lat, venueLocation?.lng) ??
    coordinatePairFrom(source?.lat, source?.lng) ??
    coordinatePairFrom(event.lat, event.lng)
  );
};

export const categoriesForEvents = (events: EventRow[]): CategoryOption[] => {
  const categoryMap = new Map<string, CategoryOption>();

  for (const event of events) {
    for (const token of event.categories) {
      const parsed = parseCategoryToken(token);
      if (!parsed || categoryMap.has(token)) continue;
      categoryMap.set(token, {
        slug: token,
        label: titleCaseCategory(parsed.category).toLowerCase(),
        dimension: parsed.dimension as keyof Taxonomy,
      });
    }
  }

  return [...categoryMap.values()].sort((a, b) => {
    const dimensionDifference =
      CATEGORY_DIMENSIONS.indexOf(a.dimension) - CATEGORY_DIMENSIONS.indexOf(b.dimension);
    if (dimensionDifference) return dimensionDifference;

    return (
      CATEGORY_REGISTRY[a.dimension].indexOf(parseCategoryToken(a.slug)?.category) -
      CATEGORY_REGISTRY[b.dimension].indexOf(parseCategoryToken(b.slug)?.category)
    );
  });
};

export const mapSourcesForEvents = (
  events: EventRow[],
  sourceSlugByEventId: Map<string, string | null>,
  configuredSources: SourceConfig[],
): MapSource[] => {
  const locations = new Map<string, MapSource>();

  events.forEach((event) => {
    const sourceSlug = sourceSlugByEventId.get(event.id) ?? null;
    const source = sourceBySlug(configuredSources, sourceSlug);
    if (!sourceSlug || source?.map_visibility === false) return;

    const coordinates = mapCoordinatesForEvent(event, sourceSlug, configuredSources);
    const lat = coordinates?.lat ?? null;
    const lng = coordinates?.lng ?? null;
    const id = mapLocationIdForEvent(event, sourceSlug, configuredSources);
    if (lat === null || lng === null || !id) return;

    const existing = locations.get(id);
    const categories = source
      ? locationCategoriesForSource(source)
      : normalizeCategoryList(event.categories ?? []);
    if (existing) {
      existing.categories = [...new Set([...existing.categories, ...categories])];
      return;
    }

    locations.set(id, {
      id,
      sourceSlug,
      name: locationNameForEvent(source, lat, lng, event.institution_name),
      categories,
      lat,
      lng,
    });
  });

  return [...locations.values()];
};
