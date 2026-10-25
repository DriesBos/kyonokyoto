// Replays saved pages from selectors:inspect with proposed selectors and
// reports, per source, which required fields they fix or break. With --apply,
// selectors that fix at least one field and break none are merged into
// data/sources/overrides/<city>-overrides.json for review.
//
//   pnpm selectors:check -- --city=kyoto [--source=a,b] [--apply]
//
// Proposals live in apps/crawler/.cache/selectors/<city>/proposals.json:
//   { "sources": { "<slug>": { "selectors": { "title": "...", ... }, "note": "..." } } }
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadSourcesConfig,
  normalizeCity,
  overridePathForCity,
} from '../../../data/sources/source-config.mjs';
import {
  compareEvaluations,
  defaultSelectorCacheDir,
  evaluateSource,
  getArg,
  listArg,
  loadSavedPages,
  normalizeSelectorProposal,
  readJson,
  withProposedSelectors,
  writeJson,
} from './selector-tools.mjs';

export async function checkProposals({ city, dumpDir, proposals, sources, only = [] }) {
  const sourceBySlug = new Map(sources.map((source) => [source.slug, source]));
  const results = [];

  for (const [slug, proposal] of Object.entries(proposals.sources ?? {})) {
    if (only.length && !only.includes(slug)) continue;
    const source = sourceBySlug.get(slug);
    const { selectors, problems } = normalizeSelectorProposal(proposal?.selectors);
    const result = { source: slug, selectors, problems, note: proposal?.note ?? null };
    results.push(result);

    if (!source) {
      result.status = 'unknown_source';
      continue;
    }
    if (!Object.keys(selectors).length) {
      result.status = 'empty';
      continue;
    }
    if (problems.length) {
      result.status = 'unsupported_selector';
      continue;
    }

    const pages = await loadSavedPages(resolve(dumpDir, slug));
    if (!pages.some((page) => page.kind === 'detail')) {
      result.status = 'no_saved_detail_pages';
      continue;
    }

    const baseline = evaluateSource(source, pages);
    const candidate = evaluateSource(withProposedSelectors(source, selectors), pages);
    const comparison = compareEvaluations(baseline, candidate, {
      listingChanged: 'listing_links' in selectors,
    });
    Object.assign(result, comparison, {
      status: comparison.improved
        ? 'improved'
        : comparison.regressions.length
          ? 'regressed'
          : 'no_change',
      invalid_fields: {
        before: baseline.invalid_field_count,
        after: candidate.invalid_field_count,
      },
      pages: candidate.details.map((detail, index) => ({
        url: detail.url,
        before: baseline.details[index].invalid_fields,
        after: detail.invalid_fields,
        values: detail.values,
        selector_matches: detail.selector_matches,
      })),
      listing: { before: baseline.listing, after: candidate.listing },
    });
  }

  return { city, results };
}

export function mergeIntoOverrides(overrides, results) {
  const next = { ...overrides, sources: { ...(overrides.sources ?? {}) } };
  const applied = [];

  for (const result of results) {
    if (result.status !== 'improved') continue;
    const current = next.sources[result.source] ?? {};
    next.sources[result.source] = {
      ...current,
      selectors: { ...(current.selectors ?? {}), ...result.selectors },
    };
    applied.push(result.source);
  }

  return { overrides: next, applied };
}

async function main() {
  const city = normalizeCity(getArg('city', 'kyoto'));
  if (!city) throw new Error(`Unsupported source city "${getArg('city')}"`);

  const dumpDir = resolve(getArg('dir', resolve(defaultSelectorCacheDir, city)));
  const proposalsPath = resolve(getArg('proposals', resolve(dumpDir, 'proposals.json')));
  const proposals = await readJson(proposalsPath, null);
  if (!proposals) throw new Error(`No proposals at ${proposalsPath}; run selectors:inspect first`);

  const sources = await loadSourcesConfig({ city });
  const report = await checkProposals({
    city,
    dumpDir,
    proposals,
    sources,
    only: listArg('source'),
  });
  await writeJson(resolve(dumpDir, 'check-report.json'), report);

  for (const result of report.results) {
    const counts = result.invalid_fields
      ? ` (${result.invalid_fields.before} → ${result.invalid_fields.after} invalid fields)`
      : '';
    console.log(`${result.status.padEnd(20)} ${result.source}${counts}`);
    for (const problem of result.problems ?? []) console.log(`  ! ${problem}`);
    for (const regression of result.regressions ?? []) console.log(`  - breaks ${regression}`);
    for (const fix of result.fixes ?? []) console.log(`  + fixes ${fix}`);
  }

  if (getArg('apply')) {
    const overridesPath = overridePathForCity(city);
    const { overrides, applied } = mergeIntoOverrides(
      (await readJson(overridesPath, null)) ?? { sources: {} },
      report.results,
    );
    if (applied.length) await writeJson(overridesPath, overrides);
    console.log(
      applied.length
        ? `Applied selectors for ${applied.join(', ')} to ${overridesPath}`
        : 'Nothing to apply',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
