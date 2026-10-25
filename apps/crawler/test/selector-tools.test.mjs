import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applySourceOverride } from '../../../data/sources/source-config.mjs';
import { selectElements } from '../src/run-once.mjs';
import { checkProposals, mergeIntoOverrides } from '../src/selectors-check.mjs';
import {
  condenseHtml,
  normalizeSelectorProposal,
  unsupportedSelectorReason,
  writeJson,
} from '../src/selector-tools.mjs';

function gallerySource() {
  return applySourceOverride({
    slug: 'quiet-gallery',
    name: 'Quiet Gallery',
    city: 'kyoto',
    language: 'en',
    taxonomy: { venue_category: ['gallery'], display_category: [], event_category: ['exhibition'] },
    base_url: 'https://gallery.example/',
    start_urls: ['https://gallery.example/exhibitions/'],
    allowed_domains: ['gallery.example'],
  });
}

const detailHtml = `<!doctype html><html lang="en"><head><title>Quiet Gallery</title></head>
<body><header><h1>Quiet Gallery</h1></header>
<main><div class="exhibition"><div class="ex-name">Paper Rivers</div>
<p class="ex-period">November 1, 2026 - December 20, 2026</p>
<p class="ex-text">Paper Rivers gathers large washi works and folded paper installations by artists
working between Kyoto and Kanazawa, shown together for the first time.</p>
<img class="ex-visual" src="/media/paper-rivers.jpg" width="1200" height="800" alt="Paper Rivers"></div>
</main></body></html>`;

async function dumpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'selectors-'));
  await writeJson(join(dir, 'quiet-gallery', 'pages.json'), [
    {
      kind: 'detail',
      url: 'https://gallery.example/exhibitions/paper-rivers/',
      file: 'detail-1.html',
    },
  ]);
  await writeFile(join(dir, 'quiet-gallery', 'detail-1.html'), detailHtml);
  return dir;
}

test('selector proposals reject syntax the crawler selector engine ignores', () => {
  assert.equal(unsupportedSelectorReason('main .ex-name'), null);
  assert.equal(unsupportedSelectorReason('img[src*="main:visual"]'), null);
  assert.match(unsupportedSelectorReason('main > h2'), /combinators/);
  assert.match(unsupportedSelectorReason('li:first-child a'), /pseudo/);

  const { selectors, problems } = normalizeSelectorProposal({
    title: ['.ex-name', ''],
    date: '.ex-period',
    venue: '.where',
  });
  assert.deepEqual(selectors, { title: '.ex-name', date: '.ex-period' });
  assert.deepEqual(problems, ['venue: unknown selector key']);
});

test('condensed HTML keeps selector hooks and drops noise', () => {
  const condensed = condenseHtml(
    '<head><script>track()</script><style>p{}</style><meta property="og:image" content="/og.jpg"><meta charset="utf-8"></head>' +
      '<div class="card" data-tracking="x" style="color:red"><img src="data:image/png;base64,AAAA"><!-- hi --><a href="/e/1">Go</a></div>',
  );

  assert.doesNotMatch(condensed, /track\(\)|p\{\}|data-tracking|style=|hi -->|charset/);
  assert.match(condensed, /<meta property="og:image" content="\/og.jpg">/);
  assert.match(condensed, /<div class="card">/);
  assert.match(condensed, /<img src="data:…">/);
  assert.match(condensed, /<a href="\/e\/1">Go<\/a>/);
});

test('selector check replays saved pages and only applies improvements', async () => {
  const dir = await dumpDir();
  const source = gallerySource();
  const report = await checkProposals({
    city: 'kyoto',
    dumpDir: dir,
    sources: [source],
    proposals: {
      sources: {
        'quiet-gallery': { selectors: { title: '.ex-name' } },
        'missing-source': { selectors: { title: 'h2' } },
      },
    },
  });
  const [result, missing] = report.results;

  assert.equal(missing.status, 'unknown_source');
  assert.equal(result.pages[0].values.title, 'Paper Rivers');
  assert.equal(result.pages[0].selector_matches.title, 1);
  assert.ok(result.invalid_fields.after <= result.invalid_fields.before);
  assert.deepEqual(result.regressions, []);

  const unsupported = await checkProposals({
    city: 'kyoto',
    dumpDir: dir,
    sources: [source],
    proposals: { sources: { 'quiet-gallery': { selectors: { title: 'main > div' } } } },
  });
  assert.equal(unsupported.results[0].status, 'unsupported_selector');

  const { overrides, applied } = mergeIntoOverrides(
    { description: 'x', sources: { 'quiet-gallery': { selectors: { date: '.old' } } } },
    [
      { source: 'quiet-gallery', status: 'improved', selectors: { title: '.ex-name' } },
      { source: 'other', status: 'regressed', selectors: { title: 'h2' } },
    ],
  );
  assert.deepEqual(applied, ['quiet-gallery']);
  assert.deepEqual(overrides.sources['quiet-gallery'].selectors, {
    date: '.old',
    title: '.ex-name',
  });
  assert.equal(overrides.sources.other, undefined);
});

test('selector engine keeps nested elements of the same tag inside their container', () => {
  const html =
    '<div id="current"><div class="head">Current</div><ul><li><a href="/e/1">One</a></li></ul></div>' +
    '<div id="past"><a href="/e/0">Zero</a></div>';

  assert.deepEqual(
    selectElements(html, '#current a').map((element) => element.match(/href="([^"]+)"/)[1]),
    ['/e/1'],
  );
});
