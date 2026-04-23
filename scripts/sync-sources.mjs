import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSourcesConfig } from "../data/sources/source-config.mjs";

const projectRoot = process.cwd();
const crawlerEnvPath = resolve(projectRoot, "apps/crawler/.env");

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

async function restRequest({ env, path, method = "GET", body = null, prefer = "return=representation" }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}) for ${path}: ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

const envContents = await readFile(crawlerEnvPath, "utf8");
const env = parseEnvFile(envContents);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env");
}

const sourceConfig = await loadSourcesConfig();
const configuredSlugs = new Set(sourceConfig.map((source) => source.slug));

const sources = sourceConfig.map((source) => ({
  slug: source.slug,
  name: source.name,
  source_type: source.source_type,
  language: source.language ?? "ja",
  base_url: source.base_url,
  start_urls: source.start_urls ?? [],
  allowed_domains: source.allowed_domains ?? [],
  crawl_strategy: source.crawl_strategy ?? "listing-and-detail-pages",
  event_page_patterns: source.event_page_patterns ?? [],
  notes: source.notes ?? null,
  is_active: source.is_active ?? true,
}));

const upsertedSources = await restRequest({
  env,
  path: "sources?on_conflict=slug",
  method: "POST",
  prefer: "resolution=merge-duplicates,return=representation",
  body: sources,
});

const existingSources = await restRequest({
  env,
  path: "sources?select=id,slug",
});

const removedSources = existingSources.filter((source) => !configuredSlugs.has(source.slug));

let deletedSourceCount = 0;
let deletedEventCount = 0;

for (const source of removedSources) {
  const deletedEvents = await restRequest({
    env,
    path: `events?source_id=eq.${source.id}`,
    method: "DELETE",
    body: null,
  });

  deletedEventCount += deletedEvents?.length ?? 0;

  const deletedSources = await restRequest({
    env,
    path: `sources?slug=eq.${encodeURIComponent(source.slug)}`,
    method: "DELETE",
    body: null,
  });

  deletedSourceCount += deletedSources?.length ?? 0;
}

console.log(
  JSON.stringify(
    {
      configured_sources: sources.length,
      upserted_sources: upsertedSources?.length ?? 0,
      removed_sources: deletedSourceCount,
      removed_events: deletedEventCount,
      removed_source_slugs: removedSources.map((source) => source.slug),
    },
    null,
    2
  )
);
