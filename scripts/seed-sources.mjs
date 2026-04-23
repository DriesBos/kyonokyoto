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

const envContents = await readFile(crawlerEnvPath, "utf8");
const env = parseEnvFile(envContents);

const supabaseUrl = env.SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env");
}

const sourceConfig = await loadSourcesConfig();

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

const response = await fetch(`${supabaseUrl}/rest/v1/sources?on_conflict=slug`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(sources),
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Supabase seeding failed (${response.status}): ${errorText}`);
}

const inserted = await response.json();
console.log(`Seeded ${inserted.length} sources into public.sources`);
