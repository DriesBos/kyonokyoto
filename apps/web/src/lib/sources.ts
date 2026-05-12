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
  is_active?: boolean;
  map_visibility?: boolean;
};

export type MapSource = {
  slug: string;
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

export const normalizeCategoryList = (values: string[]) =>
  [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];

export const titleCaseCategory = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const configuredSourcesFrom = (sources: SourceConfig[]) =>
  sources
    .filter((source) => source.is_active !== false)
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

  for (const domain of source.allowed_domains ?? []) {
    const normalizedDomain = domain.toLowerCase();
    if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) {
      score = Math.max(score, 10);
    }
  }

  for (const candidateUrl of [source.base_url, ...(source.start_urls ?? [])]) {
    const normalizedCandidate = normalizeUrl(candidateUrl);
    if (!normalizedCandidate) continue;

    if (url.toString().startsWith(normalizedCandidate.toString())) {
      score = Math.max(score, 100 + normalizedCandidate.pathname.length);
    }
  }

  for (const pattern of source.event_page_patterns ?? []) {
    if (pattern && url.pathname.includes(pattern)) {
      score = Math.max(score, 40 + pattern.length);
    }
  }

  return score;
};

export const sourceCategoriesForEvent = (event: EventRow, configuredSources: SourceConfig[]) => {
  const bestSource = configuredSources
    .map((source) => ({ source, score: sourceMatchScore(event.source_url, source) }))
    .filter((match) => match.score > 0 && (match.source.source_categories?.length ?? 0) > 0)
    .sort((a, b) => b.score - a.score)[0]?.source;

  return bestSource?.source_categories?.length
    ? bestSource.source_categories
    : normalizeCategoryList(event.categories ?? []);
};

export const sourceSlugForEvent = (event: EventRow, configuredSources: SourceConfig[]) =>
  configuredSources
    .map((source) => ({ source, score: sourceMatchScore(event.source_url, source) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.source.slug ?? null;

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
  const eventSourceSlugs = new Set([...sourceSlugByEventId.values()].filter(Boolean));

  return configuredSources
    .filter(
      (source) =>
        source.map_visibility !== false &&
        eventSourceSlugs.has(source.slug) &&
        typeof source.lat === "number" &&
        typeof source.lng === "number"
    )
    .map((source) => {
      const categorySlugs = [
        source.source_type,
        ...(source.source_categories ?? []),
      ]
        .map(normalizeCategory)
        .filter(Boolean);
      const sourceCategories = [...new Set(categorySlugs)];

      return {
        slug: source.slug,
        name: source.name,
        categories: sourceCategories,
        lat: source.lat as number,
        lng: source.lng as number,
      };
    });
};
