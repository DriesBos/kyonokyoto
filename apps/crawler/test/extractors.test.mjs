import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assignEventCoordinates,
  classifyFetchResult,
  classifySourceOutcome,
  createCrawlDiagnostics,
  buildEventTranslationPayload,
  buildMachineTranslatedEvent,
  detailUrlExtractors,
  eventExtractors,
  extractChushinDetailUrls,
  extractChushinEvent,
  extractGenericDetailUrls,
  extractGenericEvent,
  extractLocaleUrlsFromHtml,
  extractRakuMuseumEvent,
  extractSenOkuEvent,
  getSourceSpecificSkipReason,
  hasExtractedImage,
  normalizeEventImagesForSource,
  parseImageDimensionsFromBytes,
  parseKyoceraDateRange,
  recordFetchedPage,
  sourceContextLoaders,
  sourceSpecificSkipMatchers,
  sourceHasNativeLocale,
  shouldMachineTranslateMissingLocales,
  sanitizePostgresJson,
  sanitizePostgresText,
  translateTextFields,
  withSourceLocaleConfig,
} from "../src/run-once.mjs";
import { buildCrawlQaReport } from "../src/crawl-qa.mjs";
import { validateSourceConfig } from "../../../data/sources/source-config.mjs";

const fixturesRoot = resolve(import.meta.dirname, "fixtures");

test("translation helper calls Google client with source and target locales", async () => {
  const calls = [];
  const fields = await translateTextFields(
    {
      GOOGLE_TRANSLATE_PROJECT_ID: "test-project",
      GOOGLE_TRANSLATE_LOCATION: "global",
      __translationClient: {
        async translateText(request) {
          calls.push(request);
          return [
            {
              translations: [
                { translatedText: "English title" },
                { translatedText: "English description" },
              ],
            },
          ];
        },
      },
    },
    {
      title: "日本語タイトル",
      description: "日本語説明",
      venue_name: null,
    },
    "ja",
    "en",
  );

  assert.deepEqual(fields, {
    title: "English title",
    description: "English description",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, "projects/test-project/locations/global");
  assert.equal(calls[0].sourceLanguageCode, "ja");
  assert.equal(calls[0].targetLanguageCode, "en");
  assert.deepEqual(calls[0].contents, ["日本語タイトル", "日本語説明"]);
});

test("translation helper returns null when Google project is not configured", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const fields = await translateTextFields({}, { title: "日本語タイトル" }, "ja", "en");
    assert.equal(fields, null);
  } finally {
    console.warn = originalWarn;
  }
});

test("machine translated event keeps source URL and required event fields", async () => {
  const translated = await buildMachineTranslatedEvent(
    {
      GOOGLE_TRANSLATE_PROJECT_ID: "test-project",
      __translationClient: {
        async translateText() {
          return [
            {
              translations: [
                { translatedText: "English title" },
                { translatedText: "English description" },
              ],
            },
          ];
        },
      },
    },
    {
      title: "日本語タイトル",
      description: "日本語説明",
      institution_name: "日本語施設",
      venue_name: "日本語会場",
      address_text: "日本語住所",
      date_text: "2026年1月1日",
      source_url: "https://example.test/ja/event",
    },
    "ja",
    "en",
  );

  assert.equal(translated.title, "English title");
  assert.equal(translated.description, "English description");
  assert.equal(translated.institution_name, "日本語施設");
  assert.equal(translated.venue_name, "日本語会場");
  assert.equal(translated.address_text, "日本語住所");
  assert.equal(translated.date_text, "2026年1月1日");
  assert.equal(translated.source_url, "https://example.test/ja/event");
});

test("event translation payload stores only localized public fields", () => {
  assert.deepEqual(
    buildEventTranslationPayload("event-1", "en", {
      title: "Title",
      description: "Description",
      institution_name: "Institution",
      venue_name: "Venue",
      address_text: "Address",
      date_text: "Dates",
      source_url: "https://example.test/event",
      primary_image_url: "https://example.test/image.jpg",
    }),
    {
      event_id: "event-1",
      locale: "en",
      title: "Title",
      description: "Description",
    },
  );
});

test("event coordinates prefer configured venue locations", () => {
  const event = assignEventCoordinates(
    {
      title: "Special exhibition",
      venue_name: "The Triangle",
      address_text: "Kyoto City KYOCERA Museum of Art",
    },
    {
      name: "Kyoto City KYOCERA Museum of Art",
      source_categories: ["museum"],
      address_text: "124 Okazaki Enshoji-cho, Sakyo-ku, Kyoto 606-8344 Japan",
      lat: 35,
      lng: 135,
      venue_locations: [
        {
          name: "The Triangle",
          match: ["The Triangle"],
          address_text: "The Triangle, Kyoto City KYOCERA Museum of Art",
          lat: 35.0123,
          lng: 135.7834,
        },
      ],
    },
  );

  assert.equal(event.lat, 35.0123);
  assert.equal(event.lng, 135.7834);
  assert.equal(event.institution_name, "Kyoto City KYOCERA Museum of Art");
  assert.equal(event.venue_name, "The Triangle");
  assert.equal(event.address_text, "The Triangle, Kyoto City KYOCERA Museum of Art");
  assert.deepEqual(event.categories, ["museum"]);
});

test("event coordinates fall back to source coordinates", () => {
  const event = assignEventCoordinates(
    {
      title: "Gallery exhibition",
      institution_name: "THE HEARTH KYOTO",
      venue_name: "Main gallery",
      address_text: "Scraped address",
    },
    {
      name: "The Terminal Kyoto",
      source_categories: ["gallery"],
      address_text: "424 Iwatoyama-cho, Shimogyo-ku, Kyoto 600-8445 Japan",
      directions_query: "The Terminal Kyoto, Kyoto",
      lat: "35.0007",
      lng: "135.7568",
      venue_locations: [
        {
          match: ["Other venue"],
          lat: 35.1,
          lng: 135.1,
        },
      ],
    },
  );

  assert.equal(event.lat, 35.0007);
  assert.equal(event.lng, 135.7568);
  assert.equal(event.institution_name, "The Terminal Kyoto");
  assert.equal(event.venue_name, "The Terminal Kyoto");
  assert.equal(event.address_text, "424 Iwatoyama-cho, Shimogyo-ku, Kyoto 600-8445 Japan");
  assert.equal(event.directions_query, "The Terminal Kyoto, Kyoto");
  assert.deepEqual(event.categories, ["gallery"]);
});

test("event coordinates stay null when source has no usable location", () => {
  const event = assignEventCoordinates(
    {
      title: "Remote exhibition",
      venue_name: "Unknown venue",
    },
    {}
  );

  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
});

test("Kyocera date parser reads Japanese date ranges", () => {
  assert.deepEqual(
    parseKyoceraDateRange("2026年9月19日-2026年12月20日"),
    {
      startDate: "2026-09-19",
      endDate: "2026-12-20",
      calendarStartsAt: "2026-09-19T10:00:00+09:00",
      calendarEndsAt: "2026-12-20T18:00:00+09:00",
    },
  );
});

test("Kyocera date parser reads slash date ranges", () => {
  assert.deepEqual(
    parseKyoceraDateRange("2027/10/2-2027/12/12"),
    {
      startDate: "2027-10-02",
      endDate: "2027-12-12",
      calendarStartsAt: "2027-10-02T10:00:00+09:00",
      calendarEndsAt: "2027-12-12T18:00:00+09:00",
    },
  );
});

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

test("generic detail extraction can use configured listing link selectors", () => {
  const listingHtml = `
    <main id="events">
      <a class="event-link" href="/events/selected/">Selected event</a>
      <a href="/about/">About</a>
    </main>
    <a class="event-link" href="/events/outside/">Outside selector</a>
  `;
  const source = {
    allowed_domains: ["example.test"],
    selectors: {
      listing_links: "#events a.event-link",
    },
  };

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, "https://example.test/events/", source, 4),
    ["https://example.test/events/selected/"],
  );
});

test("Kyocera detail extraction finds Japanese default URLs", () => {
  const extractKyoceraDetailUrls =
    detailUrlExtractors["kyoto-city-kyocera-museum-of-art"];
  const listingHtml = `
    <a href="/exhibition/20260310-20260517">Main exhibition</a>
    <a href="https://kyotocity-kyocera.museum/exhibition/20260707-20260720">Collection room</a>
  `;

  assert.deepEqual(
    extractKyoceraDetailUrls(
      listingHtml,
      "https://kyotocity-kyocera.museum/exhibition/",
    ),
    [
      "https://kyotocity-kyocera.museum/exhibition/20260310-20260517",
      "https://kyotocity-kyocera.museum/exhibition/20260707-20260720",
    ],
  );
});

test("Kyocera detail extraction finds English URLs", () => {
  const extractKyoceraDetailUrls =
    detailUrlExtractors["kyoto-city-kyocera-museum-of-art"];
  const listingHtml = `
    <a href="/en/exhibition/20260310-20260517">Main exhibition</a>
    <a href="https://kyotocity-kyocera.museum/en/exhibition/20260320-20260524">Special exhibition</a>
  `;

  assert.deepEqual(
    extractKyoceraDetailUrls(
      listingHtml,
      "https://kyotocity-kyocera.museum/en/exhibition/",
    ),
    [
      "https://kyotocity-kyocera.museum/en/exhibition/20260310-20260517",
      "https://kyotocity-kyocera.museum/en/exhibition/20260320-20260524",
    ],
  );
});

test("locale URL extraction finds alternate links in header and metadata", () => {
  const html = `
    <html>
      <head>
        <link rel="alternate" hreflang="ja" href="/ja/exhibitions/quiet-forms/">
      </head>
      <body>
        <nav>
          <a href="/en/exhibitions/quiet-forms/">English</a>
          <a href="/ja/exhibitions/quiet-forms/">日本語</a>
        </nav>
      </body>
    </html>
  `;

  assert.deepEqual(
    extractLocaleUrlsFromHtml(
      html,
      "https://example.test/en/exhibitions/quiet-forms/"
    ),
    {
      ja: "https://example.test/ja/exhibitions/quiet-forms/",
    }
  );
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

test("generic event extraction can use configured field selectors", () => {
  const detailHtml = `
    <article>
      <h1 class="event-title">Configured Title</h1>
      <p class="event-date">2026/04/12 - 2026/05/31</p>
      <div class="event-description"><p>Configured description with enough detail for the card.</p></div>
      <figure class="event-media"><img src="/images/configured.jpg" alt=""></figure>
    </article>
  `;
  const source = {
    name: "Example Gallery",
    source_type: "gallery",
    source_categories: ["gallery"],
    selectors: {
      title: ".event-title",
      date: ".event-date",
      description: ".event-description",
      images: ".event-media img",
    },
  };

  const event = extractGenericEvent(detailHtml, source, "https://example.test/exhibitions/configured/");

  assert.equal(event.title, "Configured Title");
  assert.equal(event.description, "Configured description with enough detail for the card.");
  assert.equal(event.start_date, "2026-04-12");
  assert.equal(event.end_date, "2026-05-31");
  assert.equal(event.primary_image_url, "https://example.test/images/configured.jpg");
});

test("source capabilities declare native locales and machine translation behavior", () => {
  const source = {
    language: "ja",
    capabilities: {
      native_locales: ["ja"],
      machine_translate_missing_locales: false,
    },
  };

  assert.equal(sourceHasNativeLocale(source, "ja"), true);
  assert.equal(sourceHasNativeLocale(source, "en"), false);
  assert.equal(shouldMachineTranslateMissingLocales(source), false);
});

test("source config validator reports missing source truth", () => {
  assert.deepEqual(
    validateSourceConfig({
      slug: "draft-source",
      name: "Draft Source",
      capabilities: {
        native_locales: ["ja"],
      },
    }),
    [
      "draft-source: missing source_categories",
      "draft-source: missing lat/lng",
    ],
  );
});

test("crawl QA report summarizes saved events, missing translations, and diagnostics", () => {
  assert.deepEqual(
    buildCrawlQaReport({
      source: { slug: "example-gallery" },
      sourceOutcome: "source_ok",
      detailUrls: ["https://example.test/one", "https://example.test/two"],
      savedEvents: [
        { translations: ["ja", "en"] },
        { translations: ["ja"] },
      ],
      skippedEvents: [{ reason: "missing image" }],
      diagnostics: {
        fetched_static_count: 2,
        fetched_crawl4ai_count: 1,
        retry_count: 1,
        bot_challenge_count: 0,
        js_shell_count: 1,
        missing_image_count: 1,
        skipped_missing_date_count: 0,
        skipped_past_count: 0,
        skipped_old_count: 0,
        skipped_other_count: 0,
        crawl4ai_render_count: 1,
        crawl4ai_render_limit: 5,
        crawl4ai_render_skipped_count: 0,
      },
    }),
    {
      source: "example-gallery",
      outcome: "source_ok",
      detail_urls_found: 2,
      events_saved: 2,
      events_skipped: 1,
      missing_translations: { en: 1, ja: 0 },
      fetch: {
        static: 2,
        rendered: 1,
        retries: 1,
        bot_challenges: 0,
        js_shells: 1,
      },
      skips: {
        missing_image: 1,
        missing_date: 0,
        past: 0,
        old: 0,
        other: 0,
      },
      crawl4ai: {
        render_count: 1,
        render_limit: 5,
        render_skipped: 0,
      },
    },
  );
});

test("Postgres text sanitizer removes null bytes recursively", () => {
  assert.equal(sanitizePostgresText("a\u0000b"), "ab");
  assert.deepEqual(
    sanitizePostgresJson({
      title: "A\u0000B",
      nested: ["C\u0000D"],
    }),
    {
      title: "AB",
      nested: ["CD"],
    },
  );
});

test("source locale config applies localized source names", async () => {
  const detailHtml = await readFile(resolve(fixturesRoot, "generic-detail.html"), "utf8");
  const source = withSourceLocaleConfig(
    {
      name: "Kyoto Art Center",
      names: {
        ja: "京都芸術センター",
      },
      source_type: "art-center",
      source_categories: ["exhibition"],
    },
    "ja"
  );

  const event = extractGenericEvent(detailHtml, source, "https://example.test/exhibitions/2026/quiet-forms/");

  assert.equal(event.institution_name, "京都芸術センター");
  assert.equal(event.venue_name, "京都芸術センター");
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

  assert.equal(
    classifySourceOutcome({
      detailUrls: ["https://sibasi.jp/event/a/", "https://sibasi.jp/event/b/"],
      savedEvents: [],
      skippedEvents: [
        { reason: "past event" },
        { reason: "missing verifiable event date" },
      ],
      diagnostics: { skipped_past_count: 1, skipped_missing_date_count: 1 },
      sourceSlug: "sibasi",
    }),
    "source_no_current_events"
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
