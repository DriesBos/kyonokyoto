import type { EventRow } from "./events";

export type SourceConfig = {
  slug: string;
  name: string;
  names?: Partial<Record<"en" | "ja", string>>;
  source_type: string;
  base_url: string;
  start_urls?: string[];
  allowed_domains?: string[];
  event_page_patterns?: string[];
  source_categories?: string[];
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
};

export const preferredCategoryOrder = [
  "exhibition",
  "museum",
  "gallery",
  "art",
  "photography",
  "design",
  "craft",
  "event",
  "music",
  "performance",
  "mingei",
  "ceramics",
  "workshop",
  "festival",
  "fair",
];

export const normalizeCategory = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const normalizeCategoryList = (values: string[]) => [
  ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
];

export const titleCaseCategory = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const allActiveSourcesFrom = (sources: SourceConfig[]) =>
  sources
    .filter((source) => source.is_active !== false)
    .map((source) => ({
      ...source,
      source_categories: normalizeCategoryList(source.source_categories ?? []),
    }));

export const configuredSourcesFrom = (sources: SourceConfig[]) =>
  sources
    .filter((source) => source.is_active !== false)
    .filter((source) => !source.beta || import.meta.env.DEV)
    .map((source) => ({
      ...source,
      source_categories: normalizeCategoryList(source.source_categories ?? []),
    }));

export const normalizeUrl = (value: string | undefined) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
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
    if (
      hostname === normalizedDomain ||
      hostname.endsWith(`.${normalizedDomain}`)
    ) {
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

export const sourceCategoriesForEvent = (
  event: EventRow,
  configuredSources: SourceConfig[],
) => {
  const bestSource = configuredSources
    .map((source) => ({
      source,
      score: sourceMatchScore(event.source_url, source),
    }))
    .filter(
      (match) =>
        match.score > 0 && (match.source.source_categories?.length ?? 0) > 0,
    )
    .sort((a, b) => b.score - a.score)[0]?.source;

  return bestSource?.source_categories?.length
    ? bestSource.source_categories
    : normalizeCategoryList(event.categories ?? []);
};

export const sourceSlugForEvent = (
  event: EventRow,
  configuredSources: SourceConfig[],
) =>
  configuredSources
    .map((source) => ({
      source,
      score: sourceMatchScore(event.source_url, source),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.source.slug ?? null;

const sourceBySlug = (
  configuredSources: SourceConfig[],
  sourceSlug: string | null,
) => configuredSources.find((source) => source.slug === sourceSlug) ?? null;

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

const locationNameForEvent = (
  source: SourceConfig | null,
  lat: number | null,
  lng: number | null,
  fallbackName = "Map location",
) => {
  const venueLocation = findVenueLocationForCoordinates(source, lat, lng);
  return venueLocation?.name || source?.name || fallbackName;
};

const locationCategoriesForSource = (source: SourceConfig) => {
  const categorySlugs = [
    source.source_type,
    ...(source.source_categories ?? []),
  ]
    .map(normalizeCategory)
    .filter(Boolean);

  return [...new Set(categorySlugs)];
};

export const mapLocationIdForEvent = (
  event: EventRow,
  sourceSlug: string | null,
  configuredSources: SourceConfig[],
) => {
  const source = sourceBySlug(configuredSources, sourceSlug);
  const coordinates = mapCoordinatesForEvent(
    event,
    sourceSlug,
    configuredSources,
  );
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
  return (
    coordinatePairFrom(event.lat, event.lng) ??
    coordinatePairFrom(source?.lat, source?.lng)
  );
};

export const categoriesForEvents = (events: EventRow[]): CategoryOption[] => {
  const categoryMap = new Map<string, string>();

  for (const event of events) {
    for (const category of event.categories) {
      const slug = normalizeCategory(category);
      if (!slug || categoryMap.has(slug)) continue;
      categoryMap.set(slug, titleCaseCategory(category));
    }
  }

  return [...categoryMap.entries()]
    .map(([slug, label]) => ({ slug, label: label.toLowerCase() }))
    .sort((a, b) => {
      const aIndex = preferredCategoryOrder.indexOf(a.slug);
      const bIndex = preferredCategoryOrder.indexOf(b.slug);

      if (aIndex === -1 && bIndex === -1) return a.label.localeCompare(b.label);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
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

    const coordinates = mapCoordinatesForEvent(
      event,
      sourceSlug,
      configuredSources,
    );
    const lat = coordinates?.lat ?? null;
    const lng = coordinates?.lng ?? null;
    const id = mapLocationIdForEvent(event, sourceSlug, configuredSources);
    if (lat === null || lng === null || !id) return;

    const existing = locations.get(id);
    const categories = source
      ? locationCategoriesForSource(source)
      : normalizeCategoryList(event.categories ?? []);
    if (existing) {
      existing.categories = [
        ...new Set([...existing.categories, ...categories]),
      ];
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
