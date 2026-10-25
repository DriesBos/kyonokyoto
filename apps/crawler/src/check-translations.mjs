import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { localesForCity, timeZoneForCity } from '../../../data/sources/source-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

function getEnvNumber(env, name, fallback) {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadEnv() {
  const fileEnv = parseEnv(await readFile(envPath, 'utf8'));
  return { ...fileEnv, ...process.env };
}

async function supabaseRequest({ env, path }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_API_TIMEOUT_MS', 30000)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}) for ${path}: ${errorText}`);
  }

  return response.json();
}

function todayInCity(city, now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timeZoneForCity(city) }).format(now);
}

// Past events can never display (the web filters end_date >= today), so only
// current and upcoming events need every city locale.
export function isCurrentOrUpcoming(row, now = new Date()) {
  return !row.end_date || row.end_date >= todayInCity(row.sources?.city, now);
}

export function findMissingTranslations(rows, now = new Date()) {
  const current = (rows ?? []).filter((row) => isCurrentOrUpcoming(row, now));
  const missing = current
    .map((row) => {
      const locales = new Set(
        (row.event_translations ?? []).map((translation) => translation.locale).filter(Boolean),
      );
      return {
        id: row.id,
        title: row.title,
        source: row.sources?.slug ?? null,
        city: row.sources?.city ?? null,
        end_date: row.end_date ?? null,
        missing: localesForCity(row.sources?.city).filter((locale) => !locales.has(locale)),
      };
    })
    .filter((row) => row.missing.length > 0);

  return {
    status: missing.length ? 'failed' : 'passed',
    events_checked: current.length,
    past_events_skipped: (rows?.length ?? 0) - current.length,
    events_missing_translations: missing.length,
    missing,
  };
}

async function main() {
  const env = await loadEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env');
  }

  const rows = await supabaseRequest({
    env,
    path: 'events?status=eq.published&select=id,title,end_date,sources(slug,city),event_translations(locale)&limit=1000',
  });
  const report = findMissingTranslations(rows);

  console.log(JSON.stringify(report, null, 2));

  if (report.missing.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
