import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  classifyFetchResult,
  classifySourceOutcome,
  createCrawlDiagnostics,
  extractGenericDetailUrls,
  extractGenericEvent,
  hasExtractedImage,
  recordFetchedPage,
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
  assert.equal(hasExtractedImage(event), true);
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
