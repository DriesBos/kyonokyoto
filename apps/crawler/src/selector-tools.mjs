import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySourceOverride } from '../../../data/sources/source-config.mjs';
import {
  discoverDetailUrls,
  extractEventForReview,
  getSourceLocale,
  selectElements,
  withSourceLocaleConfig,
} from './run-once.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const selectorKeys = ['listing_links', 'title', 'date', 'description', 'images'];
export const defaultSelectorCacheDir = resolve(__dirname, '..', '.cache', 'selectors');

export function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return process.argv.includes(`--${name}`) ? true : fallback;
}

export function listArg(name) {
  const value = getArg(name);
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function crawlConfigFor(source) {
  return withSourceLocaleConfig(source, getSourceLocale(source));
}

// The crawler's selector engine only understands descendant chains of
// tag/#id/.class/[attr] parts, joined by commas. Anything else is ignored
// silently at crawl time, so flag it before it reaches the overrides file.
export function unsupportedSelectorReason(selector) {
  const value = String(selector ?? '').trim();
  if (!value) return 'empty selector';
  const withoutAttributes = value.replace(/\[[^\]]*\]/g, '');
  if (/[>+~]/.test(withoutAttributes)) return 'combinators (>, +, ~) are not supported';
  if (/:/.test(withoutAttributes)) return 'pseudo-classes are not supported';
  if (/\*/.test(withoutAttributes)) return 'universal selector is not supported';
  return null;
}

export function normalizeSelectorProposal(selectors = {}) {
  const normalized = {};
  const problems = [];

  for (const [key, value] of Object.entries(selectors ?? {})) {
    if (!selectorKeys.includes(key)) {
      problems.push(`${key}: unknown selector key`);
      continue;
    }
    const list = (Array.isArray(value) ? value : [value])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    for (const selector of list) {
      const reason = unsupportedSelectorReason(selector);
      if (reason) problems.push(`${key} "${selector}": ${reason}`);
    }
    if (list.length) normalized[key] = list.length === 1 ? list[0] : list;
  }

  return { selectors: normalized, problems };
}

// Shrinks a page for reading: drops scripts, styles, SVG, comments, inline
// data and noisy attributes, but keeps the tags, ids, classes, links, image
// sources and dates that selectors are written against.
export function condenseHtml(html, maxChars = 60000) {
  const keptAttributes = new Set([
    'id',
    'class',
    'href',
    'src',
    'data-src',
    'data-lazy-src',
    'srcset',
    'alt',
    'datetime',
    'property',
    'name',
    'content',
    'width',
    'height',
    'itemprop',
    'role',
  ]);
  const condensed = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b(?![^>]*(?:property|name)=["'](?:og:|description))[^>]*>/gi, '')
    .replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (_tag, name, attrs) => {
      const kept = [...attrs.matchAll(/([a-z0-9_:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)]
        .filter(([, attrName]) => keptAttributes.has(attrName.toLowerCase()))
        .map(([, attrName, attrValue]) => {
          const raw = attrValue.replace(/^["']|["']$/g, '');
          const value = raw.startsWith('data:')
            ? 'data:…'
            : raw.length > 200
              ? `${raw.slice(0, 200)}…`
              : raw;
          return `${attrName}="${value.replaceAll('"', '&quot;')}"`;
        });
      return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  return condensed.length > maxChars
    ? `${condensed.slice(0, maxChars)}\n<!-- truncated ${condensed.length - maxChars} chars -->`
    : condensed;
}

export function summarizeEvent(event = {}) {
  const description = String(event.description ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: event.title ?? null,
    start_date: event.start_date ?? null,
    end_date: event.end_date ?? null,
    description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
    primary_image_url: event.primary_image_url ?? null,
    title_origin: event._title_origin ?? null,
    description_origin: event._description_origin ?? null,
  };
}

export function selectorMatchCounts(html, selectors = {}) {
  return Object.fromEntries(
    Object.entries(selectors).map(([key, value]) => [
      key,
      (Array.isArray(value) ? value : [value]).reduce(
        (count, selector) => count + selectElements(html, selector).length,
        0,
      ),
    ]),
  );
}

export function evaluateSource(source, pages) {
  const config = crawlConfigFor(source);
  const listingPages = pages.filter((page) => page.kind === 'listing');
  const detailPages = pages.filter((page) => page.kind === 'detail');
  const details = detailPages.map((page) => {
    try {
      const result = extractEventForReview(page, config, { listingPages });
      return {
        url: page.url,
        extractor: result.extractor,
        invalid_fields: result.invalidFields,
        values: summarizeEvent(result.event),
        selector_matches: selectorMatchCounts(page.html, config.selectors ?? {}),
      };
    } catch (error) {
      return {
        url: page.url,
        error: error instanceof Error ? error.message : String(error),
        invalid_fields: ['title', 'date', 'description', 'image'],
      };
    }
  });
  const discovered = listingPages.length ? discoverDetailUrls(config, listingPages, 50) : [];

  return {
    selectors: config.selectors ?? {},
    details,
    invalid_field_count: details.reduce((count, detail) => count + detail.invalid_fields.length, 0),
    listing: {
      pages: listingPages.length,
      detail_urls_found: discovered.length,
      known_detail_urls_found: detailPages.filter((page) => discovered.includes(page.url)).length,
      sample: discovered.slice(0, 8),
    },
  };
}

export function compareEvaluations(baseline, candidate, { listingChanged = false } = {}) {
  const regressions = [];
  const fixes = [];

  candidate.details.forEach((detail, index) => {
    const before = new Set(baseline.details[index]?.invalid_fields ?? []);
    const after = new Set(detail.invalid_fields);
    for (const field of after) if (!before.has(field)) regressions.push(`${detail.url}: ${field}`);
    for (const field of before) if (!after.has(field)) fixes.push(`${detail.url}: ${field}`);
  });

  if (
    listingChanged &&
    candidate.listing.known_detail_urls_found < baseline.listing.known_detail_urls_found
  ) {
    regressions.push('listing: fewer known detail pages discovered');
  }
  if (listingChanged && candidate.listing.detail_urls_found > baseline.listing.detail_urls_found) {
    fixes.push(
      `listing: ${baseline.listing.detail_urls_found} → ${candidate.listing.detail_urls_found} detail URLs`,
    );
  }

  return {
    fixes,
    regressions,
    improved: fixes.length > 0 && regressions.length === 0,
  };
}

export function withProposedSelectors(source, selectors) {
  return applySourceOverride(source, { selectors });
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadSavedPages(sourceDir) {
  const manifest = await readJson(resolve(sourceDir, 'pages.json'), []);
  const readOptional = (file) => (file ? readFile(resolve(sourceDir, file), 'utf8') : '');
  return Promise.all(
    manifest.map(async (page) => ({
      ...page,
      html: await readFile(resolve(sourceDir, page.file), 'utf8'),
      fitHtml: await readOptional(page.fit_file),
      cleanedHtml: await readOptional(page.cleaned_file),
    })),
  );
}
