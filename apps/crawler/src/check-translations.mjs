import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const requiredLocales = ['en', 'ja'];

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

async function loadEnv() {
  const fileEnv = parseEnvFile(await readFile(envPath, 'utf8'));
  return { ...fileEnv, ...process.env };
}

async function supabaseRequest({ env, path }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Supabase request failed (${response.status}) for ${path}: ${errorText}`,
    );
  }

  return response.json();
}

const env = await loadEnv();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env',
  );
}

const rows = await supabaseRequest({
  env,
  path:
    'events?status=eq.published&select=id,title,sources(slug),event_translations(locale)&limit=1000',
});

const missing = (rows ?? [])
  .map((row) => {
    const locales = new Set(
      (row.event_translations ?? [])
        .map((translation) => translation.locale)
        .filter(Boolean),
    );
    return {
      id: row.id,
      title: row.title,
      source: row.sources?.slug ?? null,
      missing: requiredLocales.filter((locale) => !locales.has(locale)),
    };
  })
  .filter((row) => row.missing.length > 0);

console.log(
  JSON.stringify(
    {
      status: missing.length ? 'failed' : 'passed',
      events_checked: rows?.length ?? 0,
      events_missing_translations: missing.length,
      missing,
    },
    null,
    2,
  ),
);

if (missing.length) {
  process.exitCode = 1;
}
