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
  isUsableNativeLocaleUrl,
  nativeLocaleEventMatchesCanonical,
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

test("generic date parsers read en dash date ranges", () => {
  const dottedEvent = extractGenericEvent(
    `
      <h1 class="event-title">Dotted Range</h1>
      <p class="event-date">2026.5.16 Sat.–2026.7.12 Sun.</p>
      <p class="event-description">Useful exhibition copy.</p>
      <img src="/uploads/range.jpg" alt="">
    `,
    {
      name: "Example Gallery",
      source_type: "gallery",
      source_categories: ["gallery"],
      selectors: {
        title: ".event-title",
        date: ".event-date",
        description: ".event-description",
      },
    },
    "https://example.test/archives/2026/range/",
  );
  const japaneseEvent = extractGenericEvent(
    `
      <h1 class="event-title">Japanese Range</h1>
      <p class="event-date">2026年5月16日（土）–2026年7月12日（日）</p>
      <p class="event-description">Useful exhibition copy.</p>
      <img src="/uploads/range-ja.jpg" alt="">
    `,
    {
      name: "Example Gallery",
      source_type: "gallery",
      source_categories: ["gallery"],
      selectors: {
        title: ".event-title",
        date: ".event-date",
        description: ".event-description",
      },
    },
    "https://example.test/archives/2026/range-ja/",
  );

  assert.equal(dottedEvent.start_date, "2026-05-16");
  assert.equal(dottedEvent.end_date, "2026-07-12");
  assert.equal(japaneseEvent.start_date, "2026-05-16");
  assert.equal(japaneseEvent.end_date, "2026-07-12");
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

test("generic listing selectors support common attribute filters", () => {
  const listingHtml = `
    <main>
      <section class="archive-current">
        <a href="/exhibitions/kyoto-show/overview/">Kyoto show</a>
        <a href="/exhibitions/osaka-show/overview/">Osaka show</a>
        <a href="/exhibitions/kyoto-show/artists/">Artists</a>
      </section>
      <section class="news-current">
        <a href="/exhibitions/news/overview/">News</a>
      </section>
    </main>
  `;
  const source = {
    allowed_domains: ["example.test"],
    selectors: {
      listing_links: '[class*="archive"] a[href*="/exhibitions/"][href$="/overview/"]',
    },
  };

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, "https://example.test/exhibitions/", source, 4),
    [
      "https://example.test/exhibitions/kyoto-show/overview/",
      "https://example.test/exhibitions/osaka-show/overview/",
    ],
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

test("Fukuda detail extraction reads only exhibition cards inside exArv", () => {
  const listingHtml = `
    <a href="https://fukuda-art-museum.jp/news">News</a>
    <section id="exArv">
      <article class="postbox">
        <a href="https://fukuda-art-museum.jp/exhibition/202512264487">
          <h2 class="title">若冲にトリハダ！　野菜もウリ！</h2>
        </a>
      </article>
      <article class="postbox">
        <a href="https://fukuda-art-museum.jp/exhibition/202604134657">
          <h2 class="title">幸せになりたい！　ー祈りの絵画ー</h2>
        </a>
      </article>
    </section>
    <a href="https://fukuda-art-museum.jp/exhibition-cat/past">Past</a>
  `;

  assert.deepEqual(
    detailUrlExtractors["fukuda-art-museum"](
      listingHtml,
      "https://fukuda-art-museum.jp/exhibition",
    ),
    [
      "https://fukuda-art-museum.jp/exhibition/202512264487",
      "https://fukuda-art-museum.jp/exhibition/202604134657",
    ],
  );
});

test("Fukuda event extraction uses exhibition overview dates", () => {
  const detailHtml = `
    <article class="post ex">
      <figure class="img">
        <div id="eyeVisual" style="background-image: url('https://fukuda-art-museum.jp/wp/wp-content/uploads/2025/12/fukubi_jyakuchu_torihada_banner_1226-03.jpg')"></div>
      </figure>
      <div class="postHead">
        <p class="date">2025年12月26日（金）</p>
        <h1 class="title">若冲にトリハダ！　野菜もウリ！</h1>
      </div>
      <div class="postBody">
        <p>京都・嵐山の福田美術館では企画展を開催します。</p>
        <h3>展覧会概要</h3>
        <table>
          <tr><th>タイトル</th><td>若冲にトリハダ！　野菜もウリ！</td></tr>
          <tr><th>会期</th><td><p>2026年4月25日（土）～　2026年 7月5日（日）<br>前期　2026年4月25日（土）～ 2026年6月1日（月）</p></td></tr>
        </table>
      </div>
    </article>
  `;
  const source = {
    name: "Fukuda Art Museum",
    source_type: "museum",
    source_categories: ["museum"],
    language: "ja",
  };

  const event = eventExtractors["fukuda-art-museum"](
    detailHtml,
    source,
    "https://fukuda-art-museum.jp/exhibition/202512264487",
  );

  assert.equal(event.title, "若冲にトリハダ！ 野菜もウリ！");
  assert.equal(event.date_text, "2026年4月25日（土）～ 2026年 7月5日（日）");
  assert.equal(event.start_date, "2026-04-25");
  assert.equal(event.end_date, "2026-07-05");
  assert.equal(
    event.primary_image_url,
    "https://fukuda-art-museum.jp/wp/wp-content/uploads/2025/12/fukubi_jyakuchu_torihada_banner_1226-03.jpg",
  );
});

test("Fukuda English event extraction parses overview date order", () => {
  const detailHtml = `
    <article class="post ex">
      <div class="postHead">
        <p class="date">December 11, 2025</p>
        <h1 class="title">Jakuchu: Prancing Feathers and Swelling Gourds</h1>
      </div>
      <div class="postBody">
        <p>Fukuda Art Museum holds the special exhibition.</p>
        <h3>Exhibition Overview</h3>
        <table>
          <tr><th>Title</th><td><p>Jakuchu: Prancing Feathers and Swelling Gourds</p></td></tr>
          <tr><th>Dates</th><td><p>April 25 (Sat.) 2026 &#8211; July 5 (Sun.) 2026<br>1st period: April 25 (Sat.) &#8211; June 1 (Mon.)</p></td></tr>
        </table>
      </div>
    </article>
  `;
  const source = {
    name: "Fukuda Art Museum",
    source_type: "museum",
    source_categories: ["museum"],
    language: "en",
  };

  const event = eventExtractors["fukuda-art-museum"](
    detailHtml,
    source,
    "https://fukuda-art-museum.jp/en/exhibition/202512111838",
  );

  assert.equal(event.title, "Jakuchu: Prancing Feathers and Swelling Gourds");
  assert.equal(event.date_text, "April 25 (Sat.) 2026 – July 5 (Sun.) 2026");
  assert.equal(event.start_date, "2026-04-25");
  assert.equal(event.end_date, "2026-07-05");
});

test("Kyoto National Museum extraction drops the first flyer image", () => {
  const detailHtml = `
    <h1><img src="/images/exhibitions/flyer.jpg" alt=""></h1>
    <dl>
      <dt>Exhibition Title</dt><dd><p>Special Exhibition</p></dd>
      <dt>Period</dt><dd><p>April 12 - May 31, 2026</p></dd>
      <dt>Venue</dt><dd><p>Kyoto National Museum</p></dd>
    </dl>
    <h2 class="titleBg gold large" id="Contents02">Description of Exhibition</h2>
    <p>Useful exhibition description for the event card.</p>
    <div class="imgPosition">
      <img src="/images/exhibitions/install-view.jpg" alt="">
      <img src="/images/exhibitions/detail.jpg" alt="">
    </div>
  `;
  const source = {
    name: "Kyoto National Museum",
    source_type: "museum",
    source_categories: ["museum"],
  };

  const event = eventExtractors["kyoto-national-museum"](
    detailHtml,
    source,
    "https://www.kyohaku.go.jp/eng/exhibitions/special/",
  );

  assert.deepEqual(event.image_urls, [
    "https://www.kyohaku.go.jp/images/exhibitions/install-view.jpg",
    "https://www.kyohaku.go.jp/images/exhibitions/detail.jpg",
  ]);
  assert.equal(event.primary_image_url, "https://www.kyohaku.go.jp/images/exhibitions/install-view.jpg");
});

test("Kyocera event extraction keeps images inside main post content only", () => {
  const event = eventExtractors["kyoto-city-kyocera-museum-of-art"](
    `
      <h1 class="exhibition_title">Kyocera Focus Exhibition</h1>
      <p class="exhibition_date">2026年9月19日-2026年12月20日</p>
      <p class="exhibition_venue">Venue [Main Building]</p>
      <img src="https://kyotocity-kyocera.museum/wp-content/uploads/flyer.jpg" alt="flyer">
      <main class="contMain cont_post">
        <h3 class="cont_heading">Inside main content</h3>
        <div class="tab_cont_inner cont_col2 post_catch">
          <div class="cont_desc">Body copy.</div>
        </div>
        <img src="https://kyotocity-kyocera.museum/wp-content/uploads/install-view.jpg" alt="">
      </main>
      <aside class="related">
        <img src="https://kyotocity-kyocera.museum/wp-content/uploads/related-event.jpg" alt="">
      </aside>
    `,
    {
      name: "Kyoto City KYOCERA Museum of Art",
      address_text: "124 Okazaki Enshoji-cho, Sakyo-ku, Kyoto",
    },
    "https://kyotocity-kyocera.museum/exhibition/20260919-20261220",
  );

  assert.deepEqual(event.image_urls, [
    "https://kyotocity-kyocera.museum/wp-content/uploads/install-view.jpg",
  ]);
  assert.equal(
    event.primary_image_url,
    "https://kyotocity-kyocera.museum/wp-content/uploads/install-view.jpg",
  );
});

test("Taka Ishii detail extraction keeps only Kyoto location events", () => {
  const listingHtml = `
    <section class="column">
      <a href="https://www.takaishiigallery.com/en/archives/43428/">Michael Anastassiades</a>
      <p>Dates: Jun 6 - Jul 4, 2026<br>Location: Taka Ishii Gallery Kyoto</p>
    </section>
    <section class="column">
      <a href="https://www.takaishiigallery.com/en/archives/43351/">Takuma Oue</a>
      <p>Dates: May 23 - Jun 28, 2026<br>Location: Taka Ishii Gallery Maebashi</p>
    </section>
    <section class="wrap01">
      <a href="https://www.takaishiigallery.com/en/archives/42707/">Martin Margiela</a>
      <p>Dates: Apr 17 - May 16, 2026<br>Location: Taka Ishii Gallery Kyoto</p>
    </section>
  `;

  assert.deepEqual(
    detailUrlExtractors["taka-ishii-gallery"](
      listingHtml,
      "https://www.takaishiigallery.com/en/exhibitions/kyoto-yada-cho/",
    ),
    [
      "https://www.takaishiigallery.com/en/archives/43428/",
      "https://www.takaishiigallery.com/en/archives/42707/",
    ],
  );
});

test("Taka Ishii event extraction uses heading02 detail title", () => {
  const detailHtml = `
    <h2 class="site-heading">EXHIBITIONS</h2>
    <section class="section01">
      <h2 class="heading02">Martin Margiela</h2>
      <p>Dates: Apr 17 – May 16, 2026<br>Location: Taka Ishii Gallery Kyoto</p>
      <p>Taka Ishii Gallery Kyoto is pleased to present this solo exhibition.</p>
      <img src="/en/wp-content/uploads/BARRIER-sculpture-mural-white_72dpi_1200px-675x900.jpg" alt="">
    </section>
  `;
  const source = {
    name: "Taka Ishii Gallery",
    source_type: "gallery",
    source_categories: ["gallery"],
  };

  const event = eventExtractors["taka-ishii-gallery"](
    detailHtml,
    source,
    "https://www.takaishiigallery.com/en/archives/42707/",
  );

  assert.equal(event.title, "Martin Margiela");
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

test("native locale URL validation rejects sitewide language roots for detail pages", () => {
  assert.equal(
    isUsableNativeLocaleUrl(
      "https://www.takaishiigallery.com/en/archives/42707/",
      "https://www.takaishiigallery.com/en",
    ),
    false,
  );
  assert.equal(
    isUsableNativeLocaleUrl(
      "https://example.test/ja/exhibitions/quiet-forms/",
      "https://example.test/en/exhibitions/quiet-forms/",
    ),
    true,
  );
});

test("native locale event validation rejects conflicting parsed dates", () => {
  assert.equal(
    nativeLocaleEventMatchesCanonical(
      { start_date: "2026-04-17", end_date: "2026-05-16" },
      { start_date: "2026-06-06", end_date: "2026-07-04" },
    ),
    false,
  );
  assert.equal(
    nativeLocaleEventMatchesCanonical(
      { start_date: "2026-04-17", end_date: "2026-05-16" },
      { start_date: "2026-04-17", end_date: "2026-05-16" },
    ),
    true,
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

test("generic event extraction ignores common site chrome images", () => {
  const source = {
    name: "Oyamazaki Villa Museum",
    source_type: "museum",
    address_text: "5-3 Zenihara, Oyamazaki-cho, Kyoto",
  };
  const event = extractGenericEvent(
    `
      <main>
        <h1>Future exhibition without image</h1>
        <time>September 19 - December 6, 2026</time>
        <p>Details will be announced later.</p>
      </main>
      <img src="/assets/img/common/logo.png" alt="logo">
      <img src="/assets/img/layout/menu_about-01.png" alt="">
      <img src="/assets/img/icon/facebook.svg" alt="">
    `,
    source,
    "https://www.asahigroup-oyamazaki.com/english/exhibition/future/",
  );

  assert.deepEqual(event.image_urls, []);
  assert.equal(event.primary_image_url, null);
  assert.equal(hasExtractedImage(event), false);
});

test("generic event extraction can ignore source og images", () => {
  const source = {
    slug: "artro",
    name: "Artro",
    source_type: "gallery",
    skip_og_image: true,
    selectors: {
      images: "main.main img",
    },
  };
  const event = extractGenericEvent(
    `
      <meta property="og:image" content="https://artro.jp/uploads/site-card.jpg">
      <article>
        <img src="/uploads/sidebar-card.jpg" width="900" height="600" alt="">
      </article>
      <article>
        <h1>Gallery-room exhibition</h1>
        <time>April 12 - May 31, 2026</time>
        <p>Useful exhibition copy.</p>
      </article>
      <main class="main">
        <img src="/uploads/install-view.jpg" width="900" height="600" alt="">
      </main>
    `,
    source,
    "https://artro.jp/exhibition/gallery-room/",
  );

  assert.deepEqual(event.image_urls, [
    "https://artro.jp/uploads/install-view.jpg",
  ]);
  assert.equal(event.primary_image_url, "https://artro.jp/uploads/install-view.jpg");
});

test("Artro listing extraction follows exhibition card links", () => {
  const source = {
    slug: "artro",
    allowed_domains: ["artro.jp"],
    event_page_patterns: ["/exhibition/"],
    selectors: {
      listing_links: ".section__colImageSingle a",
    },
  };
  const listingHtml = `
    <ul class="stateNavi">
      <li><a href="/exhibition/?state=before">Upcoming</a></li>
      <li><a href="/exhibition/?state=end">Past</a></li>
    </ul>
    <div class="section__colImageSingle">
      <a href="https://artro.jp/exhibition/ai-makita/">
        <img data-src="https://artro.jp/cms_wp/wp-content/uploads/2026/04/P1155587-scaled.jpg">
      </a>
    </div>
  `;

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, "https://artro.jp/exhibition/?state=before", source, 8),
    ["https://artro.jp/exhibition/ai-makita/"],
  );
  assert.deepEqual(
    extractGenericDetailUrls(
      '<a href="/exhibition/?state=before">Upcoming</a><a href="/news/">News</a>',
      "https://artro.jp/exhibition/",
      source,
      8,
    ),
    [],
  );
});

test("Artro event extraction reads main visual event fields", () => {
  const detailHtml = `
    <div class="mainVisual__info">
      <h2 class="mainVisual__infoTitle">
        <span>AI MAKITA 牧田愛</span>
        <span>First Shadows, Then Reflections, Then the Things Themselves</span>
      </h2>
      <p class="mainVisual__infoDate"><time>6 JUNE - 5 JULY 2026</time></p>
    </div>
    <div class="mainVisual__image">
      <img src="https://artro.jp/cms_wp/wp-content/uploads/2026/04/P1155587-scaled.jpg" alt="">
    </div>
    <main id="main">
      <p>ARTRO is pleased to present Ai Makita's solo exhibition with enough detail to become useful card copy for the crawler output.</p>
    </main>
  `;
  const event = eventExtractors.artro(detailHtml, { name: "Artro", address_text: "Kyoto" }, "https://artro.jp/exhibition/ai-makita/");

  assert.equal(event.title, "First Shadows, Then Reflections, Then the Things Themselves");
  assert.equal(event.start_date, "2026-06-06");
  assert.equal(event.end_date, "2026-07-05");
  assert.equal(event.primary_image_url, "https://artro.jp/cms_wp/wp-content/uploads/2026/04/P1155587-scaled.jpg");
  assert.equal(event.metadata.artist, "AI MAKITA 牧田愛");
});

test("HOSOO event extraction keeps theme exhibition slides", () => {
  const detailHtml = `
    <div class="c-title"><h3 class="title">Theaster Gates: Glorious Robe | HOSOO GALLERY</h3></div>
    <dl>
      <dt class="term">Dates</dt><dd class="desc">11 April - 30 August 2026</dd>
      <dt class="term">Hours</dt><dd class="desc">10:30 - 18:00</dd>
      <dt class="term">Venue</dt><dd class="desc">HOSOO GALLERY</dd>
    </dl>
    <p class="cmt">Useful exhibition copy for HOSOO current exhibition.</p>
    <img src="https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/slide_01.jpg" width="1000" height="577">
    <img src="https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/profile_theastergates.jpg" width="145" height="203">
  `;
  const event = eventExtractors["hosoo-gallery"](
    detailHtml,
    { name: "HOSOO GALLERY", address_text: "Kyoto" },
    "https://www.hosoogallery.jp/en/exhibitions/glorious-robe/",
  );

  assert.equal(event.title, "Theaster Gates: Glorious Robe");
  assert.equal(event.start_date, "2026-04-11");
  assert.equal(event.end_date, "2026-08-30");
  assert.equal(
    event.primary_image_url,
    "https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/slide_01.jpg",
  );
  assert.deepEqual(event.image_urls, [
    "https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/slide_01.jpg",
  ]);
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

test("Oyamazaki extraction uses article metadata and skips flyer image", () => {
  const detailHtml = `
    <div class="p-exhibitionArticle">
      <div class="p-exhibitionArticle_banner">
        <img src="/uploads/2026/01/22/flyer.jpg" alt="">
      </div>
      <div class="p-exhibitionArticle_meta">
        <div class="p-news">
          <h1 class="p-news_title"><span>Resonance: Kanjiro Kawai x Shoji Hamada</span></h1>
          <div class="p-news_date">Friday, March 20 to Sunday, September 6, 2026 10:00 a.m. to 5:00 p.m.</div>
        </div>
      </div>
      <div class="p-exhibitionArticle_text">
        <p>Tamesaburo Yamamoto enthusiastically supported the mingei movement.</p>
      </div>
    </div>
    <section class="p-exhibitionArticle p-exhibitionArticle-sub">
      <div class="p-kurodaCard_pic"><img src="/english/uploads/2026/01/22/work-01.jpg" alt=""></div>
      <div class="p-kurodaCard_pic"><img src="/english/uploads/2026/01/22/work-02.jpg" alt=""></div>
    </section>
  `;
  const source = {
    name: "Oyamazaki Villa Museum",
    source_type: "museum",
    source_categories: ["museum"],
    selectors: {
      title: ".p-news_title",
      date: ".p-news_date",
      description: ".p-exhibitionArticle_text",
      images: ".p-exhibitionArticle img",
    },
  };

  const event = eventExtractors["oyamazaki-villa-museum"](
    detailHtml,
    source,
    "https://www.asahigroup-oyamazaki.com/english/exhibition/kawai-hamada/",
  );

  assert.equal(event.title, "Resonance: Kanjiro Kawai x Shoji Hamada");
  assert.equal(event.start_date, "2026-03-20");
  assert.equal(event.end_date, "2026-09-06");
  assert.deepEqual(event.image_urls, [
    "https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-01.jpg",
    "https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-02.jpg",
  ]);
  assert.equal(
    event.primary_image_url,
    "https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-01.jpg",
  );

  const japaneseEvent = eventExtractors["oyamazaki-villa-museum"](
    detailHtml.replace(
      "Friday, March 20 to Sunday, September 6, 2026 10:00 a.m. to 5:00 p.m.",
      "2026年3月20日(金・祝)－9月6日(日)",
    ),
    source,
    "https://www.asahigroup-oyamazaki.com/exhibition/kawai-hamada/",
  );

  assert.equal(japaneseEvent.start_date, "2026-03-20");
  assert.equal(japaneseEvent.end_date, "2026-09-06");
});

test("Baiken event extraction cleans Japanese title dates and infers year", () => {
  const source = {
    name: "Gallery Baiken",
    source_type: "gallery",
    source_categories: ["gallery"],
    address_text: "682 Takenoko-cho, Nakagyo-ku, Kyoto 604-8153 Japan",
    lat: 35.004873,
    lng: 135.759387,
    selectors: {
      title: ".post-title",
      date: ".field-date",
      description: ".des-box",
      images: ".detail-content img",
    },
  };
  const detailHtml = `
    <meta property="article:published_time" content="2026-04-16T08:29:50+00:00" />
    <div class="detail-content">
      <div class="detail-box">
        <p class="post-title">♢♢懸想の眸♢♢<br>5月9日(土)～16日(土)</p>
        <div class="field-date"></div>
        <div class="des-box"><p>出展作家と掲載作品の案内です。会場で作品をご覧いただけます。</p></div>
      </div>
      <img src="https://baiken.jp/manage/wp-content/uploads/exhibition/2026/04/main.jpg" alt="">
    </div>
  `;

  const event = eventExtractors["gallery-baiken"](
    detailHtml,
    source,
    "https://baiken.jp/exhibition/%e2%97%a4%e6%87%b8%e6%83%b3%e3%81%ae%e7%9c%b8%e2%97%a2-5%e6%9c%889%e6%97%a5%e5%9c%9f%ef%bd%9e16%e6%97%a5%e5%9c%9f/",
  );

  assert.equal(event.title, "♢♢懸想の眸♢♢");
  assert.equal(event.start_date, "2026-05-09");
  assert.equal(event.end_date, "2026-05-16");
  assert.equal(event.primary_image_url, "https://baiken.jp/manage/wp-content/uploads/exhibition/2026/04/main.jpg");
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

test("source config includes Imura Art exhibition tabs", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "imura-art");

  assert.equal(source?.name, "Imura Art");
  assert.equal(source?.language, "en");
  assert.deepEqual(source?.start_urls, [
    "https://www.imuraart.com/exhibition/current.html",
    "https://www.imuraart.com/exhibition/future.html",
  ]);
  assert.equal(source?.selectors?.listing_links, ".content a.c-card");
  assert.equal(source?.crawl_hints?.requires_render, true);
  assert.deepEqual(source?.locales?.en?.start_urls, source?.start_urls);
});

test("source config includes Purple Purple with Japanese default", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "purple-purple");

  assert.equal(source?.name, "Purple Purple");
  assert.equal(source?.language, "ja");
  assert.deepEqual(source?.start_urls, ["https://purple-purple.com/exhibition/"]);
  assert.equal(source?.selectors?.listing_links, "#exhibition .ind_in a");
  assert.equal(source?.locales?.ja?.start_urls?.[0], "https://purple-purple.com/exhibition/");
  assert.equal(source?.locales?.en?.start_urls?.[0], "https://purple-purple.com/en/exhibition/");
  assert.match(source?.notes ?? "", /English top link is https:\/\/purple-purple\.com\/en\//);
});

test("source config includes KyotoBa gallery events with Japanese default", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "kyotoba");

  assert.equal(source?.name, "KyotoBa");
  assert.equal(source?.language, "ja");
  assert.deepEqual(source?.start_urls, ["https://kyoto-ba.jp/gallery/"]);
  assert.equal(source?.selectors?.listing_links, ".mec-event-title a");
  assert.equal(source?.selectors?.title, ".mec-single-title");
  assert.equal(source?.locales?.ja?.start_urls?.[0], "https://kyoto-ba.jp/gallery/");
  assert.match(source?.notes ?? "", /Gallery events are listed on \/gallery\//);
});

test("source config includes Sokyo Kyoto location exhibitions", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "sokyo-kyoto");

  assert.equal(source?.name, "Sokyo Kyoto");
  assert.equal(source?.language, "ja");
  assert.deepEqual(source?.start_urls, ["https://sokyogallery.com/exhibitions/location/6/"]);
  assert.equal(
    source?.selectors?.listing_links,
    '.records_list a[href*="/exhibitions/"][href$="/overview/"]',
  );
  assert.equal(source?.locales?.ja?.start_urls?.[0], "https://sokyogallery.com/exhibitions/location/6/");
  assert.equal(
    source?.locales?.en?.start_urls?.[0],
    "https://sokyogallery.com/en/exhibitions/location/6/",
  );
  assert.match(source?.notes ?? "", /Only the Kyoto SOKYO location/);
});

test("source config follows Kuramonzen detail pages for per-event fields", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "kuramonzen");
  const listingHtml = `
    <main>
      <section class="ai-blog-archive-aqllqdzy2thdfng9qwaigenblocke36ebc8dyangx">
        <a href="/blogs/exhibitions/2026-solo-exhibition" class="ai-blog-archive-hero-article-aqllqdzy2thdfng9qwaigenblocke36ebc8dyangx">Solo</a>
        <a href="/blogs/exhibitions/nomura-ko" class="ai-blog-archive-article-aqllqdzy2thdfng9qwaigenblocke36ebc8dyangx">Nomura</a>
        <a href="/blogs/exhibitions">Archive</a>
      </section>
    </main>
  `;
  const detailHtml = `
    <article class="article-template">
      <div class="article-template__hero-container">
        <img src="//kuramonzen.com/cdn/shop/articles/nomura.jpg?v=1776495202" alt="">
      </div>
      <h1 class="article-template__title">野村 耕 -Nomura Ko || SCREAMING LOTS OF DIFFERENT SONGS</h1>
      <span><time datetime="2026-02-03T03:06:26Z">February 3, 2026</time></span>
      <div class="article-template__content page-width page-width--narrow rte">
        <h3>Collection Exhibition 2026</h3>
        <p><strong>2026.02.28 - 06.01</strong></p>
        <p>This exhibition traces the creative trajectory of Nomura Ko through postwar Japanese art.</p>
        <p><img src="https://cdn.shopify.com/s/files/1/0658/7472/3063/files/work.jpg?v=1" alt=""></p>
      </div>
    </article>
    <section class="blog">
      <h2>Others exhibitions</h2>
      <a href="/blogs/exhibitions/2026-solo-exhibition">Solo exhibition</a>
      <p><strong>2026.04.18 - 06.01</strong></p>
      <img src="//kuramonzen.com/cdn/shop/articles/related.jpg?v=1" alt="">
    </section>
  `;

  assert.equal(source?.language, "en");
  assert.deepEqual(source?.locales?.ja?.start_urls, ["https://kuramonzen.com/ja/blogs/exhibitions"]);
  assert.deepEqual(source?.locales?.en?.start_urls, ["https://kuramonzen.com/blogs/exhibitions"]);
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, "https://kuramonzen.com/blogs/exhibitions", source, 4),
    [
      "https://kuramonzen.com/blogs/exhibitions/2026-solo-exhibition",
      "https://kuramonzen.com/blogs/exhibitions/nomura-ko",
    ],
  );

  const event = extractGenericEvent(
    detailHtml,
    source,
    "https://kuramonzen.com/blogs/exhibitions/nomura-ko",
  );

  assert.equal(event.title, "野村 耕 -Nomura Ko || SCREAMING LOTS OF DIFFERENT SONGS");
  assert.equal(event.date_text, "2026.02.28 - 06.01");
  assert.equal(event.start_date, "2026-02-28");
  assert.equal(event.end_date, "2026-06-01");
  assert.equal(
    event.primary_image_url,
    "https://kuramonzen.com/cdn/shop/articles/nomura.jpg?v=1776495202",
  );
  assert.doesNotMatch(event.description, /Others exhibitions/);
  assert.deepEqual(event.image_urls, [
    "https://kuramonzen.com/cdn/shop/articles/nomura.jpg?v=1776495202",
    "https://cdn.shopify.com/s/files/1/0658/7472/3063/files/work.jpg?v=1",
  ]);
});

test("source config keeps MTK exhibition links in listing order", async () => {
  const payload = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../../data/sources/kyoto-sources.json"), "utf8")
  );
  const source = payload.sources.find((item) => item.slug === "mtk");
  const listingHtml = `
    <ul class="ex__list">
      <li><a href="https://mtkcontemporaryart.com/exhibition/paths/">Paths</a></li>
      <li><a href="https://mtkcontemporaryart.com/exhibition/it_takes_two/">It Takes Two</a></li>
    </ul>
    <div class="pagination"><a href="https://mtkcontemporaryart.com/exhibition/page/2/">2</a></div>
  `;

  assert.equal(source?.selectors?.listing_links, ".ex__list a");
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, "https://mtkcontemporaryart.com/exhibition/", source, 8),
    [
      "https://mtkcontemporaryart.com/exhibition/paths/",
      "https://mtkcontemporaryart.com/exhibition/it_takes_two/",
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

test("source-specific skip rule drops Kyocera Collection Room pages", () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "kyoto-city-kyocera-museum-of-art" },
      { title: "Collection Room: Spring Collection" }
    ),
    "title contains Collection Room"
  );
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "kyoto-city-kyocera-museum-of-art" },
      { title: "［2026春期］コレクションルーム　特集「没後20年　井田照一」" }
    ),
    "title contains Collection Room"
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "kyoto-city-kyocera-museum-of-art" },
      { title: "Special Exhibition" }
    ),
    null
  );
});

test("Kankakari extraction parses exhibition periods and cleans title dates", () => {
  const source = {
    name: "Kankakari",
    source_type: "gallery",
    source_categories: ["gallery", "craft"],
    address_text: "15 Murasakino Shimotsukiyama-cho, Kita-ku, Kyoto Japan",
  };
  const gakuEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Gaku Nakazawa exhibition 4/4-19">
      <meta property="og:description" content="『中沢学 個展』 2026. 4. 4 sat - 19 sun 13:00-18:00 水曜休">
      <meta property="article:published_time" content="2026-03-24T01:30:14.114Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/gaku.jpg">
    `,
    source,
    "https://www.kankakari.com/single-post/gaku-nakazawa-exhibition-4-4-19",
  );
  const naotoEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Naoto Ishii exhibition 3/1-16">
      <meta property="og:description" content="石井直人 新作展2026. 3. 1 sun - 16 mon 時間 13:00-18:00">
      <meta property="article:published_time" content="2026-02-12T01:30:14.114Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/naoto.jpg">
    `,
    source,
    "https://www.kankakari.com/single-post/naoto-ishii-exhibition-3-1-16",
  );
  const titleOnlyEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Title Date exhibition 6/1-15">
      <meta property="og:description" content="No explicit date in body.">
      <meta property="article:published_time" content="2026-05-29T06:55:56.481Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/title-only.jpg">
    `,
    source,
    "https://www.kankakari.com/single-post/title-date-exhibition-6-1-15",
  );

  assert.equal(gakuEvent.title, "Gaku Nakazawa exhibition");
  assert.equal(gakuEvent.date_text, "2026-04-04 - 2026-04-19");
  assert.equal(gakuEvent.start_date, "2026-04-04");
  assert.equal(gakuEvent.end_date, "2026-04-19");
  assert.equal(naotoEvent.title, "Naoto Ishii exhibition");
  assert.equal(naotoEvent.start_date, "2026-03-01");
  assert.equal(naotoEvent.end_date, "2026-03-16");
  assert.equal(titleOnlyEvent.title, "Title Date exhibition");
  assert.equal(titleOnlyEvent.start_date, "2026-06-01");
  assert.equal(titleOnlyEvent.end_date, "2026-06-15");
});

test("source-specific skip rule drops past Kankakari events", () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "kankakari" },
      {
        title: "Past exhibition",
        start_date: "2020-03-01",
        end_date: "2020-03-16",
      },
    ),
    "past event",
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: "kankakari" },
      {
        title: "Future exhibition",
        start_date: "2099-03-01",
        end_date: "2099-03-16",
      },
    ),
    null,
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

test("Raku Museum detail URLs include current and forthcoming English tabs", () => {
  const listingHtml = `
    <div id="contents">
      <ul id="ex-tab">
        <li class="n01 stay01"><a href="#">current exhibition</a></li>
        <li class="n02"><a href="forthcoming_exhibitions.html">Forthcoming exhibitions</a></li>
        <li class="n03"><a href="past_exhibitions.html">Past major exhibitions</a></li>
      </ul>
      <div class="tabContent"><div id="tab1">Current exhibition</div></div>
    </div>
  `;

  const urls = detailUrlExtractors["raku-museum"](
    listingHtml,
    "https://www.raku-yaki.or.jp/e/museum/exhibition/index.html",
  );

  assert.deepEqual(urls, [
    "https://www.raku-yaki.or.jp/e/museum/exhibition/index.html",
    "https://www.raku-yaki.or.jp/e/museum/exhibition/forthcoming_exhibitions.html",
  ]);
});

test("Raku Museum English exhibition extraction reads tab content date", () => {
  const detailHtml = `
    <div id="contents">
      <div class="tabContent">
        <div id="tab1">
          <h4>
            <div class="lh14"><span class="f11em">Special Exhibition: Raku Successive Generations</span><br />
              <span class="f09em">- Raku Tea Bowls Crossing Time</span><br />
              <span class="f09em">Saturday 25 April - Wednesday 26 August 2026</span></div>
          </h4>
          <div class="p_box">
            <img src="../../../common/img/exhibition/flyer63.jpg" width="140" class="img-border" />
            <p>The tradition of Raku tea bowls has been transmitted within the Raku family for over 450 years.</p>
          </div>
        </div>
      </div>
    </div>
  `;
  const source = {
    name: "Raku Museum",
    source_type: "museum",
    source_categories: ["ceramics", "museum", "craft"],
    language: "en",
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    "https://www.raku-yaki.or.jp/e/museum/exhibition/index.html",
  );

  assert.equal(
    event.title,
    "Special Exhibition: Raku Successive Generations - Raku Tea Bowls Crossing Time",
  );
  assert.equal(event.date_text, "Saturday 25 April - Wednesday 26 August 2026");
  assert.equal(event.start_date, "2026-04-25");
  assert.equal(event.end_date, "2026-08-26");
  assert.equal(event.primary_image_url, "https://www.raku-yaki.or.jp/common/img/exhibition/flyer63.jpg");
});

test("Raku Museum Japanese homepage extraction reads info row", () => {
  const detailHtml = `
    <div class="info">
      <dl>
        <dt><span class="t_88 gray">2026/04/25</span></dt>
        <dd><span class="f12em">【開催中】 <a href="https://www.raku-yaki.or.jp/museum/exhibition/index.html">「特別展　樂歴代 −時代を超える茶碗たち−」</a></span><br />
          会　期：2026年4月25日（土）〜 8月26日（水）</dd>
        <dt><span class="t_88 gray"></span></dt>
        <dd>オンラインイベント<a href="museum/special_program.html">「おうちでみる ギャラリートーク in RAKM」</a>を開催します。</dd>
      </dl>
    </div>
  `;
  const source = {
    name: "Raku Museum",
    source_type: "museum",
    source_categories: ["ceramics", "museum", "craft"],
    language: "ja",
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    "https://www.raku-yaki.or.jp/index.html",
  );

  assert.equal(event.title, "特別展　樂歴代 −時代を超える茶碗たち−");
  assert.equal(event.date_text, "会 期：2026年4月25日（土）〜 8月26日（水）");
  assert.equal(event.start_date, "2026-04-25");
  assert.equal(event.end_date, "2026-08-26");
  assert.equal(event.source_url, "https://www.raku-yaki.or.jp/index.html");
});

test("koen detail extraction crawls the main event page itself", () => {
  const urls = detailUrlExtractors["koen-kyoto"](
    `<main><h1>event information</h1></main>`,
    "https://koenkyoto.theshop.jp/p/00006",
  );

  assert.deepEqual(urls, ["https://koenkyoto.theshop.jp/p/00006"]);
});

test("koen event extraction reads the main container listing", () => {
  const detailHtml = `
    <main class="layout-main" data-route="edit_design_page">
      <div class="layout-cotContainer" data-container="true" data-container-name="main">
        <div data-parts="title"><div class="title_title"><p>event information</p></div></div>
        <div data-parts="title"><div class="title_title"><p>“koen zine fair” 作品の募集</p></div></div>
        <div data-parts="text">
          <p>11月に開催を予定しておりますzineの展示販売会“koen zine fair”で、<br>
          ご紹介させていただく作品を下記の日程で募集いたします。<br><br>
          開催日時 : 2025.11.1(土)-9(日) 11:00-22:00 ※月・火・水定休<br>
          開催場所 : koen 2F gallery<br>
          〒606-8176 京都府京都市左京区一乗寺塚本町15-2</p>
        </div>
        <div data-parts="column-image-and-text">
          <img class="js-image" src="https:&#x2F;&#x2F;baseec-img-mng.akamaized.net&#x2F;images&#x2F;shop_front&#x2F;koenkyoto-theshop-jp&#x2F;79aef0731e7e60975e7cd0e589a13ef6.png">
        </div>
      </div>
    </main>
  `;
  const source = {
    name: "koen",
    source_type: "gallery",
    source_categories: ["gallery"],
    language: "ja",
    address_text: "15-2 Ichijoji Tsukamotocho, Sakyo-ku, Kyoto 606-8176 Japan",
  };

  const event = eventExtractors["koen-kyoto"](
    detailHtml,
    source,
    "https://koenkyoto.theshop.jp/p/00006",
  );

  assert.equal(event.title, "“koen zine fair” 作品の募集");
  assert.equal(event.date_text, "開催日時 : 2025.11.1(土)-9(日) 11:00-22:00 ※月・火・水定休");
  assert.equal(event.start_date, "2025-11-01");
  assert.equal(event.end_date, "2025-11-09");
  assert.equal(event.description.includes("zineの展示販売会"), true);
  assert.equal(
    event.primary_image_url,
    "https://baseec-img-mng.akamaized.net/images/shop_front/koenkyoto-theshop-jp/79aef0731e7e60975e7cd0e589a13ef6.png",
  );
});

test("source-specific skip rule drops past koen events", () => {
  const reason = getSourceSpecificSkipReason(
    { slug: "koen-kyoto" },
    {
      title: "past koen event",
      start_date: "2025-11-01",
      end_date: "2025-11-09",
    },
  );

  assert.equal(reason, "past event");
});

test("Sen-Oku extraction removes the trailing ad image", () => {
  const detailHtml = `
    <meta property="og:image" content="https://sen-oku.or.jp/wp-content/uploads/hero.jpg">
    <div class="catchArea wrap">
      <div class="catch">
        <font>Special Exhibition</font>
        <span>Collection subtitle that should not become title</span>
      </div>
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

  assert.equal(event.title, "Special Exhibition");
  assert.equal(event.primary_image_url, "https://sen-oku.or.jp/wp-content/uploads/hero.jpg");
  assert.deepEqual(event.image_urls, [
    "https://sen-oku.or.jp/wp-content/uploads/hero.jpg",
    "https://sen-oku.or.jp/wp-content/uploads/detail-1.jpg",
    "https://sen-oku.or.jp/wp-content/uploads/detail-2.jpg",
  ]);
});

test("Sen-Oku title extraction drops subtitle spans without font wrapper", () => {
  const event = extractSenOkuEvent(
    `
      <meta property="og:image" content="https://sen-oku.or.jp/wp-content/uploads/hero.jpg">
      <div class="catchArea wrap">
        <div class="catch">
          Special Exhibition<br>
          <span>Subtitle should not become title</span>
        </div>
        <div class="dataSetList"></div>
      </div>
      <span class="num">2026.04.01</span>
      <span class="num">2026.05.31</span>
      <div class="leadArea"><p class="copy">Copy.</p></div>
    `,
    {
      name: "Sen-Oku Hakukokan Museum",
      source_type: "museum",
      source_categories: ["art", "museum"],
    },
    "https://sen-oku.or.jp/program/202604_special/"
  );

  assert.equal(event.title, "Special Exhibition");
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

  const normalHtmlWithChallengeWords = `
    <title>Current Exhibitions</title>
    <main>${"Current exhibition information with dates and image links. ".repeat(50)}</main>
    <script id="captcha-bootstrap">window.analyticsMessage = "request blocked"; window.formProtection = "hcaptcha g-recaptcha";</script>
  `;

  assert.equal(
    classifyFetchResult({
      response: new Response(normalHtmlWithChallengeWords, { status: 200, headers }),
      html: normalHtmlWithChallengeWords,
    }),
    "ok"
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
