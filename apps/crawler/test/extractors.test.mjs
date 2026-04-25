import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  classifyFetchResult,
  classifySourceOutcome,
  createCrawlDiagnostics,
  detailUrlExtractors,
  eventExtractors,
  extractChushinDetailUrls,
  extractChushinEvent,
  extractGenericDetailUrls,
  extractGenericEvent,
  extractRakuMuseumEvent,
  extractSenOkuEvent,
  getSourceSpecificSkipReason,
  hasExtractedImage,
  normalizeEventImagesForSource,
  parseImageDimensionsFromBytes,
  recordFetchedPage,
  sourceContextLoaders,
  sourceSpecificSkipMatchers,
} from "../src/run-once.mjs";

const fixturesRoot = resolve(import.meta.dirname, "fixtures");

test("generic detail extraction prefers event and exhibition URLs", async () => {
  const listingHtml = await readFile(resolve(fixturesRoot, "generic-listing.html"), "utf8");
  const source = {
    allowed_domains: ["example.test"],
    event_page_patterns: ["/events/", "/exhibitions/"],
  };

  const urls = extractGenericDetailUrls(listingHtml, "https://example.test/events/", source, 4);

  assert.deepEqual(urls, [
    "https://example.test/events/spring-show-2026/",
    "https://example.test/exhibitions/2026/quiet-forms/",
  ]);
});

test("generic event extraction returns title, dates, and images", async () => {
  const detailHtml = await readFile(resolve(fixturesRoot, "generic-detail.html"), "utf8");
  const source = {
    name: "Example Gallery",
    source_type: "gallery",
    source_categories: ["art"],
  };

  const event = extractGenericEvent(detailHtml, source, "https://example.test/exhibitions/2026/quiet-forms/");

  assert.equal(event.title, "Quiet Forms");
  assert.equal(event.start_date, "2026-04-12");
  assert.equal(event.end_date, "2026-05-31");
  assert.equal(event.primary_image_url, "https://example.test/images/install-view.jpg");
  assert.equal(event.image_urls.includes("https://example.test/media/quiet-forms.jpg"), true);
  assert.equal(event.image_urls.includes("https://example.test/images/venue-mark.jpg"), false);
  assert.equal(event.image_urls.includes("https://example.test/media/event-strip-300x80.jpg"), false);
  assert.equal(event.image_urls.includes("https://example.test/media/cdn-thumb.jpg?width=240&height=80"), false);
  assert.equal(event.image_urls.includes("https://example.test/images/program-thumb.jpg"), false);
  assert.equal(hasExtractedImage(event), true);
});

test("source-specific skip rule drops MOMAK calendar pages", () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "momak" },
      { title: "Calendar of Events" }
    ),
    "title contains calendar"
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "momak" },
      { title: "Antonio Fontanesi: Transcending Landscape" }
    ),
    null
  );
});

test("Raku Museum extraction keeps only the first image", async () => {
  const detailHtml = await readFile(resolve(fixturesRoot, "generic-detail.html"), "utf8");
  const source = {
    name: "Raku Museum",
    source_type: "museum",
    source_categories: ["art", "museum"],
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    "https://www.raku-yaki.or.jp/e/museum/exhibition/forthcoming_exhibitions.html"
  );

  assert.equal(event.primary_image_url, "https://www.raku-yaki.or.jp/images/install-view.jpg");
  assert.deepEqual(event.image_urls, ["https://www.raku-yaki.or.jp/images/install-view.jpg"]);
});

test("Sen-Oku extraction removes the trailing ad image", () => {
  const detailHtml = `
    <meta property="og:image" content="https://sen-oku.or.jp/wp-content/uploads/hero.jpg">
    <div class="catchArea wrap">
      <div class="catch">Special Exhibition</div>
      <div class="dataSetList"></div>
    </div>
    <span class="num">2026.04.01</span>
    <span class="num">2026.05.31</span>
    <div class="spot">Sen-Oku Hakukokan Museum Kyoto</div>
    <div class="leadArea">
      <p class="copy">An exhibition drawn from the museum collection.</p>
    </div>
    <img src="https://sen-oku.or.jp/wp-content/uploads/detail-1.jpg">
    <img src="https://sen-oku.or.jp/wp-content/uploads/detail-2.jpg">
    <img src="https://sen-oku.or.jp/wp-content/uploads/detail-3.jpg">
  `;
  const source = {
    name: "Sen-Oku Hakukokan Museum",
    source_type: "museum",
    source_categories: ["art", "museum"],
  };

  const event = extractSenOkuEvent(
    detailHtml,
    source,
    "https://sen-oku.or.jp/program/202604_special/"
  );

  assert.equal(event.primary_image_url, "https://sen-oku.or.jp/wp-content/uploads/hero.jpg");
  assert.deepEqual(event.image_urls, [
    "https://sen-oku.or.jp/wp-content/uploads/hero.jpg",
    "https://sen-oku.or.jp/wp-content/uploads/detail-1.jpg",
    "https://sen-oku.or.jp/wp-content/uploads/detail-2.jpg",
  ]);
});

test("image normalization caps stored images and probes offender source dimensions", async () => {
  const diagnostics = createCrawlDiagnostics();
  const source = {
    measure_image_dimensions: true,
  };
  const event = {
    primary_image_url: "https://example.test/icon.jpg",
    image_urls: [
      "https://example.test/icon.jpg",
      "https://example.test/hero.jpg",
      "https://example.test/gallery-1.jpg",
      "https://example.test/gallery-2.jpg",
      "https://example.test/gallery-3.jpg",
    ],
  };

  const normalized = await normalizeEventImagesForSource(event, source, {
    diagnostics,
    fetchImageDimensionsFn: async (url) =>
      url.includes("icon")
        ? { width: 320, height: 72 }
        : { width: 1200, height: 800 },
  });

  assert.deepEqual(normalized.image_urls, [
    "https://example.test/hero.jpg",
    "https://example.test/gallery-1.jpg",
    "https://example.test/gallery-2.jpg",
    "https://example.test/gallery-3.jpg",
  ]);
  assert.equal(normalized.primary_image_url, "https://example.test/hero.jpg");
  assert.equal(diagnostics.image_dimension_probe_count, 5);
  assert.equal(diagnostics.image_dimension_probe_rejected_count, 1);
});

test("image normalization caps non-offender event images at five", async () => {
  const normalized = await normalizeEventImagesForSource({
    primary_image_url: "https://example.test/hero.jpg",
    image_urls: [
      "https://example.test/hero.jpg",
      "https://example.test/gallery-1.jpg",
      "https://example.test/gallery-2.jpg",
      "https://example.test/gallery-3.jpg",
      "https://example.test/gallery-4.jpg",
    ],
  }, {});

  assert.deepEqual(normalized.image_urls, [
    "https://example.test/hero.jpg",
    "https://example.test/gallery-1.jpg",
    "https://example.test/gallery-2.jpg",
    "https://example.test/gallery-3.jpg",
    "https://example.test/gallery-4.jpg",
  ]);
});

test("image byte parser reads common remote image dimensions", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAIAAAD2HxkiAAAAAklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUrIIBAAAMAAGQvR6bAAAAAElFTkSuQmCC",
    "base64"
  );

  assert.deepEqual(parseImageDimensionsFromBytes(png, "image/png"), {
    width: 300,
    height: 80,
  });
});

test("Chushin extraction treats exh sections as individual events", () => {
  const listingHtml = `
    <section id="">
      <a href="/bijyutu/access/">施設案内</a>
    </section>
    <section class="" id="exh073">
      <h2 class="cate_heading02">山本容子版画展　物語をつつむ</h2>
      <div class="bijyutu_flex">
        <img src="/bijyutu/exhibition/images/img_bijyutu_exhibition_73.jpg" alt="">
        <div class="bijyutu_text">
          <h3 class="cate_heading03">2026年5月12日（火）～<br>6月26日（金）<br>休館日：月曜日</h3>
          <p>都会的で洗練された色彩で、独自の銅版画の世界を確立する山本容子氏の展覧会を開催いたします。</p>
        </div>
      </div>
    </section>
    <section class="" id="exh072">
      <h2 class="cate_heading02">西野康造　<ruby>空<rt>そら</rt>・<rt>・</rt>宙<rt>そら</ruby><br><span class="label close">終了</span></h2>
      <h3 class="cate_heading03">2026年2月10日（火）～3月19日（木）</h3>
      <p>彫刻家 西野康造氏の展覧会を開催いたします。</p>
    </section>
  `;
  const source = {
    name: "Chushin Museum of Art",
    source_type: "museum",
    source_categories: ["art", "museum"],
  };

  const urls = extractChushinDetailUrls(
    listingHtml,
    "https://www.chushin.co.jp/bijyutu/exhibition/index.html"
  );

  assert.deepEqual(urls, [
    "https://www.chushin.co.jp/bijyutu/exhibition/index.html#exh073",
    "https://www.chushin.co.jp/bijyutu/exhibition/index.html#exh072",
  ]);

  const event = extractChushinEvent(listingHtml, source, urls[0]);

  assert.equal(event.title, "山本容子版画展 物語をつつむ");
  assert.equal(event.start_date, "2026-05-12");
  assert.equal(event.end_date, "2026-06-26");
  assert.equal(event.primary_image_url, "https://www.chushin.co.jp/bijyutu/exhibition/images/img_bijyutu_exhibition_73.jpg");
  assert.equal(event.source_url, urls[0]);

  const rubyEvent = extractChushinEvent(listingHtml, source, urls[1]);
  assert.equal(rubyEvent.title, "西野康造 空・宙");
});

test("fetch classification distinguishes bot challenges from renderable JS shells", () => {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });

  assert.equal(
    classifyFetchResult({
      response: new Response("<title>Just a moment...</title><p>Checking your browser</p>", { status: 200, headers }),
      html: "<title>Just a moment...</title><p>Checking your browser</p>",
    }),
    "bot_challenge"
  );

  assert.equal(
    classifyFetchResult({
      response: new Response("<div id=\"root\"></div><script src=\"/app.js\"></script>", { status: 200, headers }),
      html: "<div id=\"root\"></div><script src=\"/app.js\"></script>",
    }),
    "js_shell"
  );
});

test("diagnostics and source outcome summarize crawl health", () => {
  const diagnostics = createCrawlDiagnostics({
    CRAWL4AI_MAX_RENDERS_PER_SOURCE: "3",
  });

  recordFetchedPage(diagnostics, {
    metadata: {
      fetched_via: "fetch",
      fetch_classification: "js_shell",
      fetch_attempts: 2,
    },
  });
  recordFetchedPage(diagnostics, {
    metadata: {
      fetched_via: "crawl4ai",
    },
  });

  assert.equal(diagnostics.fetched_static_count, 1);
  assert.equal(diagnostics.fetched_crawl4ai_count, 1);
  assert.equal(diagnostics.retry_count, 1);
  assert.equal(diagnostics.js_shell_count, 1);
  assert.equal(diagnostics.crawl4ai_render_limit, 3);

  assert.equal(
    classifySourceOutcome({
      detailUrls: ["https://example.test/events/a/"],
      savedEvents: [],
      skippedEvents: [{ reason: "missing image" }],
      diagnostics: { ...diagnostics, missing_image_count: 1 },
      usedGenericExtractor: true,
    }),
    "source_needs_review"
  );
});

test("source-specific crawler registries only reference configured source slugs", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const configuredSlugs = new Set(payload.sources.map((source) => source.slug));
  const registryEntries = [
    ["detailUrlExtractors", Object.keys(detailUrlExtractors)],
    ["eventExtractors", Object.keys(eventExtractors)],
    ["sourceContextLoaders", Object.keys(sourceContextLoaders)],
    ["sourceSpecificSkipMatchers", Object.keys(sourceSpecificSkipMatchers)],
  ];

  for (const [label, slugs] of registryEntries) {
    const unknownSlugs = slugs.filter((slug) => !configuredSlugs.has(slug));
    assert.deepEqual(
      unknownSlugs,
      [],
      `${label} contains unknown source slugs: ${unknownSlugs.join(", ")}`
    );
  }
});
