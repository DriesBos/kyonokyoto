import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcesPath = resolve(__dirname, "kyoto-sources.json");
const overridesPath = resolve(__dirname, "source-overrides.json");
const supportedLocales = new Set(["en", "ja"]);
const supportedRenderModes = new Set(["auto", "always", "never"]);
const selectorKeys = new Set(["listing_links", "title", "description", "date", "images"]);

function normalizeLocale(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "jp") return "ja";
  return supportedLocales.has(normalized) ? normalized : null;
}

function normalizeLocaleConfig(value = {}) {
  const locales = {};

  for (const [rawLocale, rawConfig] of Object.entries(value ?? {})) {
    const locale = normalizeLocale(rawLocale);
    if (!locale || !rawConfig || typeof rawConfig !== "object") continue;

    locales[locale] = {
      start_urls: Array.isArray(rawConfig.start_urls) ? rawConfig.start_urls : [],
      event_page_patterns: Array.isArray(rawConfig.event_page_patterns) ? rawConfig.event_page_patterns : [],
    };
  }

  return locales;
}

function normalizeLocaleTextMap(value = {}) {
  const textMap = {};

  for (const [rawLocale, rawValue] of Object.entries(value ?? {})) {
    const locale = normalizeLocale(rawLocale);
    if (!locale || typeof rawValue !== "string" || !rawValue.trim()) continue;

    textMap[locale] = rawValue.trim();
  }

  return textMap;
}

function normalizeLocaleList(value = []) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map(normalizeLocale)
        .filter(Boolean),
    ),
  ];
}

function normalizeCapabilities(value = {}) {
  const capabilities = value && typeof value === "object" ? value : {};
  const nativeLocales = normalizeLocaleList(capabilities.native_locales);
  const output = {};

  if (nativeLocales.length) output.native_locales = nativeLocales;
  if (typeof capabilities.machine_translate_missing_locales === "boolean") {
    output.machine_translate_missing_locales = capabilities.machine_translate_missing_locales;
  }

  return output;
}

function normalizeSelectors(value = {}) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, selector]) => {
        if (!selectorKeys.has(key)) return false;
        if (typeof selector === "string") return selector.trim();
        return Array.isArray(selector) && selector.some((item) => typeof item === "string" && item.trim());
      })
      .map(([key, selector]) => [
        key,
        Array.isArray(selector)
          ? selector.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
          : selector.trim(),
      ]),
  );
}

function normalizeStringList(value = []) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function normalizeCrawlHints(value = {}) {
  const hints = value && typeof value === "object" ? value : {};
  const output = {};

  if (typeof hints.requires_render === "boolean") output.requires_render = hints.requires_render;
  if (typeof hints.render_mode === "string" && supportedRenderModes.has(hints.render_mode.trim().toLowerCase())) {
    output.render_mode = hints.render_mode.trim().toLowerCase();
  }

  const maxDetailPages = Number(hints.max_detail_pages);
  if (Number.isInteger(maxDetailPages) && maxDetailPages > 0) output.max_detail_pages = maxDetailPages;

  const skipPatterns = normalizeStringList(hints.skip_patterns);
  if (skipPatterns.length) output.skip_patterns = skipPatterns;

  return output;
}

function normalizeVenueLocations(value = []) {
  if (!Array.isArray(value)) return [];

  return value
    .map((location) => {
      if (!location || typeof location !== "object") return null;

      const lat = Number(location.lat);
      const lng = Number(location.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const match = Array.isArray(location.match)
        ? location.match
        : [location.match ?? location.name];
      const normalizedMatch = match
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());

      if (!normalizedMatch.length) return null;

      return {
        ...location,
        match: normalizedMatch,
        lat,
        lng,
      };
    })
    .filter(Boolean);
}

export function applySourceOverride(source, override = {}) {
  const sourceLocales = normalizeLocaleConfig(source.locales);
  const overrideLocales = normalizeLocaleConfig(override.locales);
  const sourceNames = normalizeLocaleTextMap(source.names);
  const overrideNames = normalizeLocaleTextMap(override.names);
  const sourceVenueLocations = normalizeVenueLocations(source.venue_locations);
  const overrideVenueLocations = normalizeVenueLocations(override.venue_locations);
  const sourceCapabilities = normalizeCapabilities(source.capabilities);
  const overrideCapabilities = normalizeCapabilities(override.capabilities);
  const sourceSelectors = normalizeSelectors(source.selectors);
  const overrideSelectors = normalizeSelectors(override.selectors);
  const sourceCrawlHints = normalizeCrawlHints(source.crawl_hints);
  const overrideCrawlHints = normalizeCrawlHints(override.crawl_hints);

  return {
    ...source,
    ...override,
    start_urls: override.start_urls ?? source.start_urls ?? [],
    allowed_domains: override.allowed_domains ?? source.allowed_domains ?? [],
    event_page_patterns: override.event_page_patterns ?? source.event_page_patterns ?? [],
    source_categories: override.source_categories ?? source.source_categories ?? [],
    locales: {
      ...sourceLocales,
      ...overrideLocales,
    },
    names: {
      ...sourceNames,
      ...overrideNames,
    },
    capabilities: {
      ...sourceCapabilities,
      ...overrideCapabilities,
    },
    selectors: {
      ...sourceSelectors,
      ...overrideSelectors,
    },
    crawl_hints: {
      ...sourceCrawlHints,
      ...overrideCrawlHints,
    },
    venue_locations: override.venue_locations
      ? overrideVenueLocations
      : sourceVenueLocations,
  };
}

export function validateSourceConfig(source) {
  const warnings = [];
  const slug = source?.slug ?? "unknown-source";

  if (!source?.name) warnings.push(`${slug}: missing name`);
  if (!Array.isArray(source?.source_categories) || !source.source_categories.length) {
    warnings.push(`${slug}: missing source_categories`);
  }
  if (!Number.isFinite(Number(source?.lat)) || !Number.isFinite(Number(source?.lng))) {
    warnings.push(`${slug}: missing lat/lng`);
  }

  const nativeLocales = source?.capabilities?.native_locales ?? [];
  const localeKeys = Object.entries(source?.locales ?? {})
    .filter(([, config]) => config?.start_urls?.length)
    .map(([locale]) => locale);

  for (const locale of nativeLocales) {
    if (!supportedLocales.has(locale)) warnings.push(`${slug}: unsupported native locale "${locale}"`);
  }

  if (!nativeLocales.length && !localeKeys.length) {
    warnings.push(`${slug}: no locale start_urls or capabilities.native_locales`);
  }

  return warnings;
}

export async function loadSourceOverrides() {
  try {
    const fileContents = await readFile(overridesPath, "utf8");
    const payload = JSON.parse(fileContents);
    return payload.sources ?? {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function loadSourcesConfig() {
  const fileContents = await readFile(sourcesPath, "utf8");
  const payload = JSON.parse(fileContents);

  if (!Array.isArray(payload.sources)) {
    throw new Error("Expected data/sources/kyoto-sources.json to contain a sources array");
  }

  const overrides = await loadSourceOverrides();

  return payload.sources.map((source) => applySourceOverride(source, overrides[source.slug]));
}
