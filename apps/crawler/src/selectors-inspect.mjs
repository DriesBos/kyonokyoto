// Collects pages for selector review: per source, a few listing and detail
// pages plus how the current config extracts them. Pages come from Supabase
// raw_pages when crawler credentials are available (--from=raw), otherwise
// they are fetched politely through the crawler's own fetch path (--from=live).
//
//   pnpm selectors:inspect -- --city=kyoto [--source=a,b] [--unhealthy] [--from=raw|live]
//
// Output lands in apps/crawler/.cache/selectors/<city>/ (gitignored).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import {
  isCrawlEnabled,
  loadSourcesConfig,
  normalizeCity,
} from '../../../data/sources/source-config.mjs';
import {
  closeCrawl4AiRenderer,
  createCrawlDiagnostics,
  discoverDetailUrls,
  fetchHtml,
  getCrawl4AiRenderMode,
  getSourceRenderMode,
} from './run-once.mjs';
import {
  condenseHtml,
  crawlConfigFor,
  defaultSelectorCacheDir,
  evaluateSource,
  getArg,
  listArg,
  readJson,
  writeJson,
} from './selector-tools.mjs';

async function loadEnv() {
  try {
    const fileEnv = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    return { ...fileEnv, ...process.env };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { ...process.env };
  }
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

async function sourceIdsBySlug(env, city) {
  const rows = await restGet(env, `sources?select=id,slug&city=eq.${encodeURIComponent(city)}`);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

// Sources whose latest run did not finish cleanly (partial or failed).
async function unhealthySlugs(env, city) {
  const ids = await sourceIdsBySlug(env, city);
  const slugById = new Map([...ids].map(([slug, id]) => [id, slug]));
  const runs = await restGet(
    env,
    `crawl_runs?select=source_id,status,created_at&source_id=in.(${[...ids.values()].join(',')})&order=created_at.desc&limit=5000`,
  );
  const latest = new Map();
  for (const run of runs) if (!latest.has(run.source_id)) latest.set(run.source_id, run);
  return [...latest.values()]
    .filter((run) => run.status !== 'success')
    .map((run) => slugById.get(run.source_id))
    .filter(Boolean);
}

async function savedPages(env, sourceId, detailLimit) {
  const pages = [];
  for (const [kind, limit] of [
    ['listing', 3],
    ['detail', detailLimit],
  ]) {
    const rows = await restGet(
      env,
      `raw_pages?select=url,raw_html,metadata,fetched_at&source_id=eq.${sourceId}&page_kind=eq.${kind}&raw_html=not.is.null&order=fetched_at.desc&limit=${limit * 4}`,
    );
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.url) || seen.size >= limit) continue;
      seen.add(row.url);
      pages.push({
        kind,
        url: row.url,
        html: row.raw_html,
        fetched_via: row.metadata?.fetched_via ?? null,
        fetched_at: row.fetched_at,
      });
    }
  }
  return pages;
}

async function livePages(env, source, detailLimit, userAgent) {
  const config = crawlConfigFor(source);
  const renderMode = getSourceRenderMode(config, getCrawl4AiRenderMode(env));
  const context = {
    diagnostics: createCrawlDiagnostics(env),
    allowedDomains: config.allowed_domains ?? [],
    waitFor: config.crawl_hints?.wait_for ?? null,
    waitForImages: config.crawl_hints?.wait_for_images,
    scanFullPage: config.crawl_hints?.scan_full_page,
  };
  const toPage = (kind, url, fetched) => ({
    kind,
    url,
    html: fetched.html,
    fitHtml: fetched.fitHtml ?? '',
    cleanedHtml: fetched.cleanedHtml ?? '',
    fetched_via: fetched.metadata?.fetched_via ?? null,
    fetched_at: new Date().toISOString(),
  });

  const pages = [];
  for (const url of [...new Set(config.start_urls ?? [])].slice(0, 3)) {
    pages.push(
      toPage('listing', url, await fetchHtml(url, userAgent, env, { renderMode, context })),
    );
  }
  const detailUrls = discoverDetailUrls(config, pages, detailLimit + 1).slice(0, detailLimit);
  for (const url of detailUrls) {
    pages.push(
      toPage('detail', url, await fetchHtml(url, userAgent, env, { renderMode, context })),
    );
  }
  return pages;
}

async function writeSourceDump(sourceDir, pages) {
  await mkdir(resolve(sourceDir, 'condensed'), { recursive: true });
  const manifest = [];
  const counters = { listing: 0, detail: 0 };

  for (const page of pages) {
    counters[page.kind] += 1;
    const name = `${page.kind}-${counters[page.kind]}`;
    const entry = {
      kind: page.kind,
      url: page.url,
      file: `${name}.html`,
      condensed_file: `condensed/${name}.html`,
      fetched_via: page.fetched_via,
      fetched_at: page.fetched_at,
    };
    await writeFile(resolve(sourceDir, entry.file), page.html ?? '');
    await writeFile(
      resolve(sourceDir, entry.condensed_file),
      `<!-- ${page.kind}: ${page.url} -->\n${condenseHtml(page.html)}\n`,
    );
    if (page.fitHtml) {
      entry.fit_file = `${name}.fit.html`;
      await writeFile(resolve(sourceDir, entry.fit_file), page.fitHtml);
    }
    if (page.cleanedHtml) {
      entry.cleaned_file = `${name}.cleaned.html`;
      await writeFile(resolve(sourceDir, entry.cleaned_file), page.cleanedHtml);
    }
    manifest.push(entry);
  }

  await writeJson(resolve(sourceDir, 'pages.json'), manifest);
}

async function main() {
  const env = await loadEnv();
  const city = normalizeCity(getArg('city', 'kyoto'));
  if (!city) throw new Error(`Unsupported source city "${getArg('city')}"`);

  const hasDatabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const from = getArg('from', hasDatabase ? 'raw' : 'live');
  if (from === 'raw' && !hasDatabase) {
    throw new Error('--from=raw needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  if (getArg('unhealthy') && !hasDatabase) {
    throw new Error('--unhealthy needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  const detailLimit = Math.max(1, Number(getArg('details', '3')) || 3);
  const userAgent = env.CRAWLER_USER_AGENT ?? 'kyo-no-kyoto-bot/0.1';
  const outDir = resolve(getArg('out', resolve(defaultSelectorCacheDir, city)));
  const requested = listArg('source');
  const unhealthy = getArg('unhealthy') ? new Set(await unhealthySlugs(env, city)) : null;
  const sources = (await loadSourcesConfig({ city })).filter(
    (source) =>
      source.is_active !== false &&
      (requested.length ? requested.includes(source.slug) : isCrawlEnabled(source)) &&
      (!unhealthy || unhealthy.has(source.slug)),
  );
  const ids = from === 'raw' ? await sourceIdsBySlug(env, city) : null;
  const index = (await readJson(resolve(outDir, 'index.json'), null)) ?? { city, sources: {} };

  try {
    for (const source of sources) {
      const sourceDir = resolve(outDir, source.slug);
      try {
        const pages =
          from === 'raw'
            ? await savedPages(env, ids.get(source.slug), detailLimit)
            : await livePages(env, source, detailLimit, userAgent);
        await writeSourceDump(sourceDir, pages);
        const baseline = evaluateSource(source, pages);
        await writeJson(resolve(sourceDir, 'baseline.json'), baseline);
        index.sources[source.slug] = {
          from,
          inspected_at: new Date().toISOString(),
          listing_pages: baseline.listing.pages,
          detail_pages: baseline.details.length,
          detail_urls_found: baseline.listing.detail_urls_found,
          invalid_field_count: baseline.invalid_field_count,
          invalid_fields: [...new Set(baseline.details.flatMap((detail) => detail.invalid_fields))],
          extractor: baseline.details[0]?.extractor ?? null,
        };
        console.log(
          `${source.slug}: ${baseline.details.length} detail pages, ${baseline.invalid_field_count} invalid fields`,
        );
      } catch (error) {
        index.sources[source.slug] = {
          from,
          inspected_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
        console.warn(`${source.slug}: ${index.sources[source.slug].error}`);
      }
      await writeJson(resolve(outDir, 'index.json'), index);
    }
  } finally {
    closeCrawl4AiRenderer();
  }

  const proposalsPath = resolve(outDir, 'proposals.json');
  if (!(await readJson(proposalsPath, null))) {
    await writeJson(proposalsPath, { city, sources: {} });
  }
  console.log(`Wrote ${sources.length} sources to ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
