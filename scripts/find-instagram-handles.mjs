// Finds each venue's Instagram handle by scanning its website for instagram.com links (homepage
// first, then the first start URL). Used in Instagram post captions as @handle
// (apps/web-next/src/lib/socialPosts.ts; source config field "instagram").
//
//   node scripts/find-instagram-handles.mjs            report only → data/instagram-handles-report.json
//   node scripts/find-instagram-handles.mjs --write    also sets "instagram" on sources with exactly
//                                                      one handle found (never overwrites an existing one)
//
// Sources whose site shows several handles (artists, sister venues) or none are listed in the
// report for a manual pick.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CITIES = ['kyoto', 'osaka', 'tokyo', 'hong-kong'];
const write = process.argv.includes('--write');
const root = resolve(import.meta.dirname, '..');
// Paths on instagram.com that are not accounts.
const NOT_ACCOUNTS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'explore',
  'stories',
  'accounts',
  'about',
  'developer',
  'legal',
  'direct',
  'web',
  'share',
  'sharer',
  'sharer.php',
  'oauth',
  'embed.js',
  'static',
]);

export function instagramHandlesIn(html) {
  const counts = new Map();
  const pattern = /instagram\.com\/(?:#!\/)?([A-Za-z0-9._]{1,30})(?=[/?"'#\s<]|$)/gi;
  for (const match of html.matchAll(pattern)) {
    const handle = match[1].replace(/\.+$/, '').toLowerCase();
    if (!handle || NOT_ACCOUNTS.has(handle)) continue;
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([handle]) => handle);
}

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      'Accept-Language': 'en,ja;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

async function findFor(source) {
  const urls = [...new Set([source.base_url, source.start_urls?.[0]].filter(Boolean))];
  const errors = [];
  for (const url of urls) {
    try {
      const handles = instagramHandlesIn(await fetchText(url));
      if (handles.length) return { url, handles };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  return { url: urls[0] ?? null, handles: [], errors };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = { generated_at: new Date().toISOString(), found: [], several: [], none: [] };
  for (const city of CITIES) {
    const path = resolve(root, `data/sources/${city}-sources.json`);
    const raw = await readFile(path, 'utf8');
    const config = JSON.parse(raw);
    const sources = (config.sources ?? []).filter((source) => source.source_kind !== 'aggregator');
    const results = await mapLimit(sources, 6, async (source) => ({
      source,
      ...(await findFor(source)),
    }));
    let changed = 0;
    for (const { source, url, handles, errors } of results) {
      const row = {
        city,
        slug: source.slug,
        name: source.name,
        url,
        current: source.instagram ?? null,
      };
      if (handles.length === 1) {
        report.found.push({ ...row, handle: handles[0] });
        if (write && !source.instagram) {
          source.instagram = handles[0];
          changed += 1;
        }
      } else if (handles.length > 1) {
        report.several.push({ ...row, handles });
      } else {
        report.none.push({ ...row, errors: errors?.length ? errors : undefined });
      }
      console.log(`${city}/${source.slug}: ${handles.join(', ') || errors?.join('; ') || 'none'}`);
    }
    if (write && changed) {
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
      console.log(`${city}: set instagram on ${changed} source(s)`);
    }
  }
  await writeFile(
    resolve(root, 'data/instagram-handles-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `found ${report.found.length}, several ${report.several.length}, none ${report.none.length}`,
  );
}
