import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { loadSourcesConfig, normalizeCity } from '../data/sources/source-config.mjs';
import { primaryVenueCategory } from '../data/categories.mjs';
import { assertPruneAllowed, isLargePruneDiff } from './source-sync-safety.mjs';

const projectRoot = process.cwd();
const crawlerEnvPath = resolve(projectRoot, 'apps/crawler/.env');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getEnvNumber(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function restRequest({
  env,
  path,
  method = 'GET',
  body = null,
  prefer = 'return=representation',
}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_API_TIMEOUT_MS', 30000)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}) for ${path}: ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

const envContents = await readFile(crawlerEnvPath, 'utf8');
const env = parseEnv(envContents);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env');
}

const city = normalizeCity(getArg('city', 'kyoto'));
if (!city) {
  throw new Error(`Unsupported source city "${getArg('city')}"`);
}

const sourceConfig = await loadSourcesConfig({ city });
const configuredSlugs = new Set(sourceConfig.map((source) => source.slug));
const pruneRequested = hasFlag('--prune');
const allowLargePrune = hasFlag('--allow-large-prune');

const sources = sourceConfig.map((source) => ({
  slug: source.slug,
  city,
  name: source.name,
  source_type: primaryVenueCategory(source.taxonomy),
  language: source.language ?? 'ja',
  base_url: source.base_url,
  start_urls: source.start_urls ?? [],
  allowed_domains: source.allowed_domains ?? [],
  crawl_strategy: source.crawl_strategy ?? 'listing-and-detail-pages',
  event_page_patterns: source.event_page_patterns ?? [],
  locales: source.locales ?? {},
  notes: source.notes ?? null,
  is_active: source.is_active ?? true,
}));

const upsertedSources = sources.length
  ? await restRequest({
      env,
      path: 'sources?on_conflict=slug',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: sources,
    })
  : [];

const existingSources = await restRequest({
  env,
  path: `sources?select=id,slug&city=eq.${encodeURIComponent(city)}`,
});

const removedSources = existingSources.filter((source) => !configuredSlugs.has(source.slug));
const removedSourceSlugs = removedSources.map((source) => source.slug);
const confirmedPruneCount = Number(getArg('confirm-prune'));

let deletedSourceCount = 0;
let deletedEventCount = 0;

if (pruneRequested) {
  assertPruneAllowed({
    configuredCount: sources.length,
    existingCount: existingSources.length,
    removedCount: removedSources.length,
    confirmedCount: confirmedPruneCount,
    allowLargePrune,
  });

  if (removedSources.length) {
    const result = await restRequest({
      env,
      path: 'rpc/prune_sources',
      method: 'POST',
      body: {
        p_city: city,
        p_slugs: removedSourceSlugs,
      },
    });
    deletedSourceCount = result?.removed_sources ?? 0;
    deletedEventCount = result?.removed_events ?? 0;
  }
}

console.log(
  JSON.stringify(
    {
      configured_sources: sources.length,
      city,
      upserted_sources: upsertedSources?.length ?? 0,
      prune_requested: pruneRequested,
      prune_candidates: removedSources.length,
      large_prune: isLargePruneDiff(removedSources.length, existingSources.length),
      removed_sources: deletedSourceCount,
      removed_events: deletedEventCount,
      removed_source_slugs: removedSourceSlugs,
    },
    null,
    2,
  ),
);
