import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMachineTranslatedEvent,
  upsertEventTranslation,
} from './run-once.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const supportedLocales = ['en', 'ja'];

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

function applyEnvToProcess(env) {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function getNumberArg(name, fallback) {
  const value = getArg(name);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMissingLocale(locale) {
  return locale === 'ja' ? 'en' : 'ja';
}

function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'jp' || normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

async function loadEnv() {
  const fileEnv = parseEnvFile(await readFile(envPath, 'utf8'));
  applyEnvToProcess(fileEnv);
  return { ...fileEnv, ...process.env };
}

async function supabaseRequest({ env, path, method = 'GET', body = null }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Supabase request failed (${response.status}) for ${path}: ${errorText}`,
    );
  }

  return response.status === 204 ? null : response.json();
}

function eventDataFromRow(row) {
  return {
    title: row.title,
    description: row.description ?? null,
    institution_name: row.institution_name,
    venue_name: row.venue_name ?? null,
    address_text: row.address_text ?? null,
    date_text: row.date_text,
    source_url: row.source_url,
  };
}

function eventDataFromTranslation(translation) {
  return {
    title: translation.title,
    description: translation.description ?? null,
    institution_name: translation.institution_name,
    venue_name: translation.venue_name ?? null,
    address_text: translation.address_text ?? null,
    date_text: translation.date_text,
    source_url: translation.source_url,
  };
}

function getTranslationSource(row) {
  const translations = row.event_translations ?? [];
  const sourceLocale = normalizeLocale(row.sources?.language) ?? 'ja';
  const preferred =
    translations.find((translation) => translation.locale === sourceLocale) ??
    translations[0] ??
    null;

  if (preferred) {
    return {
      locale: preferred.locale,
      eventData: eventDataFromTranslation(preferred),
    };
  }

  return {
    locale: sourceLocale,
    eventData: eventDataFromRow(row),
  };
}

function getMissingLocales(row) {
  const existingLocales = new Set(
    (row.event_translations ?? [])
      .map((translation) => normalizeLocale(translation.locale))
      .filter(Boolean),
  );

  return supportedLocales.filter((locale) => !existingLocales.has(locale));
}

async function main() {
  const env = await loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  const limit = getNumberArg('limit', 1000);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env',
    );
  }

  const rows = await supabaseRequest({
    env,
    path:
      `events?status=eq.published&select=id,title,description,institution_name,venue_name,address_text,date_text,source_url,sources(slug,language),event_translations(locale,title,description,institution_name,venue_name,address_text,date_text,source_url)&limit=${limit}`,
  });

  const missing = [];
  const written = [];
  const skipped = [];

  for (const row of rows ?? []) {
    const missingLocales = getMissingLocales(row);
    if (!missingLocales.length) continue;

    missing.push({
      id: row.id,
      title: row.title,
      source: row.sources?.slug ?? null,
      missing: missingLocales,
    });

    const translationSource = getTranslationSource(row);

    for (const targetLocale of missingLocales) {
      const sourceLocale =
        translationSource.locale === targetLocale
          ? getMissingLocale(targetLocale)
          : translationSource.locale;
      const translatedEvent = await buildMachineTranslatedEvent(
        env,
        translationSource.eventData,
        sourceLocale,
        targetLocale,
      );

      if (!translatedEvent) {
        skipped.push({
          id: row.id,
          targetLocale,
          reason: 'translation unavailable',
        });
        continue;
      }

      if (!dryRun) {
        await upsertEventTranslation(env, row.id, targetLocale, translatedEvent);
      }

      written.push({
        id: row.id,
        targetLocale,
        dryRun,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        status: 'complete',
        dryRun,
        events_checked: rows?.length ?? 0,
        events_missing_translations: missing.length,
        translations_written: written.length,
        translations_skipped: skipped.length,
        missing,
        skipped,
      },
      null,
      2,
    ),
  );
}

await main();
