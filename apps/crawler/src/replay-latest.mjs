import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { loadSourcesConfig, normalizeCity } from '../../../data/sources/source-config.mjs';
import {
  assessEventTitle,
  eventExtractors,
  extractGenericEvent,
  hasValidEventTitle,
} from './run-once.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function normalizeComparableEvent(event = {}) {
  return {
    title: String(event.title ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    start_date: event.start_date ?? null,
    end_date: event.end_date ?? null,
    schedule_type: event.schedule_type ?? 'unknown',
    occurrence_dates: Array.isArray(event.occurrence_dates) ? event.occurrence_dates : [],
    description_present: Boolean(String(event.description ?? '').trim()),
    primary_image_url: event.primary_image_url ?? null,
    image_urls: Array.isArray(event.image_urls) ? event.image_urls : [],
  };
}

function replayTitleQuality(event = {}) {
  return {
    valid: hasValidEventTitle(event),
    origin: event._title_origin ?? 'unknown',
    warnings: Array.isArray(event._title_warnings) ? event._title_warnings : [],
  };
}

export function compareReplayEvent(extracted, stored) {
  const next = normalizeComparableEvent(extracted);
  const previous = normalizeComparableEvent(stored);
  const changed_fields = Object.keys(next).filter(
    (field) => JSON.stringify(next[field]) !== JSON.stringify(previous[field]),
  );

  return {
    changed_fields,
    title_quality: replayTitleQuality(extracted),
    extracted: next,
    stored: previous,
  };
}

async function restGet(env, path) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    signal: AbortSignal.timeout(Number(env.CRAWLER_API_TIMEOUT_MS) || 30000),
  });

  if (!response.ok) {
    throw new Error(
      `Supabase read failed (${response.status}) for ${path}: ${await response.text()}`,
    );
  }

  return response.json();
}

async function main() {
  const env = { ...parseEnv(await readFile(envPath, 'utf8')), ...process.env };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env');
  }

  const city = normalizeCity(getArg('city', 'kyoto'));
  if (!city) throw new Error(`Unsupported source city "${getArg('city')}"`);

  const requestedSource = getArg('source');
  const limit = Math.max(1, Number(getArg('limit', '2000')) || 2000);
  const configuredSources = (await loadSourcesConfig({ city })).filter(
    (source) => !requestedSource || source.slug === requestedSource,
  );
  if (requestedSource && !configuredSources.length) {
    throw new Error(`Unknown ${city} source "${requestedSource}"`);
  }

  const sourceRows = await restGet(
    env,
    `sources?select=id,slug&city=eq.${encodeURIComponent(city)}`,
  );
  const sourceIdBySlug = new Map(sourceRows.map((source) => [source.slug, source.id]));
  const sources = configuredSources
    .map((source) => ({ ...source, id: sourceIdBySlug.get(source.slug) }))
    .filter((source) => source.id);
  const sourceIds = sources.map((source) => source.id);

  if (!sourceIds.length) {
    console.log(JSON.stringify({ city, sources: 0, pages_replayed: 0 }, null, 2));
    return;
  }

  const inFilter = `in.(${sourceIds.join(',')})`;
  const [rawPages, storedEvents] = await Promise.all([
    restGet(
      env,
      `raw_pages?select=id,source_id,url,raw_html,fetched_at&source_id=${inFilter}&page_kind=eq.detail&order=fetched_at.desc&limit=${limit}`,
    ),
    restGet(
      env,
      `events?select=raw_page_id,source_id,title,start_date,end_date,schedule_type,occurrence_dates,description,primary_image_url,image_urls,status&source_id=${inFilter}&limit=${limit}`,
    ),
  ]);

  const latestPages = new Map();
  for (const page of rawPages) {
    const key = `${page.source_id}\n${page.url}`;
    if (!latestPages.has(key)) latestPages.set(key, page);
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const eventByRawPageId = new Map(
    storedEvents.filter((event) => event.raw_page_id).map((event) => [event.raw_page_id, event]),
  );
  const results = [];

  for (const page of latestPages.values()) {
    const source = sourceById.get(page.source_id);
    if (!source || !page.raw_html) continue;

    try {
      const extractor = eventExtractors[source.slug] ?? extractGenericEvent;
      const extracted = assessEventTitle(
        extractor(page.raw_html, source, page.url, {}),
        source,
        extractor === extractGenericEvent ? 'generic_fallback' : 'source_specific_extractor',
      );
      const stored = eventByRawPageId.get(page.id);
      results.push({
        source: source.slug,
        url: page.url,
        status: stored ? 'compared' : 'no_saved_event',
        ...(stored
          ? compareReplayEvent(extracted, stored)
          : {
              title_quality: replayTitleQuality(extracted),
              extracted: normalizeComparableEvent(extracted),
            }),
      });
    } catch (error) {
      results.push({
        source: source.slug,
        url: page.url,
        status: 'extraction_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const compared = results.filter((result) => result.status === 'compared');
  const changed = compared.filter((result) => result.changed_fields.length);
  const invalidTitles = results.filter((result) => result.title_quality?.valid === false);
  console.log(
    JSON.stringify(
      {
        city,
        sources: sources.length,
        pages_replayed: results.length,
        pages_compared: compared.length,
        pages_changed: changed.length,
        pages_without_saved_event: results.filter((result) => result.status === 'no_saved_event')
          .length,
        invalid_title_count: invalidTitles.length,
        extraction_errors: results.filter((result) => result.status === 'extraction_error').length,
        invalid_titles: invalidTitles.map((result) => ({
          source: result.source,
          url: result.url,
          title: result.extracted.title,
          origin: result.title_quality.origin,
          warnings: result.title_quality.warnings,
        })),
        changes: changed,
        errors: results.filter((result) => result.status === 'extraction_error'),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
