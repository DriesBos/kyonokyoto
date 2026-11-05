// Re-tags stored event images with the current image check (prompt, tags and Dries's latest
// rating examples from data/image-ratings.json). Run after a batch of ratings at /dev/images/ or
// a prompt change. Only current/upcoming events, first three images each. Writes production.
//   pnpm images:recheck -- --dry-run             counts images and estimates the cost
//   pnpm images:recheck -- --city=kyoto --limit=20
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { checkLandingImages } from './landing-image-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE = 200;
// rough Haiku 5.5 cost of one check including cached examples, for the dry-run estimate
const ESTIMATED_USD_PER_IMAGE = 0.0006;

const getArg = (name, fallback = null) => {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

const TAG_KEYS = [
  'landing_ok',
  'image_subject',
  'image_busyness',
  'image_score',
  'image_confidence',
];

// The first three images lose their tags so checkLandingImages classifies them again.
export const withoutTags = (eventRow) => {
  const checked = new Set((eventRow.image_urls ?? []).slice(0, 3));
  return {
    ...eventRow,
    image_metadata: (eventRow.image_metadata ?? []).map((image) =>
      checked.has(image.url)
        ? Object.fromEntries(Object.entries(image).filter(([key]) => !TAG_KEYS.includes(key)))
        : image,
    ),
  };
};

// A failed check leaves an image untagged; keep its old tags instead of wiping them.
export const keepOldTagsOnFailure = (original, rechecked) =>
  rechecked.map((image) => {
    if (typeof image.image_score === 'number') return image;
    const old = (original ?? []).find((item) => item.url === image.url);
    return old
      ? {
          ...image,
          ...Object.fromEntries(TAG_KEYS.filter((key) => key in old).map((key) => [key, old[key]])),
        }
      : image;
  });

export const imagesToCheck = (eventRow) => {
  const urls = new Set((eventRow.image_urls ?? []).slice(0, 3));
  return (eventRow.image_metadata ?? []).filter((image) => urls.has(image.url)).length;
};

async function supabaseRequest(env, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase ${method} ${path} failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.status === 204 || method !== 'GET' ? null : response.json();
}

async function currentEvents(env, city) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select: 'id,city,title,image_urls,image_metadata',
      status: 'eq.published',
      or: `(end_date.is.null,end_date.gte.${today})`,
      order: 'id',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (city !== 'all') params.set('city', `eq.${city}`);
    const page = await supabaseRequest(env, `events?${params}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main() {
  const env = {
    ...parseEnv(await readFile(resolve(__dirname, '..', '.env'), 'utf8')),
    ...process.env,
  };
  const dryRun = process.argv.includes('--dry-run');
  const city = getArg('city', 'all');
  const limit = Number(getArg('limit', 'Infinity'));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env');
  if (!dryRun && !env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const events = (await currentEvents(env, city))
    .filter((row) => imagesToCheck(row) > 0)
    .slice(0, limit);
  const total = events.reduce((sum, row) => sum + imagesToCheck(row), 0);
  console.log(
    `${events.length} events, ${total} images (~$${(total * ESTIMATED_USD_PER_IMAGE).toFixed(2)})`,
  );
  if (dryRun) return;

  let done = 0;
  for (const row of events) {
    const next = await checkLandingImages(withoutTags(row), null, {
      env,
      log: (message) => console.log(message),
    });
    await supabaseRequest(env, `events?id=eq.${row.id}`, {
      method: 'PATCH',
      body: { image_metadata: keepOldTagsOnFailure(row.image_metadata, next.image_metadata) },
    });
    done += 1;
    if (done % 20 === 0) console.log(`${done}/${events.length} events`);
  }
  console.log(`rechecked ${total} images on ${events.length} events`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
