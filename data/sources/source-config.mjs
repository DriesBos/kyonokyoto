import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcesPath = resolve(__dirname, "kyoto-sources.json");
const overridesPath = resolve(__dirname, "source-overrides.json");
const supportedLocales = new Set(["en", "ja"]);

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

export function applySourceOverride(source, override = {}) {
  const sourceLocales = normalizeLocaleConfig(source.locales);
  const overrideLocales = normalizeLocaleConfig(override.locales);

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
  };
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
