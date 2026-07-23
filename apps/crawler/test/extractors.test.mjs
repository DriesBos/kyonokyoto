import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX } from '../../../packages/shared/event-media.mjs';
import {
  assessEventTitle,
  archiveStaleEvents,
  assertScheduleSegmentStorage,
  assertSafeRemoteUrl,
  assignEventCoordinates,
  buildRendererEnv,
  buildTranslationSourceContentHash,
  classifyFetchResult,
  classifySourceOutcome,
  crawlRunStatusForOutcome,
  createCrawlDiagnostics,
  decodeHtmlResponseBytes,
  buildEventTranslationPayload,
  buildMachineTranslatedEvent,
  detailUrlExtractors,
  eventExtractors,
  extractChushinDetailUrls,
  extractChushinEvent,
  extractGenericDetailUrls,
  extractGenericEvent,
  extractHongKongPalaceMuseumDetailUrls,
  extractMplusDetailUrls,
  extractMplusEvent,
  extractMeta,
  extractBestDateText,
  extractSourceSpecificDetailUrls,
  fetchRemote,
  extractLocaleUrlsFromHtml,
  extractRakuMuseumEvent,
  extractSenOkuEvent,
  getSourceSpecificSkipReason,
  getSourceTruthSkipReason,
  getRetryDelayMs,
  getInvalidRequiredEventFields,
  getSourceDetailLimit,
  hasExtractedImage,
  hasValidEventDescription,
  hasValidEventTitle,
  hasVerifiedEventDate,
  detailPageCacheKey,
  isPublicIpAddress,
  isUrlAllowedByRobotsText,
  isUsableNativeLocaleUrl,
  nativeLocaleEventMatchesCanonical,
  normalizeEventImagesForSource,
  normalizeEventDatePrecision,
  normalizeHumanDateText,
  parseGenericDateRange,
  parseImageDimensionsFromBytes,
  parseKyoceraDateRange,
  publishEvent,
  recordFetchedPage,
  recordSkippedEvent,
  reconcileUnavailableTargetTranslation,
  recoverStaleCrawlRuns,
  resolveRendererNavigationUrl,
  resolveEventDescription,
  shouldRetryDetailWithCrawl4Ai,
  runJsonCommand,
  sourceContextLoaders,
  sourceSpecificSkipMatchers,
  sourceHasNativeLocale,
  shouldMachineTranslateMissingLocales,
  shouldArchiveStaleEvents,
  sanitizePostgresJson,
  sanitizePostgresText,
  translateTextFields,
  upsertEvent,
  withSourceLocaleConfig,
  withSourceSpecificDescriptionOrigin,
} from '../src/run-once.mjs';
import { buildCrawlQaReport } from '../src/crawl-qa.mjs';
import {
  applySourceOverride,
  currentYearInCity,
  currentYearInTokyo,
  loadAllSourcesConfig,
  loadSourcesConfig,
  timeZoneForCity,
  validateSourceConfig,
} from '../../../data/sources/source-config.mjs';
import {
  buildEventDedupeKey,
  buildEventSemanticIdentityKey,
  dedupeEvents,
} from '../../../packages/shared/event-dedupe.mjs';

const fixturesRoot = resolve(import.meta.dirname, 'fixtures');
const testTaxonomy = (
  venue_category = ['gallery'],
  display_category = [],
  event_category = [],
) => ({ venue_category, display_category, event_category });

test('city year rollover and timezone use local city time', () => {
  const value = new Date('2025-12-31T15:30:00Z');

  assert.equal(currentYearInTokyo(value), '2026');
  assert.equal(currentYearInCity('hong-kong', value), '2025');
  assert.equal(timeZoneForCity('hong-kong'), 'Asia/Hong_Kong');
});

test('named crawler scripts use registered source slugs', async () => {
  const packageConfig = JSON.parse(
    await readFile(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );

  assert.equal(packageConfig.scripts['crawl:momak'], 'node src/run-once.mjs --source=momak');
  assert.equal(
    packageConfig.scripts['crawl:sen-oku'],
    'node src/run-once.mjs --source=sen-oku-hakukokan',
  );
});

test('approved source allowlist is public without changing nearby beta sources', async () => {
  const osakaSources = await loadSourcesConfig({ city: 'osaka' });
  const tokyoSources = await loadSourcesConfig({ city: 'tokyo' });
  const hongKongSources = await loadSourcesConfig({ city: 'hong-kong' });
  const sourceBySlug = new Map(
    [...osakaSources, ...tokyoSources, ...hongKongSources].map((source) => [source.slug, source]),
  );
  const approvedSlugs = [
    'suchsize',
    'tezukayama-gallery',
    'hitoto',
    'new-pure-plus',
    'hyogo-prefectural-museum-of-art',
    'sumida-hokusai-museum',
    'yayoi-kusama-museum',
    'what-museum',
    'university-art-museum-tokyo-geidai',
    'yamatane-museum-of-art',
    'national-museum-of-modern-art-tokyo',
    'tokyo-node',
    'tokyo-metropolitan-art-museum',
    'take-ninagawa',
    'perrotin-tokyo',
    'hong-kong-art-school-gallery',
    'david-zwirner',
    'white-cube-hong-kong',
  ];
  const unchangedBetaSlugs = [
    'i-gallery-osaka',
    'itsuo-art-museum',
    'gallery-nomart',
    'tokyo-opera-city-art-gallery',
    'taro-okamoto-memorial-museum',
    'gyre-gallery',
    'gagosian-hong-kong',
    'whitestone-gallery-hong-kong',
  ];

  for (const slug of approvedSlugs) {
    assert.equal(sourceBySlug.get(slug)?.beta, false, `${slug} should be public`);
  }
  for (const slug of unchangedBetaSlugs) {
    assert.equal(sourceBySlug.get(slug)?.beta, true, `${slug} should remain beta`);
  }
});

test('semantic dedupe preserves Japanese identity text', () => {
  const first = {
    source_url: 'https://museum.example/exhibitions/ja/',
    title: '美術展',
    start_date: '2026-07-01',
    end_date: '2026-07-31',
  };
  const second = { ...first, source_url: 'https://museum.example/exhibitions/en/' };

  assert.match(buildEventSemanticIdentityKey(first), /美術展/);
  assert.equal(dedupeEvents([first, second]).length, 1);
});

test('crawl outcome gates stale archival and persisted status', () => {
  assert.equal(crawlRunStatusForOutcome('source_ok'), 'success');
  assert.equal(crawlRunStatusForOutcome('source_no_current_events'), 'success');
  assert.equal(crawlRunStatusForOutcome('source_needs_review'), 'partial_success');
  assert.equal(crawlRunStatusForOutcome('source_blocked'), 'partial_success');
  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://example.test/event'],
      savedEvents: [{ id: 'event-1' }],
      diagnostics: { unhealthy_fetch_count: 1 },
    }),
    'source_degraded',
  );
  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://example.test/event'],
      savedEvents: [{ id: 'event-1' }],
      diagnostics: { missing_image_count: 1 },
      usedGenericExtractor: true,
    }),
    'source_needs_review',
  );
  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://example.test/event'],
      savedEvents: [{ id: 'event-1' }],
      diagnostics: {},
      usedGenericExtractor: true,
    }),
    'source_ok',
  );
  assert.equal(
    classifySourceOutcome({
      detailUrls: [],
      diagnostics: { bot_challenge_count: 1 },
      sourceSlug: 'curation-fair-kyoto',
    }),
    'source_blocked',
  );

  assert.equal(shouldArchiveStaleEvents({ sourceOutcome: 'source_ok' }), true);
  assert.equal(
    shouldArchiveStaleEvents({
      sourceOutcome: 'source_ok',
      skippedEvents: [{ reason: 'past event' }],
    }),
    true,
  );
  assert.equal(
    shouldArchiveStaleEvents({
      sourceOutcome: 'source_no_current_events',
      skippedEvents: [{ reason: 'missing verifiable event date' }],
    }),
    false,
  );
  assert.equal(
    shouldArchiveStaleEvents({
      sourceOutcome: 'source_ok',
      discoveryComplete: false,
    }),
    false,
  );
  assert.equal(
    shouldArchiveStaleEvents({
      sourceOutcome: 'source_ok',
      diagnostics: { bot_challenge_count: 1 },
    }),
    false,
  );
});

test('detail crawl limits are globally capped and fragment URLs share cache entries', () => {
  assert.equal(getSourceDetailLimit({}, 8, 50), 8);
  assert.equal(getSourceDetailLimit({ crawl_hints: { max_detail_pages: 12 } }, 8, 50), 12);
  assert.equal(getSourceDetailLimit({ crawl_hints: { max_detail_pages: 200 } }, 8, 50), 50);
  assert.equal(
    detailPageCacheKey('https://example.test/exhibition?id=1#schedule'),
    detailPageCacheKey('https://example.test/exhibition?id=1#access'),
  );
});

test('stale archival batches database updates', async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    dedupe_key: `event-${index}`,
  }));
  const patches = [];
  const offsets = [];
  const archived = await archiveStaleEvents(
    {},
    'source-id',
    new Set(['event-0']),
    async (request) => {
      if (request.method !== 'PATCH') {
        const offset = Number(request.path.match(/offset=(\d+)/)?.[1] ?? 0);
        offsets.push(offset);
        return rows.slice(offset, offset + 1000);
      }
      patches.push(request.path);
      const ids = request.path.match(/id=in\.\((.*?)\)/)?.[1].split(',') ?? [];
      return ids.map((id) => ({ id }));
    },
  );

  assert.equal(archived, 1204);
  assert.deepEqual(offsets, [0, 1000, 1205]);
  assert.equal(patches.length, 13);
  assert.equal(patches[0].split(',').length, 100);
});

test('stale running crawl recovery is source-scoped and six hours old', async () => {
  let capturedRequest = null;
  const recovered = await recoverStaleCrawlRuns(
    {},
    'source-id',
    async (request) => {
      capturedRequest = request;
      return [{ id: 'run-1' }, { id: 'run-2' }];
    },
    new Date('2026-07-12T12:00:00.000Z'),
  );

  assert.equal(recovered, 2);
  assert.equal(capturedRequest.method, 'PATCH');
  assert.match(capturedRequest.path, /source_id=eq\.source-id/);
  assert.match(capturedRequest.path, /status=eq\.running/);
  assert.match(capturedRequest.path, /started_at=lt\.2026-07-12T06%3A00%3A00\.000Z/);
  assert.deepEqual(capturedRequest.body, {
    status: 'failed',
    finished_at: '2026-07-12T12:00:00.000Z',
    error_message: 'Recovered stale crawl run before starting a new source crawl.',
  });
});

test('generic date parser normalizes and validates common Japanese and English formats', () => {
  const cases = [
    ['２０２６年７月１１日（土）～８月１日（土）', '2026-07-11', '2026-08-01'],
    ['令和8年7月11日〜8月1日', '2026-07-11', '2026-08-01'],
    ['July 11 – August 1, 2026', '2026-07-11', '2026-08-01'],
    ['11 July – 1 August 2026', '2026-07-11', '2026-08-01'],
    ['8 - 29 August 2026', '2026-08-08', '2026-08-29'],
    ['2026.7.11–8.1', '2026-07-11', '2026-08-01'],
    ['December 20, 2026 – January 10, 2027', '2026-12-20', '2027-01-10'],
  ];

  for (const [raw, startDate, endDate] of cases) {
    const parsed = parseGenericDateRange(raw);
    assert.equal(parsed.startDate, startDate, raw);
    assert.equal(parsed.endDate, endDate, raw);
  }

  assert.equal(
    normalizeHumanDateText('２０２６年７月１１日（土）～８月１日（土）'),
    '2026年7月11日 -8月1日',
  );
  assert.equal(parseGenericDateRange('2026年2月30日').startDate, null);
});

test('generic date discovery prefers structured and exhibition date content over publication dates', () => {
  const html = `
    <meta property="og:description" content="Published July 1, 2026">
    <div class="published-date">July 1, 2026</div>
    <script type="application/ld+json">
      {"@type":"ExhibitionEvent","startDate":"2026-07-11","endDate":"2026-08-01"}
    </script>
    <main><p class="event-period">July 11 – August 1, 2026</p></main>
  `;

  assert.equal(extractBestDateText(html), '2026-07-11 - 2026-08-01');
});

test('crawler publishes only events with a machine-verifiable start date', () => {
  assert.equal(hasVerifiedEventDate({ start_date: '2026-07-11' }), true);
  assert.equal(hasVerifiedEventDate({ calendar_starts_at: '2026-07-11T10:00:00+09:00' }), true);
  assert.equal(hasVerifiedEventDate({ occurrence_dates: ['2026-07-11'] }), true);
  assert.equal(hasVerifiedEventDate({ end_date: '2026-08-01' }), false);
  assert.equal(hasVerifiedEventDate({ date_text: 'See source page' }), false);
});

test('all-day events store date precision without invented timestamps', () => {
  assert.deepEqual(
    normalizeEventDatePrecision({
      is_all_day: true,
      start_date: '2026-07-11',
      end_date: '2026-08-01',
      calendar_starts_at: '2026-07-11T10:00:00+09:00',
      calendar_ends_at: '2026-08-01T18:00:00+09:00',
    }),
    {
      is_all_day: true,
      start_date: '2026-07-11',
      end_date: '2026-08-01',
      calendar_starts_at: null,
      calendar_ends_at: null,
    },
  );

  const timed = {
    is_all_day: false,
    calendar_starts_at: '2026-07-11T10:00:00+09:00',
    calendar_ends_at: '2026-07-11T18:00:00+09:00',
  };
  assert.equal(normalizeEventDatePrecision(timed), timed);
});

test('robots rules use the most specific agent and longest matching path', () => {
  const robots = `
    User-agent: *
    Disallow: /private/
    Allow: /private/public/

    User-agent: kyo-no-kyoto-bot
    Disallow: /bot-blocked/
  `;

  assert.equal(
    isUrlAllowedByRobotsText(robots, 'kyo-no-kyoto-bot/0.1', 'https://example.test/private/item'),
    true,
  );
  assert.equal(
    isUrlAllowedByRobotsText(
      robots,
      'kyo-no-kyoto-bot/0.1',
      'https://example.test/bot-blocked/item',
    ),
    false,
  );
  assert.equal(
    isUrlAllowedByRobotsText(robots, 'other-bot/1.0', 'https://example.test/private/public/item'),
    true,
  );
  assert.equal(
    isUrlAllowedByRobotsText(robots, 'other-bot/1.0', 'https://example.test/private/item'),
    false,
  );
});

test('crawler URL guard blocks local and private network targets', async () => {
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('127.0.0.1'), false);
  assert.equal(isPublicIpAddress('169.254.169.254'), false);
  assert.equal(isPublicIpAddress('::1'), false);
  assert.equal(isPublicIpAddress('::ffff:7f00:1'), false);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);

  await assert.rejects(() => assertSafeRemoteUrl('http://localhost/admin'));
  await assert.rejects(() =>
    assertSafeRemoteUrl('https://museum.example/event', async () => [
      { address: '10.0.0.8', family: 4 },
    ]),
  );
  await assert.doesNotReject(() =>
    assertSafeRemoteUrl('https://museum.example/event', async () => [
      { address: '203.0.114.8', family: 4 },
    ]),
  );

  let fetchCalls = 0;
  await assert.rejects(() =>
    fetchRemote(
      'https://museum.example/event',
      {},
      async () => [{ address: '203.0.114.8', family: 4 }],
      async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        });
      },
    ),
  );
  assert.equal(fetchCalls, 1);

  await assert.rejects(
    () =>
      fetchRemote(
        'https://museum.example/event',
        {},
        async () => [{ address: '203.0.114.8', family: 4 }],
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://other.example/event' },
          }),
        async (redirectUrl) => {
          throw new Error(`blocked redirect ${redirectUrl.hostname}`);
        },
      ),
    /blocked redirect other\.example/,
  );
});

test('renderer preflight checks redirect robots and delay before destination fetch', async () => {
  const sequence = [];
  const finalUrl = await resolveRendererNavigationUrl(
    'https://museum.example/start',
    'test-agent',
    {},
    { allowedDomains: ['museum.example'] },
    {
      lookup: async () => [{ address: '203.0.114.8', family: 4 }],
      fetchImpl: async (url) => {
        sequence.push(`fetch:${url.pathname}`);
        return url.pathname === '/start'
          ? new Response(null, { status: 302, headers: { location: '/final' } })
          : new Response(null, { status: 200 });
      },
      assertRobotsAllowedFn: async (url) => {
        sequence.push(`robots:${new URL(url).pathname}`);
      },
      waitForDomainDelayFn: async (url) => {
        sequence.push(`delay:${new URL(url).pathname}`);
      },
    },
  );

  assert.equal(finalUrl, 'https://museum.example/final');
  assert.deepEqual(sequence, [
    'robots:/start',
    'delay:/start',
    'fetch:/start',
    'robots:/final',
    'delay:/final',
    'fetch:/final',
    'delay:/final',
  ]);
});

test('renderer child gets bounded output, runtime, and scrubbed environment', async () => {
  const rendererEnv = buildRendererEnv({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    GOOGLE_APPLICATION_CREDENTIALS: '/secret.json',
  });
  assert.deepEqual(rendererEnv, { PATH: '/usr/bin', HOME: '/tmp/home' });

  await assert.rejects(
    () =>
      runJsonCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(1000))"], {
        maxOutputBytes: 100,
      }),
    /output exceeded 100 bytes/,
  );
  await assert.rejects(
    () =>
      runJsonCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
        timeoutMs: 25,
      }),
    /timed out after 25ms/,
  );
});

test('retry delay caps external Retry-After values', () => {
  const response = new Response(null, { headers: { 'retry-after': '86400' } });
  assert.equal(
    getRetryDelayMs({ attempt: 1, baseDelayMs: 1000, response, maxDelayMs: 60000 }),
    60000,
  );
});

test('event upsert fails fast on schema drift', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      upsertEvent(
        {
          SUPABASE_URL: 'https://database.example',
          SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        },
        'source-id',
        'raw-page-id',
        {
          title: 'Event title',
          source_url: 'https://museum.example/event',
          schedule_segments: [{ is_all_day: true, start_date: '2026-07-13' }],
        },
        'url:https://museum.example/event',
        async () => {
          calls += 1;
          return new Response("Could not find the 'unexpected_field' column", { status: 400 });
        },
      ),
    /Could not find the 'unexpected_field' column/,
  );
  assert.equal(calls, 1);
});

test('event upsert rejects invalid schedules before touching a published row', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      upsertEvent(
        {
          SUPABASE_URL: 'https://database.example',
          SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        },
        'source-id',
        'raw-page-id',
        {
          title: 'Event title',
          source_url: 'https://museum.example/event',
          schedule_type: 'range',
          schedule_segments: [
            { is_all_day: true, start_date: '2026-10-24', end_date: '2026-01-17' },
          ],
        },
        'url:https://museum.example/event',
        async () => {
          calls += 1;
          return new Response();
        },
      ),
    /invalid event schedule/,
  );
  assert.equal(calls, 0);
});

test('event persistence stages draft before schedule write and publishes explicitly', async () => {
  let eventPayload;
  const savedEvent = await upsertEvent(
    {
      SUPABASE_URL: 'https://database.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    },
    'source-id',
    'raw-page-id',
    {
      title: 'Event title',
      source_url: 'https://museum.example/event',
      schedule_segments: [{ is_all_day: true, start_date: '2026-07-13' }],
    },
    'url:https://museum.example/event',
    async (_url, options) => {
      eventPayload = JSON.parse(options.body)[0];
      return new Response(JSON.stringify([{ id: 'event-id', title: 'Event title' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  assert.equal(savedEvent.id, 'event-id');
  assert.equal(eventPayload.status, 'draft');
  assert.equal('schedule_segments' in eventPayload, false);

  const requests = [];
  const request = async (input) => {
    requests.push(input);
    return [{ id: 'event-id', status: 'published' }];
  };
  await assertScheduleSegmentStorage({}, request);
  await publishEvent({}, 'event-id', request);

  assert.equal(requests[0].path, 'event_schedule_segments?select=id&limit=0');
  assert.deepEqual(requests[1], {
    env: {},
    path: 'events?id=eq.event-id',
    method: 'PATCH',
    body: { status: 'published' },
  });
});

test('translation helper calls Google client with source and target locales', async () => {
  const calls = [];
  const fields = await translateTextFields(
    {
      GOOGLE_TRANSLATE_PROJECT_ID: 'test-project',
      GOOGLE_TRANSLATE_LOCATION: 'global',
      __translationClient: {
        async translateText(request) {
          calls.push(request);
          return [
            {
              translations: [
                { translatedText: 'English title' },
                { translatedText: 'English description' },
              ],
            },
          ];
        },
      },
    },
    {
      title: '日本語タイトル',
      description: '日本語説明',
      venue_name: null,
    },
    'ja',
    'en',
  );

  assert.deepEqual(fields, {
    title: 'English title',
    description: 'English description',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, 'projects/test-project/locations/global');
  assert.equal(calls[0].sourceLanguageCode, 'ja');
  assert.equal(calls[0].targetLanguageCode, 'en');
  assert.deepEqual(calls[0].contents, ['日本語タイトル', '日本語説明']);
});

test('translation helper returns null when Google project is not configured', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const fields = await translateTextFields({}, { title: '日本語タイトル' }, 'ja', 'en');
    assert.equal(fields, null);
  } finally {
    console.warn = originalWarn;
  }
});

test('machine translated event keeps source URL and required event fields', async () => {
  const translated = await buildMachineTranslatedEvent(
    {
      GOOGLE_TRANSLATE_PROJECT_ID: 'test-project',
      __translationClient: {
        async translateText() {
          return [
            {
              translations: [
                { translatedText: 'English title' },
                { translatedText: 'English description' },
              ],
            },
          ];
        },
      },
    },
    {
      title: '日本語タイトル',
      description: '日本語説明',
      institution_name: '日本語施設',
      venue_name: '日本語会場',
      address_text: '日本語住所',
      date_text: '2026年1月1日',
      source_url: 'https://example.test/ja/event',
    },
    'ja',
    'en',
  );

  assert.equal(translated.title, 'English title');
  assert.equal(translated.description, 'English description');
  assert.equal(translated.institution_name, '日本語施設');
  assert.equal(translated.venue_name, '日本語会場');
  assert.equal(translated.address_text, '日本語住所');
  assert.equal(translated.date_text, '2026年1月1日');
  assert.equal(translated.source_url, 'https://example.test/ja/event');
});

test('event translation payload stores only localized public fields', () => {
  const sourceContentHash = buildTranslationSourceContentHash({
    title: 'Title',
    description: 'Description',
  });

  assert.deepEqual(
    buildEventTranslationPayload(
      'event-1',
      'en',
      {
        title: 'Title',
        description: 'Description',
        institution_name: 'Institution',
        venue_name: 'Venue',
        address_text: 'Address',
        date_text: 'Dates',
        source_url: 'https://example.test/event',
        primary_image_url: 'https://example.test/image.jpg',
      },
      sourceContentHash,
    ),
    {
      event_id: 'event-1',
      locale: 'en',
      title: 'Title',
      description: 'Description',
      source_content_hash: sourceContentHash,
    },
  );
  assert.throws(
    () => buildEventTranslationPayload('event-1', 'en', { title: 'Title' }),
    /source content hash must be a lowercase SHA-256/,
  );
});

test('translation source hash uses canonical source title and description', () => {
  const canonicalHash = buildTranslationSourceContentHash({
    title: 'Cafe\u0301 exhibition\r\n',
    description: '  Source description  ',
    source_url: 'https://example.test/one',
  });

  assert.match(canonicalHash, /^[0-9a-f]{64}$/);
  assert.equal(
    canonicalHash,
    buildTranslationSourceContentHash({
      title: 'Café exhibition\n',
      description: 'Source description',
      source_url: 'https://example.test/two',
    }),
  );
  assert.notEqual(
    canonicalHash,
    buildTranslationSourceContentHash({
      title: 'Café exhibition',
      description: 'Changed description',
    }),
  );
});

test('unavailable target translation preserves current hash and deletes stale hashes', async () => {
  const sourceContentHash = 'a'.repeat(64);

  for (const [storedHash, expectedAction, expectedMethods] of [
    [sourceContentHash, 'preserved', ['GET']],
    [null, 'deleted', ['GET', 'DELETE']],
    ['b'.repeat(64), 'deleted', ['GET', 'DELETE']],
  ]) {
    const requests = [];
    const action = await reconcileUnavailableTargetTranslation(
      {},
      'event-1',
      'en',
      sourceContentHash,
      async (request) => {
        requests.push(request);
        return request.method === 'DELETE' ? null : [{ source_content_hash: storedHash }];
      },
    );

    assert.equal(action, expectedAction);
    assert.deepEqual(
      requests.map((request) => request.method ?? 'GET'),
      expectedMethods,
    );
  }
});

test('event coordinates prefer configured venue locations', () => {
  const event = assignEventCoordinates(
    {
      title: 'Special exhibition',
      venue_name: 'The Triangle',
      address_text: 'Kyoto City KYOCERA Museum of Art',
    },
    {
      name: 'Kyoto City KYOCERA Museum of Art',
      taxonomy: testTaxonomy(['museum']),
      address_text: '124 Okazaki Enshoji-cho, Sakyo-ku, Kyoto 606-8344 Japan',
      lat: 35,
      lng: 135,
      venue_locations: [
        {
          name: 'The Triangle',
          match: ['The Triangle'],
          address_text: 'The Triangle, Kyoto City KYOCERA Museum of Art',
          lat: 35.0123,
          lng: 135.7834,
        },
      ],
    },
  );

  assert.equal(event.lat, 35.0123);
  assert.equal(event.lng, 135.7834);
  assert.equal(event.institution_name, 'Kyoto City KYOCERA Museum of Art');
  assert.equal(event.venue_name, 'The Triangle');
  assert.equal(event.address_text, 'The Triangle, Kyoto City KYOCERA Museum of Art');
  assert.deepEqual(event.categories, ['venue_category:museum']);
});

test('event coordinates fall back to source coordinates', () => {
  const event = assignEventCoordinates(
    {
      title: 'Gallery exhibition',
      institution_name: 'THE HEARTH KYOTO',
      venue_name: 'Main gallery',
      address_text: 'Scraped address',
    },
    {
      name: 'The Terminal Kyoto',
      taxonomy: testTaxonomy(['gallery']),
      address_text: '424 Iwatoyama-cho, Shimogyo-ku, Kyoto 600-8445 Japan',
      directions_query: 'The Terminal Kyoto, Kyoto',
      lat: '35.0007',
      lng: '135.7568',
      venue_locations: [
        {
          match: ['Other venue'],
          lat: 35.1,
          lng: 135.1,
        },
      ],
    },
  );

  assert.equal(event.lat, 35.0007);
  assert.equal(event.lng, 135.7568);
  assert.equal(event.institution_name, 'The Terminal Kyoto');
  assert.equal(event.venue_name, 'The Terminal Kyoto');
  assert.equal(event.address_text, '424 Iwatoyama-cho, Shimogyo-ku, Kyoto 600-8445 Japan');
  assert.equal(event.directions_query, 'The Terminal Kyoto, Kyoto');
  assert.deepEqual(event.categories, ['venue_category:gallery']);
});

test('event coordinates stay null when source has no usable location', () => {
  const event = assignEventCoordinates(
    {
      title: 'Remote exhibition',
      venue_name: 'Unknown venue',
    },
    { taxonomy: testTaxonomy(['gallery']) },
  );

  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
});

test('source truth flags explicit scraped venue city contradictions before overwrite', () => {
  const mismatched = assignEventCoordinates(
    {
      title: 'Tokyo in title must not affect city checks',
      venue_name: 'Nagoya Arts Center',
      address_text: 'Nagoya, Aichi',
      directions_query: 'Nagoya Arts Center',
    },
    {
      city: 'tokyo',
      name: 'Tokyo Gallery',
      taxonomy: testTaxonomy(['gallery']),
      address_text: 'Tokyo, Japan',
    },
  );
  const titleOnly = assignEventCoordinates(
    { title: 'Nagoya and Osaka', venue_name: 'Tokyo Gallery', address_text: 'Tokyo, Japan' },
    {
      city: 'tokyo',
      name: 'Tokyo Gallery',
      taxonomy: testTaxonomy(['gallery']),
      address_text: 'Tokyo, Japan',
    },
  );

  assert.deepEqual(mismatched._source_truth_warnings, ['venue_city_mismatch']);
  assert.equal(getSourceTruthSkipReason(mismatched), 'venue_city_mismatch');
  assert.equal(getSourceTruthSkipReason(titleOnly), null);

  const hongKongMismatch = assignEventCoordinates(
    { venue_name: 'Tokyo Gallery', address_text: 'Tokyo, Japan' },
    { city: 'hong-kong', name: 'Hong Kong Gallery', taxonomy: testTaxonomy(['gallery']) },
  );
  const hongKongMatch = assignEventCoordinates(
    { venue_name: '香港藝術館', address_text: '香港九龍' },
    { city: 'hong-kong', name: 'Hong Kong Gallery', taxonomy: testTaxonomy(['gallery']) },
  );
  assert.equal(getSourceTruthSkipReason(hongKongMismatch), 'venue_city_mismatch');
  assert.equal(getSourceTruthSkipReason(hongKongMatch), null);
  const diagnostics = createCrawlDiagnostics();
  recordSkippedEvent(diagnostics, getSourceTruthSkipReason(mismatched));
  assert.equal(diagnostics.skipped_other_count, 1);
});

test('Kyocera date parser reads Japanese date ranges', () => {
  assert.deepEqual(parseKyoceraDateRange('2026年9月19日-2026年12月20日'), {
    startDate: '2026-09-19',
    endDate: '2026-12-20',
    calendarStartsAt: '2026-09-19T10:00:00+09:00',
    calendarEndsAt: '2026-12-20T18:00:00+09:00',
  });
});

test('Kyocera date parser reads slash date ranges', () => {
  assert.deepEqual(parseKyoceraDateRange('2027/10/2-2027/12/12'), {
    startDate: '2027-10-02',
    endDate: '2027-12-12',
    calendarStartsAt: '2027-10-02T10:00:00+09:00',
    calendarEndsAt: '2027-12-12T18:00:00+09:00',
  });
});

test('generic date parsers read en dash date ranges', () => {
  const dottedEvent = extractGenericEvent(
    `
      <h1 class="event-title">Dotted Range</h1>
      <p class="event-date">2026.5.16 Sat.–2026.7.12 Sun.</p>
      <p class="event-description">Useful exhibition copy.</p>
      <img src="/uploads/range.jpg" alt="">
    `,
    {
      name: 'Example Gallery',
      taxonomy: testTaxonomy(['gallery']),
      selectors: {
        title: '.event-title',
        date: '.event-date',
        description: '.event-description',
      },
    },
    'https://example.test/archives/2026/range/',
  );
  const japaneseEvent = extractGenericEvent(
    `
      <h1 class="event-title">Japanese Range</h1>
      <p class="event-date">2026年5月16日（土）–2026年7月12日（日）</p>
      <p class="event-description">Useful exhibition copy.</p>
      <img src="/uploads/range-ja.jpg" alt="">
    `,
    {
      name: 'Example Gallery',
      taxonomy: testTaxonomy(['gallery']),
      selectors: {
        title: '.event-title',
        date: '.event-date',
        description: '.event-description',
      },
    },
    'https://example.test/archives/2026/range-ja/',
  );
  const weekdayDayMonthEvent = extractGenericEvent(
    `
      <h1 class="event-title">Weekday Day Month Range</h1>
      <p class="event-date">Friday, 29 May – Saturday, 11 July, 2026</p>
      <p class="event-description">Useful exhibition copy.</p>
      <img src="/uploads/range-en.jpg" alt="">
    `,
    {
      name: 'Example Gallery',
      taxonomy: testTaxonomy(['gallery']),
      selectors: {
        title: '.event-title',
        date: '.event-date',
        description: '.event-description',
      },
    },
    'https://example.test/archives/2026/range-en/',
  );

  assert.equal(dottedEvent.start_date, '2026-05-16');
  assert.equal(dottedEvent.end_date, '2026-07-12');
  assert.equal(japaneseEvent.start_date, '2026-05-16');
  assert.equal(japaneseEvent.end_date, '2026-07-12');
  assert.equal(weekdayDayMonthEvent.start_date, '2026-05-29');
  assert.equal(weekdayDayMonthEvent.end_date, '2026-07-11');
});

test('generic Hong Kong events use Hong Kong schedule timezone', () => {
  const event = extractGenericEvent(
    `<main>
      <h1>Harbour Forms</h1>
      <p class="date">July 11 – August 1, 2026</p>
    </main>`,
    { city: 'hong-kong', name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    'https://example.test/exhibitions/harbour-forms/',
  );

  assert.equal(event.timezone, 'Asia/Hong_Kong');
  assert.equal(event.calendar_starts_at, '2026-07-11T00:00:00+08:00');
  assert.equal(event.calendar_ends_at, '2026-08-01T23:59:00+08:00');
});

test('generic title extraction skips section metadata and keeps semantic heading provenance', () => {
  const event = extractGenericEvent(
    `
      <meta property="og:title" content="Current Exhibitions">
      <main><article><h1>Quiet Forms</h1></article></main>
      <p class="date">July 11 – August 1, 2026</p>
      <img src="/quiet-forms.jpg" alt="">
    `,
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    'https://example.test/exhibitions/quiet-forms/',
  );

  assert.equal(event.title, 'Quiet Forms');
  assert.equal(event._title_origin, 'scoped_heading');
  assert.equal(event._title_valid, true);
  assert.deepEqual(event._title_warnings, []);
});

test('generic title extraction prefers structured Event names', () => {
  const event = extractGenericEvent(
    `
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"ExhibitionEvent","name":"Structured Show"}
      </script>
      <main><h1>Exhibitions</h1></main>
      <p class="date">July 11 – August 1, 2026</p>
      <img src="/structured-show.jpg" alt="">
    `,
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    'https://example.test/exhibitions/structured-show/',
  );

  assert.equal(event.title, 'Structured Show');
  assert.equal(event._title_origin, 'json_ld');
  assert.equal(hasValidEventTitle(event), true);
});

test('generic title extraction keeps title inside event scope and skips section headings', () => {
  const structured = extractGenericEvent(
    `
      <main><h1>Current Exhibitions</h1></main>
      <article itemscope itemtype="https://schema.org/ExhibitionEvent">
        <span itemprop="name">Quiet Forms</span>
        <time itemprop="startDate">July 11 – August 1, 2026</time>
      </article>
    `,
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    'https://example.test/exhibitions/quiet-forms/',
  );
  const secondaryHeading = extractGenericEvent(
    `
      <main>
        <h1>みどころ</h1>
        <h2>特別展「インコ イズ カミング！」</h2>
        <p>2026年6月27日 - 2026年8月30日</p>
      </main>
    `,
    { name: 'Example Museum', taxonomy: testTaxonomy(['museum']) },
    'https://example.test/exhibitions/parrots/',
  );

  assert.equal(structured.title, 'Quiet Forms');
  assert.equal(structured._title_origin, 'structured_dom');
  assert.ok(structured._title_candidates.some((candidate) => candidate.title === 'Quiet Forms'));
  assert.equal(secondaryHeading.title, '特別展「インコ イズ カミング！」');
  assert.equal(secondaryHeading._title_origin, 'scoped_heading');
});

test('generic title prefers scoped heading then page-matched JSON-LD over unrelated events', () => {
  const detailUrl = 'https://example.test/exhibitions/right-show/';
  const structured = `
    <script type="application/ld+json">
      {
        "@type": "WebPage",
        "url": "${detailUrl}",
        "about": {"@type":"Event","name":"Unrelated nested event"},
        "mainEntity": {"@type":"ExhibitionEvent","name":"Right Structured Show"}
      }
    </script>
    <main><h1>Exhibitions</h1></main>
    <meta property="og:title" content="Open Graph fallback">
  `;
  const matched = extractGenericEvent(
    structured,
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    detailUrl,
  );
  const scoped = extractGenericEvent(
    structured.replace('<h1>Exhibitions</h1>', '<h1>Authoritative Scoped Heading</h1>'),
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery']) },
    detailUrl,
  );

  assert.equal(matched.title, 'Right Structured Show');
  assert.equal(matched._title_origin, 'json_ld');
  assert.equal(scoped.title, 'Authoritative Scoped Heading');
  assert.equal(scoped._title_origin, 'scoped_heading');
});

test('meta extraction accepts single quotes and reversed attributes', () => {
  const html = `
    <meta content='Reversed title' property='og:title'>
    <meta content='Useful description' name='description'>
  `;

  assert.equal(extractMeta(html, 'og:title'), 'Reversed title');
  assert.equal(extractMeta(html, 'description'), 'Useful description');
});

test('static HTML byte decoding honors legacy Japanese HTTP and meta charsets', () => {
  const japaneseBytes = Buffer.from([
    0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x93, 0x57, 0x97, 0x97, 0x89, 0xef,
  ]);
  const metaEncoded = Buffer.concat([
    Buffer.from('<meta charset="Shift_JIS"><title>'),
    japaneseBytes,
    Buffer.from('</title>'),
  ]);

  assert.match(decodeHtmlResponseBytes(metaEncoded), /テスト展覧会/);
  assert.equal(
    decodeHtmlResponseBytes(japaneseBytes, 'text/html; charset=windows-31j'),
    'テスト展覧会',
  );
  assert.equal(
    decodeHtmlResponseBytes(Buffer.from('京都'), 'text/html; charset=unsupported-example'),
    '京都',
  );
});

test('source crawl hints preserve focused Crawl4AI wait and scrolling controls', () => {
  const source = applySourceOverride({
    slug: 'rendered-gallery',
    name: 'Rendered Gallery',
    taxonomy: testTaxonomy(['gallery']),
    crawl_hints: {
      render_mode: 'auto',
      wait_for: 'css:main .event-title',
      wait_for_images: false,
      scan_full_page: true,
    },
  });

  assert.deepEqual(source.crawl_hints, {
    render_mode: 'auto',
    wait_for: 'css:main .event-title',
    wait_for_images: false,
    scan_full_page: true,
  });
});

test('title quality rejects generic, source-name, and date-only values conservatively', () => {
  const source = { name: 'Example Gallery' };

  for (const title of [
    'NEWS & TOPICS',
    'Category: Current Exhibitions',
    'Exhibition Schedule',
    'Mail News',
    'Blog',
    'みどころ',
    '開催中の展覧会',
  ]) {
    assert.equal(hasValidEventTitle(assessEventTitle({ title }, source)), false, title);
  }

  assert.equal(
    hasValidEventTitle(assessEventTitle({ title: 'Current Exhibitions' }, source)),
    false,
  );
  assert.equal(hasValidEventTitle(assessEventTitle({ title: 'Example Gallery' }, source)), false);
  assert.equal(
    hasValidEventTitle(assessEventTitle({ title: 'July 11 – August 1, 2026' }, source)),
    false,
  );
  assert.equal(
    hasValidEventTitle(
      assessEventTitle({ title: 'Current Exhibition | Tokyo | July 11 – August 1, 2026' }, source),
    ),
    false,
  );
  assert.equal(
    hasValidEventTitle(assessEventTitle({ title: 'TOKYO ART BOOK FAIR 2026' }, source)),
    true,
  );
  assert.equal(
    hasValidEventTitle(assessEventTitle({ title: 'NEWS: Art and Journalism' }, source)),
    true,
  );
});

test('generic detail extraction prefers event and exhibition URLs', async () => {
  const listingHtml = await readFile(resolve(fixturesRoot, 'generic-listing.html'), 'utf8');
  const source = {
    allowed_domains: ['example.test'],
    event_page_patterns: ['/events/', '/exhibitions/'],
  };

  const urls = extractGenericDetailUrls(listingHtml, 'https://example.test/events/', source, 4);

  assert.deepEqual(urls, [
    'https://example.test/events/spring-show-2026/',
    'https://example.test/exhibitions/2026/quiet-forms/',
  ]);
});

test('generic detail extraction matches JCCAC-style query patterns', () => {
  const listingHtml = `
    <a href="/?a=doc&id=321">Exhibition detail</a>
    <a href="/?a=group&id=exhibition&page=2">Next listing page</a>
  `;
  const source = {
    allowed_domains: ['www.jccac.org.hk'],
    event_page_patterns: ['?a=doc&id='],
  };

  assert.deepEqual(
    extractGenericDetailUrls(
      listingHtml,
      'https://www.jccac.org.hk/?a=group&id=exhibition',
      source,
      4,
    ),
    ['https://www.jccac.org.hk/?a=doc&id=321'],
  );
});

test('generic detail extraction can use configured listing link selectors', () => {
  const listingHtml = `
    <main id="events">
      <a class="event-link" href="/events/selected/">Selected event</a>
      <a href="/about/">About</a>
    </main>
    <a class="event-link" href="/events/outside/">Outside selector</a>
  `;
  const source = {
    allowed_domains: ['example.test'],
    selectors: {
      listing_links: '#events a.event-link',
    },
  };

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://example.test/events/', source, 4),
    ['https://example.test/events/selected/'],
  );
});

test('Hong Kong Palace Museum discovery reads current official eventData records only', () => {
  const listingHtml = `
    <script>
      eventData['special'] = [
        {"url":"https://www.hkpm.org.hk/en/exhibition/current-special","end":"2099-10-19"},
        {"url":"https://www.hkpm.org.hk/en/exhibition/ended-special","end":"2000-01-01"}
      ];
      eventData['thematic'] = [
        {"url":"https://www.hkpm.org.hk/en/exhibition/current-thematic","end":"2099-11-23"}
      ];
      eventData['travelling'] = [
        {"url":"https://www.hkpm.org.hk/en/exhibition/offsite-show","end":"2099-12-31"}
      ];
    </script>
  `;

  assert.deepEqual(extractHongKongPalaceMuseumDetailUrls(listingHtml), [
    'https://www.hkpm.org.hk/en/exhibition/current-special',
    'https://www.hkpm.org.hk/en/exhibition/current-thematic',
  ]);

  const event = eventExtractors['hong-kong-palace-museum'](
    `<meta property="og:image" content="https://www.hkpm.org.hk/assets/img/og_image.jpg">
     <h1>Hong Kong Palace Museum | Heavenly Horses</h1>
     <span class="hkpm_label_tag" data-start="2026-03-20" data-end="2027-03-17"></span>
     <p>This exhibition presents masterpieces from the Palace Museum collection.</p>
     <img src="https://www.hkpm.org.hk/media/horse.jpg">
     <img src="https://www.hkpm.org.hk/files/record/exhibition/59/HKJC-new-logo-bi-lang--1760080418.jpg">
     <img src="https://www.hkpm.org.hk/files/record/exhibition/59/HKJC_YOTH_Iogo-1771569582.png">
     <img src="https://www.hkpm.org.hk/files/site/info/1/HKPM-MapThumbnail-480x270-1666322965.png">`,
    {
      name: 'Hong Kong Palace Museum',
      city: 'hong-kong',
      timezone: 'Asia/Hong_Kong',
      taxonomy: testTaxonomy(['museum'], ['painting'], ['exhibition']),
      skip_og_image: true,
    },
    'https://www.hkpm.org.hk/en/exhibition/heavenly-horses',
  );

  assert.equal(event.title, 'Heavenly Horses');
  assert.equal(event.start_date, '2026-03-20');
  assert.equal(event.end_date, '2027-03-17');
  assert.equal(event.calendar_starts_at, '2026-03-20T00:00:00+08:00');
  assert.deepEqual(event.image_urls, ['https://www.hkpm.org.hk/media/horse.jpg']);
});

test('Hong Kong image rules remove broken, duplicate, and poster media', async () => {
  const sources = await loadSourcesConfig({ city: 'hong-kong' });
  const sourceBySlug = new Map(sources.map((source) => [source.slug, source]));

  assert.equal(sourceBySlug.get('hong-kong-palace-museum').skip_og_image, true);

  const whiteCubeSource = sourceBySlug.get('white-cube-hong-kong');
  assert.equal(whiteCubeSource.base_url, 'https://www.whitecube.com/exhibitions/hong-kong');
  assert.deepEqual(
    extractGenericDetailUrls(
      `<nav>
         <a href="/exhibitions/paris">Paris</a>
         <a href="/exhibitions/offsite">Offsite</a>
       </nav>
       <main>
         <a href="/gallery-exhibitions/shigeo-otake-hong-kong-2026">Shigeo Otake</a>
       </main>`,
      whiteCubeSource.base_url,
      whiteCubeSource,
    ),
    ['https://www.whitecube.com/gallery-exhibitions/shigeo-otake-hong-kong-2026'],
  );

  const whiteCube = extractGenericEvent(
    `<h1>Shigeo Otake</h1>
     <time>10 July - 29 August 2026</time>
     <p>Useful exhibition description for White Cube Hong Kong.</p>
     <img src="https://white-cube.transforms.svdcdn.com/Flower-Girl.jpg?w=2360&amp;h=1770&amp;q=80">`,
    whiteCubeSource,
    'https://www.whitecube.com/gallery-exhibitions/shigeo-otake-hong-kong-2026',
  );
  assert.equal(
    whiteCube.primary_image_url,
    'https://white-cube.transforms.svdcdn.com/Flower-Girl.jpg?w=2360&h=1770&q=80',
  );

  const davidZwirner = extractGenericEvent(
    `<meta property="og:image" content="https://cdn.sanity.io/event.jpg?w=1200&amp;h=630">
     <h1>Dan Flavin: Grids</h1>
     <time>May 28 - September 12, 2026</time>
     <p>Useful exhibition description for David Zwirner Hong Kong.</p>
     <img src="https://cdn.sanity.io/event.jpg?w=3840">
     <img alt="Black background, no image" src="https://cdn.sanity.io/black-divider.jpg?w=3840">`,
    sourceBySlug.get('david-zwirner'),
    'https://www.davidzwirner.com/exhibitions/2026/dan-flavin-grids-hong-kong',
  );
  assert.deepEqual(davidZwirner.image_urls, ['https://cdn.sanity.io/event.jpg?w=3840']);

  const oiSource = sourceBySlug.get('oi-art-space');
  assert.equal(
    oiSource.base_url,
    'https://www.apo.hk/en/web/apo/here_projects_and_programmes.html',
  );
  const oi = eventExtractors['oi-art-space'](
    `<title _tag="common_meta_en">Art n GOs 3 — A Joyful Encounter with Intangible Cultural Heritage</title>
     <div class="social-intro"><p>
       This programme brings images by Hong Kong artists into everyday community life.
       Date：From 26.5.2026<br>
       Location：Tseung Kwan O Government Offices
     </p></div>
     <div id="oi-detail-banner"><div class="slider-items">
       <img class="d-none d-md-block" src="/image/apohere/first.jpg">
       <img class="d-none d-md-block" src="/image/apohere/second.jpg">
     </div></div>`,
    oiSource,
    'https://www.apo.hk/en/web/apo/here_art_n_gos3_joyful_encounter_with_ich.html',
  );
  assert.equal(oi.title, 'Art n GOs 3 — A Joyful Encounter with Intangible Cultural Heritage');
  assert.equal(oi.start_date, '2026-05-26');
  assert.equal(oi.end_date, null);
  assert.equal(oi.schedule_type, 'open_ended');
  assert.deepEqual(oi.occurrence_dates, []);
  assert.deepEqual(oi.schedule_segments, [
    { is_all_day: true, start_date: '2026-05-26', end_date: null },
  ]);
  assert.deepEqual(oi.image_urls, ['https://www.apo.hk/image/apohere/first.jpg']);

  const oiRange = eventExtractors['oi-art-space'](
    `<title>Art n GOs 2 — Living Heritage</title>
     <div class="social-intro"><p>
       This exhibition connects residents with art and culture in everyday life.
       Exhibition period: 1.6.2024 – 24.10.2026
     </p></div>
     <div id="oi-detail-banner"><div class="slider-items">
       <img class="d-none d-md-block" src="/image/apohere/living-heritage.jpg">
     </div></div>`,
    oiSource,
    'https://www.apo.hk/en/web/apo/here_art_n_gos_living_heritage.html',
  );
  assert.equal(oiRange.start_date, '2024-06-01');
  assert.equal(oiRange.end_date, '2026-10-24');
  assert.equal(oiRange.schedule_type, 'range');

  const oiOnward = eventExtractors['oi-art-space'](
    `<title>Art n GOs — Transience</title>
     <div class="social-intro">
       <p>This public artwork explores change in everyday life.</p>
       <p>Exhibition period: 6.5.2021 onward</p>
     </div>
     <div id="oi-detail-banner"><div class="slider-items">
       <img class="d-none d-md-block" src="/image/apohere/transience.jpg">
     </div></div>`,
    oiSource,
    'https://www.apo.hk/en/web/apo/art_n_gos_transience.html',
  );
  assert.equal(oiOnward.start_date, '2021-05-06');
  assert.equal(oiOnward.end_date, null);
  assert.equal(oiOnward.schedule_type, 'open_ended');
  assert.deepEqual(oiOnward.occurrence_dates, []);

  const whitestone = extractGenericEvent(
    `<meta property="og:image" content="http://www.whitestone-gallery.com/poster.jpg">
     <h1>Becoming Her</h1>
     <time>2026.07.11 - 08.15</time>
     <p>Useful exhibition description for Whitestone Gallery Hong Kong.</p>
     <img class="wsg-gallery-exhibition-main-visual__img-desktop" src="https://cdn.shopify.com/hero.jpg">
     <div class="wsg-gallery-exhibition-article__article"><p><img src="https://cdn.shopify.com/artwork.jpg"></p></div>`,
    sourceBySlug.get('whitestone-gallery-hong-kong'),
    'https://www.whitestone-gallery.com/blogs/gallery-exhibitions/hk-becoming-her-072026',
  );
  assert.deepEqual(whitestone.image_urls, [
    'https://cdn.shopify.com/hero.jpg',
    'https://cdn.shopify.com/artwork.jpg',
  ]);

  const duMonde = eventExtractors['galerie-du-monde'](
    `<meta property="og:image" content="https://static-assets.artlogic.net/artwork.jpg">
     <h1>Tang Chang - Into the Heart-Mind</h1>
     <time>4 Jun - 29 Aug 2026</time>
     <p>Useful exhibition description for Galerie du Monde Hong Kong.</p>
     <img src="https://static-assets.artlogic.net/poster.jpg" width="500" height="500">`,
    sourceBySlug.get('galerie-du-monde'),
    'https://galeriedumonde.com/exhibitions/104-tang-chang/overview/',
  );
  assert.deepEqual(duMonde.image_urls, ['https://static-assets.artlogic.net/artwork.jpg']);

  const duMondePosterOnly = eventExtractors['galerie-du-monde'](
    `<h1>Poster-only exhibition</h1>
     <time>4 Jun - 29 Aug 2026</time>
     <p>Useful exhibition description for Galerie du Monde Hong Kong.</p>
     <img src="https://static-assets.artlogic.net/poster.jpg" width="500" height="500">`,
    sourceBySlug.get('galerie-du-monde'),
    'https://galeriedumonde.com/exhibitions/105-poster-only/overview/',
  );
  assert.equal(duMondePosterOnly.primary_image_url, null);
  assert.deepEqual(duMondePosterOnly.image_urls, []);
});

test('M+ keeps current and upcoming exhibitions with exact title and schedule', async () => {
  const source = (await loadSourcesConfig({ city: 'hong-kong' })).find(
    (candidate) => candidate.slug === 'm-plus',
  );
  const listingUrl = 'https://www.mplus.org.hk/en/exhibitions/';
  const listingHtml = `
    <div id="current">
      <a href="/en/exhibitions/current-show/" class="CommonExhibitionsItem current">Current</a>
    </div>
    <div id="future">
      <a href="/en/exhibitions/upcoming-show/" class="CommonExhibitionsItem">Upcoming</a>
    </div>
    <div id="online">
      <a href="/en/exhibitions/online-show/" class="CommonExhibitionsItem online">Online</a>
    </div>
    <div id="past">
      <a href="/en/exhibitions/past-show/" class="CommonExhibitionsItem past">Past</a>
    </div>`;

  assert.equal(source?.beta, false);
  assert.equal(source?.crawl_hints?.max_detail_pages, 30);
  assert.deepEqual(extractMplusDetailUrls(listingHtml, listingUrl), [
    'https://www.mplus.org.hk/en/exhibitions/current-show/',
    'https://www.mplus.org.hk/en/exhibitions/upcoming-show/',
  ]);

  const event = extractMplusEvent(
    `<main>
       <h1><span class="CommonTitleColors-titleMain">M+ Sigg Collection:<br>Inner Worlds</span></h1>
       <span class="CommonTitleColors-titleAlternative">M+希克藏品：心靈圖景</span>
       <div class="CommonDetails-title">27 Jun 2025<br>Ongoing</div>
       <p>This exhibition provides an in-depth perspective on contemporary Chinese art and its emotional expression.</p>
       <meta property="og:image" content="https://www.mplus.org.hk/api/images/10190/width-1200|format-png/">
     </main>`,
    source,
    'https://www.mplus.org.hk/en/exhibitions/m-sigg-collection-inner-worlds/',
  );

  assert.equal(event.title, 'M+ Sigg Collection: Inner Worlds');
  assert.equal(event.date_text, '27 Jun 2025 - Ongoing');
  assert.equal(event.start_date, '2025-06-27');
  assert.equal(event.end_date, null);
  assert.equal(event.schedule_type, 'open_ended');
  assert.deepEqual(event.schedule_segments, [
    { is_all_day: true, start_date: '2025-06-27', end_date: null },
  ]);
});

test('Asia Society skips its upcoming landing page masquerading as an exhibition', async () => {
  const sources = await loadSourcesConfig({ city: 'hong-kong' });
  const source = sources.find((candidate) => candidate.slug === 'asia-society-hong-kong');
  const listingHtml = `
    <a href="/hong-kong/exhibitions/upcoming">Plan Your Visit</a>
    <a href="/hong-kong/exhibitions/singing-and-dancing-brush-and-ink-art-wesley-tongson">Exhibition</a>`;

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://asiasociety.org/hong-kong/exhibitions', source),
    [
      'https://asiasociety.org/hong-kong/exhibitions/singing-and-dancing-brush-and-ink-art-wesley-tongson',
    ],
  );
});

test('Para Site rejects ended exhibitions before persistence', () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'para-site' },
      { start_date: '2000-01-01', end_date: '2000-01-02', timezone: 'Asia/Hong_Kong' },
    ),
    'past event',
  );
});

test('JPS discovery keeps only current Hong Kong exhibition cards', () => {
  const listingHtml = `
    <a class="exhibition-item UPCOMING" href="/exhibition/runway-51/">
      <p class="exhibition-location">Hong Kong</p>
    </a>
    <a class="exhibition-item CURRENT" href="/exhibition/tokyo-show/">
      <p class="exhibition-location">Tokyo</p>
    </a>
    <a class="exhibition-item PAST" href="/exhibition/old-hong-kong-show/">
      <p class="exhibition-location">Hong Kong</p>
    </a>`;

  assert.deepEqual(
    detailUrlExtractors['jps-gallery-hong-kong'](
      listingHtml,
      'https://jpsgallery.com/exhibitions/',
    ),
    ['https://jpsgallery.com/exhibition/runway-51/'],
  );
});

test('Villepin discovery stops before past exhibitions', () => {
  const listingHtml = `
    <p>Current Exhibitions</p>
    <div class="image-caption"><a href="/as-the-ground-holds">Current</a></div>
    <p>Past Exhibitions</p>
    <div class="image-caption"><a href="/ted-gahl-roam">Past</a></div>`;

  assert.deepEqual(
    detailUrlExtractors.villepin(listingHtml, 'https://www.villepinart.com/exhibitions'),
    ['https://www.villepinart.com/as-the-ground-holds'],
  );
});

test('10 Chancery Lane discovery stays inside current exhibitions', () => {
  const listingHtml = `
    <div id="exhibitions-grid-current">
      <a href="/exhibitions/195-current/overview/">Current</a>
    </div>
    <div id="exhibitions-grid-past">
      <a href="/exhibitions/194-past/overview/">Past</a>
    </div>`;

  assert.deepEqual(
    detailUrlExtractors['10-chancery-lane-gallery'](
      listingHtml,
      'https://www.10chancerylanegallery.com/exhibitions/',
    ),
    ['https://www.10chancerylanegallery.com/exhibitions/195-current/overview/'],
  );
});

test('Galerie du Monde rejects Taipei exhibitions', () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'galerie-du-monde' },
      { title: 'Text in the Room, Deferred : gdm Taipei' },
    ),
    'title contains Taipei',
  );
});

test('Asia Art Archive keeps only the first event image', async () => {
  const sources = await loadSourcesConfig({ city: 'hong-kong' });
  const source = sources.find((candidate) => candidate.slug === 'asia-art-archive');
  const event = eventExtractors[source.slug](
    `<h1>Hong Kong Conversations 2026</h1>
     <time>10 July - 12 September 2026</time>
     <p>An exhibition drawing from Asia Art Archive collections and research.</p>
     <img src="/media/programmes/first.jpg">
     <img src="/media/programmes/second.jpg">`,
    source,
    'https://aaa.org.hk/en/programmes/programmes/hong-kong-conversations-2026',
  );

  assert.equal(event.primary_image_url, 'https://aaa.org.hk/media/programmes/first.jpg');
  assert.deepEqual(event.image_urls, ['https://aaa.org.hk/media/programmes/first.jpg']);
});

test('Sin Sin rejects ended exhibitions', () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'sin-sin-fine-art' },
      { start_date: '2025-01-01', end_date: '2025-01-31', timezone: 'Asia/Hong_Kong' },
    ),
    'past event',
  );
});

test('Sin Sin uses the listing poster as its only event image', async () => {
  const sources = await loadSourcesConfig({ city: 'hong-kong' });
  const source = sources.find((candidate) => candidate.slug === 'sin-sin-fine-art');
  const detailUrl = 'https://www.sinsinfineart.com/2026/form/index.html';
  const event = eventExtractors['sin-sin-fine-art'](
    `<h1>FORM</h1>
     <time>10 July - 12 September 2026</time>
     <p>A group exhibition at Sin Sin Fine Art in Wong Chuk Hang.</p>
     <img src="images/SSFA202607-form-Header.jpg">
     <img src="images/detail-artwork.jpg">`,
    source,
    detailUrl,
    {
      listingPages: [
        {
          url: 'https://www.sinsinfineart.com/exhibitions.html',
          html: `<p class="td-exhibitions">
            <a href="2026/form/index.html"><img src="2026/form/images/SSFA202607-form-Poster.jpg"></a>
            <a href="2026/form/index.html"><span class="showtitle">FORM</span></a>
          </p>`,
        },
      ],
    },
  );

  const posterUrl = 'https://www.sinsinfineart.com/2026/form/images/SSFA202607-form-Poster.jpg';
  assert.equal(source?.measure_image_dimensions, true);
  assert.equal(event.primary_image_url, posterUrl);
  assert.deepEqual(event.image_urls, [posterUrl]);
});

test('Kiang Malingue keeps only Hong Kong exhibition cards and parses short dates', () => {
  const listingHtml = `
    <article class="Archive-entry Archive-entry--full">
      <a href="/exhibitions/hong-kong-show/"><h2>Hong Kong Show</h2><p>10 Sik On Street, Wanchai, Hong Kong</p></a>
    </article>
    <article class="Archive-entry Archive-entry--full">
      <a href="/exhibitions/new-york-show/"><h2>New York Show</h2><p>50 Eldridge Street, New York, NY 10002</p></a>
    </article>`;

  assert.deepEqual(
    detailUrlExtractors['kiang-malingue'](listingHtml, 'https://kiangmalingue.com/exhibitions/'),
    ['https://kiangmalingue.com/exhibitions/hong-kong-show/'],
  );

  const event = eventExtractors['kiang-malingue'](
    `<h1 class="Page-title">Dwelling in Mirrors</h1>
     <p>[26.06.26 – 22.08.26]</p>
     <p class="p1">Kiang Malingue presents a solo exhibition at its Hong Kong location.</p>
     <main class="Page"><img src="https://kiangmalingue.com/show.jpg"></main>`,
    {
      name: 'Kiang Malingue Hong Kong',
      city: 'hong-kong',
      timezone: 'Asia/Hong_Kong',
      taxonomy: testTaxonomy(['gallery'], ['contemporary'], ['exhibition']),
      selectors: {
        title: '.Page-title',
        description: 'p.p1',
        images: 'main.Page img',
      },
    },
    'https://kiangmalingue.com/exhibitions/dwelling-in-mirrors/',
  );

  assert.equal(event.start_date, '2026-06-26');
  assert.equal(event.end_date, '2026-08-22');
  assert.equal(event.calendar_starts_at, '2026-06-26T00:00:00+08:00');
});

test('generic detail extraction ignores taxonomy archive URLs', () => {
  const listingHtml = `
    <a href="/blog/categories/current-exhibitions/">Current exhibitions</a>
    <a href="/exhibitions/quiet-forms/">Quiet Forms</a>
  `;
  const source = {
    allowed_domains: ['example.test'],
    event_page_patterns: ['/blog/', '/exhibitions/'],
  };

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://example.test/exhibitions/', source, 4),
    ['https://example.test/exhibitions/quiet-forms/'],
  );
});

test('Art Collaboration Kyoto keeps its theme-hosted OG image', () => {
  const event = eventExtractors['art-collaboration-kyoto'](
    `
      <meta property="og:image" content="/en/wp-content/themes/Art-Collaboration-Kyoto/assets/images/ogimg.png">
      <h2 class="m-item_heading">Dates</h2>
      <div class="m-item_body"><p>Sat. November 7−Mon. 9, 2026</p></div>
    `,
    { name: 'Art Collaboration Kyoto' },
    'https://a-c-k.jp/en/',
  );

  assert.equal(
    event.primary_image_url,
    'https://a-c-k.jp/en/wp-content/themes/Art-Collaboration-Kyoto/assets/images/ogimg.png',
  );
});

test('Osaka Geidai keeps art exhibition links and first event image only', async () => {
  const listingHtml = `
    <ul>
      <li><a href="/whatsnew/art-a">アート・展覧会 2026.05.26 茂本ヒデキチ 墨絵個展</a></li>
      <li><a href="/whatsnew/award-a">受賞 2026.05.18 ロゴマーク</a></li>
      <li><a href="/whatsnew/art-b">アート・展覧会 2026.05.15 ONOCO個展</a></li>
    </ul>
  `;

  assert.deepEqual(
    detailUrlExtractors['osaka-geidai-whatsnew'](
      listingHtml,
      'https://www.osaka-geidai.ac.jp/whatsnew',
    ),
    [
      'https://www.osaka-geidai.ac.jp/whatsnew/art-a',
      'https://www.osaka-geidai.ac.jp/whatsnew/art-b',
    ],
  );

  const sources = await loadSourcesConfig({ city: 'osaka' });
  const source = sources.find((item) => item.slug === 'osaka-geidai-whatsnew');
  const event = eventExtractors[source.slug](
    `<title>Collection Exhibition | Osaka University of Arts</title>
     <p>2026.06.03 - 2026.11.24</p>
     <img src="https://www.osaka-geidai.ac.jp/images/first.jpg" width="1200" height="800">
     <img src="https://www.osaka-geidai.ac.jp/images/second.jpg" width="1200" height="800">`,
    source,
    'https://www.osaka-geidai.ac.jp/whatsnew/collection-exhibition',
  );

  assert.equal(source.beta, false);
  assert.deepEqual(event.image_urls, ['https://www.osaka-geidai.ac.jp/images/first.jpg']);
});

test('Abeno Harukas keeps event title and media outside site chrome', async () => {
  const sources = await loadSourcesConfig({ city: 'osaka' });
  const source = sources.find((item) => item.slug === 'abeno-harukas-art-museum');
  const event = extractGenericEvent(
    `<title>Van Gogh Exhibition | Abeno Harukas Art Museum</title>
     <div class="exhibition clearfix">
       <div class="figure"><img src="/exhibition/future/wallraf/images/img_wallraf.jpg"></div>
       <div class="detail">
         <p itemprop="name" class="name"><span>Van Gogh Exhibition</span><br><span>Wallraf-Richartz Museum Collection</span></p>
         <p>July 4, 2026 - September 9, 2026</p>
       </div>
     </div>
     <div id="ticket">
       <img src="/exhibition/future/wallraf/images/ticket_set-gogh.png">
     </div>`,
    source,
    'https://www.aham.jp/exhibition/future/wallraf/',
  );

  assert.equal(source?.selectors?.title, 'p.name[itemprop="name"]');
  assert.equal(source?.selectors?.images, '.exhibition .figure img');
  assert.equal(event.title, 'Van Gogh Exhibition Wallraf-Richartz Museum Collection');
  assert.equal(event._title_origin, 'configured_selector');
  assert.deepEqual(event.image_urls, [
    'https://www.aham.jp/exhibition/future/wallraf/images/img_wallraf.jpg',
  ]);
});

test('NAKKA extraction keeps only the first event image', () => {
  const source = {
    slug: 'nakanoshima-museum-of-art-osaka',
    name: 'Nakanoshima Museum of Art',
    taxonomy: testTaxonomy(['museum'], [], ['exhibition']),
  };
  const event = eventExtractors[source.slug](
    `<title>Current Exhibition | NAKKA</title>
     <p>2026.07.01 - 2026.09.30</p>
     <img src="https://nakka-art.jp/images/first.jpg" width="1200" height="800">
     <img src="https://nakka-art.jp/images/second.jpg" width="1200" height="800">`,
    source,
    'https://nakka-art.jp/en/exhibition-post/current-exhibition/',
  );

  assert.deepEqual(event.image_urls, ['https://nakka-art.jp/images/first.jpg']);
});

test('Yoshimi Arts reads parenthesized-weekday dates after feature image', () => {
  const event = extractGenericEvent(
    `<title>Shigeru Izumi－Print Collection | Yoshimi Arts</title>
     <img src="https://www.yoshimiarts.com/exhibition/photo2026/Izumi-PrintCollection.jpg" width="600" height="800">
     <p><strong>Shigeru Izumi－Print Collection</strong><br>
     Jul 11 (sat) - Aug 2 (sun), 2026<br>12:00-19:00</p>`,
    {
      slug: 'yoshimi-arts',
      name: 'Yoshimi Arts',
      taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
    },
    'https://www.yoshimiarts.com/en/exhibition/20260711_Shigeru_Izumi-Print_Collection.html',
  );

  assert.equal(event.start_date, '2026-07-11');
  assert.equal(event.end_date, '2026-08-02');
});

test('Hyogo annual schedule keeps ongoing and upcoming cards only', () => {
  const year = Number(currentYearInTokyo());
  const html = `
    <h2>${year}年 年間スケジュール</h2>
    <div class="exhibition-item">
      <img src="https://www.artm.pref.hyogo.jp/past.jpg" width="800" height="600">
      <h3 class="exhibition-title">終了展</h3>
      <span class="exhibition-date">1月1日-1月2日</span>
    </div>
    <div class="exhibition-item">
      <img src="https://www.artm.pref.hyogo.jp/current.jpg" width="800" height="600">
      <h3 class="exhibition-title">開催中展<span class="exhibition-subtitle">Current</span></h3>
      <span class="exhibition-date">1月1日-12月31日</span>
      <div class="exhibition-body"><p>Current exhibition description.</p></div>
    </div>
    <div class="exhibition-item">
      <img src="https://www.artm.pref.hyogo.jp/upcoming.jpg" width="800" height="600">
      <h3 class="exhibition-title">次回展</h3>
      <span class="exhibition-date">12月17日-${year + 1}年2月23日</span>
    </div>
  `;
  const source = {
    slug: 'hyogo-prefectural-museum-of-art',
    name: 'Hyogo Prefectural Museum of Art',
    taxonomy: testTaxonomy(['museum'], [], ['exhibition']),
  };
  const listingUrl = 'https://www.artm.pref.hyogo.jp/exhibition/';
  const urls = detailUrlExtractors[source.slug](html, listingUrl);

  assert.deepEqual(urls, [`${listingUrl}#exhibition-1`, `${listingUrl}#exhibition-2`]);

  const events = urls.map((url) => eventExtractors[source.slug](html, source, url));
  const event = events[1];
  assert.deepEqual(
    events.map((candidate) => candidate.external_id),
    ['exhibition-1', 'exhibition-2'],
  );
  assert.equal(new Set(events.map(buildEventDedupeKey)).size, 2);
  assert.equal(event.title, '次回展');
  assert.equal(event.start_date, `${year}-12-17`);
  assert.equal(event.end_date, `${year + 1}-02-23`);
  assert.deepEqual(event.image_urls, ['https://www.artm.pref.hyogo.jp/upcoming.jpg']);
});

test('Hitoto uses current/upcoming listing and ordered detail fields', async () => {
  const sources = await loadSourcesConfig({ city: 'osaka' });
  const source = sources.find((item) => item.slug === 'hitoto');
  const listingHtml = `
    <main>
      <article><h2 class="entry-title"><a href="https://hitoto.info/pictogram/">Pictogram</a></h2></article>
      <a href="https://hitoto.info/past-exhibition/">Past exhibitions</a>
    </main>
  `;
  const detailHtml = `
    <article>
      <div class="detail_thumb"><div class="post-thumbnail">
        <img src="https://hitoto.info/blog/wp-content/pictogram.jpg" width="920" height="517">
      </div></div>
      <article class="detail_txt">
        <h1 class="entry-title">西本良太「ピクトグラム」</h1>
        <p class="entry-period_time">2026.7.11（土）〜8.1（土）13:00-19:00</p>
        <section class="entry-content"><p>hitotoで初めてとなる木工作家の個展です。</p></section>
      </article>
    </article>
  `;
  const urls = extractGenericDetailUrls(listingHtml, source.start_urls[0], source);
  const event = extractGenericEvent(detailHtml, source, urls[0]);

  assert.deepEqual(source.start_urls, ['https://hitoto.info/next-exhibition/']);
  assert.deepEqual(urls, ['https://hitoto.info/pictogram/']);
  assert.equal(event.title, '西本良太「ピクトグラム」');
  assert.equal(event.start_date, '2026-07-11');
  assert.equal(event.end_date, '2026-08-01');
  assert.equal(event.description, 'hitotoで初めてとなる木工作家の個展です。');
  assert.deepEqual(event.image_urls, ['https://hitoto.info/blog/wp-content/pictogram.jpg']);
});

test('Tezukayama follows status cards and keeps full gallery images', async () => {
  const sources = await loadSourcesConfig({ city: 'osaka' });
  const source = sources.find((item) => item.slug === 'tezukayama-gallery');
  const listingHtml = `
    <article class="p-archive-event-item">
      <a href="https://www.tezukayama-g.com/exhibition/ten-years-of-thunder" class="p-archive-event-item__container">Exhibition</a>
    </article>
  `;
  const detailHtml = `
    <header class="p-event-header">
      <img src="https://www.tezukayama-g.com/hero.jpg">
      <h1 class="p-event-header__title">アーカイブ展：雷鳴の十年</h1>
      <p class="p-event-header__period">2026.7.4 Sat - 2026.8.1 Sat</p>
    </header>
    <div class="p-event-intro"><div class="p-event-intro__summery"><p>展覧会の説明です。</p></div></div>
    <div class="p-event-gallery">
      <a class="c-image-gallery-item" href="https://www.tezukayama-g.com/gallery-1-full.jpg"><img src="https://www.tezukayama-g.com/gallery-1-thumb.jpg"></a>
      <a class="c-image-gallery-item" href="https://www.tezukayama-g.com/gallery-2-full.jpg"><img src="https://www.tezukayama-g.com/gallery-2-thumb.jpg"></a>
    </div>
  `;
  const urls = extractGenericDetailUrls(listingHtml, source.start_urls[0], source);
  const event = eventExtractors[source.slug](detailHtml, source, urls[0]);

  assert.deepEqual(source.start_urls, [
    'https://www.tezukayama-g.com/exhibitions/status/current',
    'https://www.tezukayama-g.com/exhibitions/status/future',
  ]);
  assert.deepEqual(urls, ['https://www.tezukayama-g.com/exhibition/ten-years-of-thunder']);
  assert.equal(event.title, 'アーカイブ展：雷鳴の十年');
  assert.equal(event.start_date, '2026-07-04');
  assert.equal(event.end_date, '2026-08-01');
  assert.equal(event.description, '展覧会の説明です。');
  assert.deepEqual(event.image_urls, [
    'https://www.tezukayama-g.com/gallery-1-full.jpg',
    'https://www.tezukayama-g.com/gallery-2-full.jpg',
  ]);
});

test('generic listing selectors support common attribute filters', () => {
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
    allowed_domains: ['example.test'],
    selectors: {
      listing_links: '[class*="archive"] a[href*="/exhibitions/"][href$="/overview/"]',
    },
  };

  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://example.test/exhibitions/', source, 4),
    [
      'https://example.test/exhibitions/kyoto-show/overview/',
      'https://example.test/exhibitions/osaka-show/overview/',
    ],
  );
});

test('21_21 detail extraction keeps linked current and upcoming program pages', () => {
  const programHtml = `
    <section>
      <div class="cntTtl">
        <h3>CURRENT PROGRAM</h3>
        <a href="/en/program/soup/">Soup as Life</a>
      </div>
      <section id="NextProgram">
        <h3>UPCOMING PROGRAM</h3>
        <a href="/en/program/hojoki/">Learning from Hojoki</a>
        <p>Theme: "Time"</p>
      </section>
      <section id="About">
        <a href="/en/program/leasing/">Facility leasing</a>
      </section>
      <section id="PrevProgram">
        <a href="/en/program/2121/">Past program</a>
      </section>
    </section>
  `;
  const galleryHtml = `
    <section>
      <div class="cntTtl">
        <h3>ギャラリー3</h3>
        <a href="/gallery3/gaudi_window/">ガウディ：未来をひらく窓</a>
      </div>
      <section id="About">
        <a href="/gallery3/leasing/">ギャラリー3について</a>
      </section>
      <section id="PrevProgram">
        <a href="/gallery3/210825_kogei/">過去のプログラム</a>
      </section>
    </section>
  `;

  assert.deepEqual(
    detailUrlExtractors['21-21-design-sight'](
      programHtml,
      'https://www.2121designsight.jp/en/program/',
    ),
    [
      'https://www.2121designsight.jp/en/program/soup/',
      'https://www.2121designsight.jp/en/program/hojoki/',
    ],
  );
  assert.deepEqual(
    detailUrlExtractors['21-21-design-sight'](
      galleryHtml,
      'https://www.2121designsight.jp/gallery3/',
    ),
    ['https://www.2121designsight.jp/gallery3/gaudi_window/'],
  );
});

test('21_21 source-specific extraction reads all configured listing pages', () => {
  const listingPages = [
    {
      url: 'https://www.2121designsight.jp/en/program/',
      html: `
        <article class="mainArea">
          <a href="/en/program/soup/">Soup as Life</a>
          <a href="/en/program/hojoki/">Learning from Hojoki</a>
          <section id="PrevProgram"><a href="/en/program/2121/">Past</a></section>
        </article>
      `,
    },
    {
      url: 'https://www.2121designsight.jp/en/gallery3/',
      html: `
        <article class="mainArea">
          <a href="/en/gallery3/gaudi_window/">Gaudi</a>
          <section id="About"><a href="/en/gallery3/leasing/">About</a></section>
        </article>
      `,
    },
  ];

  assert.deepEqual(
    extractSourceSpecificDetailUrls(detailUrlExtractors['21-21-design-sight'], listingPages, {
      slug: '21-21-design-sight',
    }),
    [
      'https://www.2121designsight.jp/en/program/soup/',
      'https://www.2121designsight.jp/en/program/hojoki/',
      'https://www.2121designsight.jp/en/gallery3/gaudi_window/',
    ],
  );
});

test('21_21 event extraction reads definition-list title and date rows', () => {
  const source = {
    name: '21_21 DESIGN SIGHT',
    taxonomy: testTaxonomy(['museum'], ['design'], ['exhibition']),
    address_text: 'Tokyo Midtown, Tokyo',
  };
  const programEvent = eventExtractors['21-21-design-sight'](
    `
      <meta property="og:image" content="https://www.2121designsight.jp/en/program/soup/topweb.jpg">
      <title>21_21 DESIGN SIGHT</title>
      <dl>
        <dt><span>Title</span></dt>
        <dd><strong>Exhibition "Soup as Life"</strong></dd>
        <dt><span>Date</span></dt>
        <dd><strong>March 27 (Fri.) - August 9 (Sun.), 2026</strong></dd>
      </dl>
    `,
    source,
    'https://www.2121designsight.jp/en/program/soup/',
  );
  const upcomingProgramEvent = eventExtractors['21-21-design-sight'](
    `
      <title>21_21 DESIGN SIGHT</title>
      <dl>
        <dt><span>Title</span></dt>
        <dd><strong>Learning from 'Hōjōki': Tiny Architecture Reweaves Life</strong></dd>
        <dt><span>Date</span></dt>
        <dd><strong>August 28 (Fri.), 2026 - January 11 (Mon.), 2027</strong></dd>
      </dl>
    `,
    source,
    'https://www.2121designsight.jp/en/program/hojoki/',
  );
  const galleryEvent = eventExtractors['21-21-design-sight'](
    `
      <meta property="og:image" content="https://www.2121designsight.jp/gallery3/gaudi_window/topweb.jpg">
      <title>21_21 DESIGN SIGHT</title>
      <div class="cntTtl"><h3>ガウディ：未来をひらく窓</h3></div>
      <dl>
        <dt><span>会期</span></dt>
        <dd><strong>2026年5月16日（土） - 2026年7月12日（日）</strong></dd>
      </dl>
    `,
    source,
    'https://www.2121designsight.jp/gallery3/gaudi_window/',
  );

  assert.equal(programEvent.title, 'Exhibition "Soup as Life"');
  assert.equal(programEvent.date_text, 'March 27 (Fri.) - August 9 (Sun.), 2026');
  assert.equal(programEvent.start_date, '2026-03-27');
  assert.equal(programEvent.end_date, '2026-08-09');
  assert.equal(upcomingProgramEvent.start_date, '2026-08-28');
  assert.equal(upcomingProgramEvent.end_date, '2027-01-11');
  assert.equal(galleryEvent.title, 'ガウディ：未来をひらく窓');
  assert.equal(galleryEvent.date_text, '2026年5月16日（土） - 2026年7月12日（日）');
  assert.equal(galleryEvent.start_date, '2026-05-16');
  assert.equal(galleryEvent.end_date, '2026-07-12');
});

test('21_21 source config uses only the second exhibition photo', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === '21-21-design-sight');
  const event = eventExtractors[source.slug](
    `
      <meta property="og:image" content="https://www.2121designsight.jp/en/program/soup/header.jpg">
      <title>21_21 DESIGN SIGHT</title>
      <img src="/assets2017/common/imgs/img_symbol.png" alt="">
      <img src="/en/program/soup/header.jpg" alt="museum exterior">
      <img src="/en/program/soup/topweb.jpg" alt="Soup as Life">
      <img src="/assets2017/common/imgs/icn_x.svg" alt="">
      <dl>
        <dt><span>Title</span></dt>
        <dd><strong>Exhibition "Soup as Life"</strong></dd>
        <dt><span>Date</span></dt>
        <dd><strong>March 27 (Fri.) - August 9 (Sun.), 2026</strong></dd>
      </dl>
    `,
    source,
    'https://www.2121designsight.jp/en/program/soup/',
  );

  assert.equal(
    event.primary_image_url,
    'https://www.2121designsight.jp/en/program/soup/topweb.jpg',
  );
  assert.deepEqual(event.image_urls, ['https://www.2121designsight.jp/en/program/soup/topweb.jpg']);
});

test('SCAI detail extraction keeps each location current and upcoming links', () => {
  const listingHtml = `
    <li class="dropdown-submenu">
      <a href="#" class="dropdown-toggle" data-toggle="dropdown">SCAI THE BATHHOUSE</a>
      <ul class="dropdown-menu">
        <li><a href="/data/exhibitions/../../en/exhibitions/2026/05/bathhouse-current/">Current</a></li>
        <li><a href="/data/exhibitions/../../en/exhibitions/2026/08/bathhouse-upcoming/">Upcoming</a></li>
        <li><a href="/en/exhibitions/past/">Past</a></li>
      </ul>
    </li>
    <li class="dropdown-submenu">
      <a href="#" class="dropdown-toggle" data-toggle="dropdown">SCAI PIRAMIDE</a>
      <ul class="dropdown-menu">
        <li><a href="/data/exhibitions/../../en/exhibitions/2026/05/piramide-current/">Current</a></li>
        <li><span>Upcoming</span></li>
        <li><a href="/en/exhibitions/piramide/">Past</a></li>
      </ul>
    </li>
    <li class="dropdown-submenu">
      <a href="#" class="dropdown-toggle" data-toggle="dropdown">SCAI PARK</a>
      <ul class="dropdown-menu">
        <li><a href="/data/exhibitions/../../ja/exhibitions/2026/04/park-current/">現在の企画展</a></li>
        <li><span>次回の企画展</span></li>
        <li><a href="/ja/exhibitions/park/">過去の企画展</a></li>
      </ul>
    </li>
  `;

  assert.deepEqual(
    detailUrlExtractors['scai-the-bathhouse'](listingHtml, 'https://www.scaithebathhouse.com/en/'),
    [
      'https://www.scaithebathhouse.com/en/exhibitions/2026/05/bathhouse-current/',
      'https://www.scaithebathhouse.com/en/exhibitions/2026/08/bathhouse-upcoming/',
    ],
  );
  assert.deepEqual(
    detailUrlExtractors['scai-piramide'](listingHtml, 'https://www.scaithebathhouse.com/en/'),
    ['https://www.scaithebathhouse.com/en/exhibitions/2026/05/piramide-current/'],
  );
  assert.deepEqual(
    detailUrlExtractors['scai-park'](listingHtml, 'https://www.scaithebathhouse.com/ja/'),
    ['https://www.scaithebathhouse.com/ja/exhibitions/2026/04/park-current/'],
  );
});

test('SCAI event extraction reads title dates and open-ended current shows', () => {
  const source = {
    name: 'SCAI Park',
    taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
    address_text: 'TERRADA Art Complex I 5F, Tokyo',
  };
  const standardEvent = eventExtractors['scai-the-bathhouse'](
    `
      <meta property="og:image" content="https://www.scaithebathhouse.com/data/exhibitions/show.jpg">
      <img src="https://www.scaithebathhouse.com/data/exhibitions/show-duplicate.jpg" alt="">
      <img src="https://www.scaithebathhouse.com/data/exhibitions/show-poster.jpg" alt="">
      <div class="title_info">
        <h1>Lee Ufan：Work on Paper / Sculpture</h1>
        <div class="duration">Tuesday, 4 August – Saturday, 10 October, 2026</div>
      </div>
    `,
    source,
    'https://www.scaithebathhouse.com/en/exhibitions/2026/08/lee_ufan_work_on_paper_sculpture/',
  );
  const openEndedEvent = eventExtractors['scai-park'](
    `
      <meta property="og:image" content="https://www.scaithebathhouse.com/data/exhibitions/park.jpg">
      <div class="title_info">
        <h1>#46 Daniel Buren, Yuji Takeoka, Reijiro Wada</h1>
        <div class="duration">Thu. 9 April -</div>
      </div>
    `,
    source,
    'https://www.scaithebathhouse.com/en/exhibitions/2026/04/46_daniel_buren_yuji_takeoka_reijiro_wada/',
  );

  assert.equal(standardEvent.title, 'Lee Ufan：Work on Paper / Sculpture');
  assert.equal(standardEvent.start_date, '2026-08-04');
  assert.equal(standardEvent.end_date, '2026-10-10');
  assert.equal(
    standardEvent.primary_image_url,
    'https://www.scaithebathhouse.com/data/exhibitions/show.jpg',
  );
  assert.deepEqual(standardEvent.image_urls, [
    'https://www.scaithebathhouse.com/data/exhibitions/show.jpg',
  ]);
  assert.equal(openEndedEvent.title, '#46 Daniel Buren, Yuji Takeoka, Reijiro Wada');
  assert.equal(openEndedEvent.start_date, '2026-04-09');
  assert.equal(openEndedEvent.end_date, null);
});

test('Kyocera detail extraction finds Japanese default URLs', () => {
  const extractKyoceraDetailUrls = detailUrlExtractors['kyoto-city-kyocera-museum-of-art'];
  const listingHtml = `
    <a href="/exhibition/20260310-20260517">Main exhibition</a>
    <a href="https://kyotocity-kyocera.museum/exhibition/20260707-20260720">Collection room</a>
  `;

  assert.deepEqual(
    extractKyoceraDetailUrls(listingHtml, 'https://kyotocity-kyocera.museum/exhibition/'),
    [
      'https://kyotocity-kyocera.museum/exhibition/20260310-20260517',
      'https://kyotocity-kyocera.museum/exhibition/20260707-20260720',
    ],
  );
});

test('Kyocera detail extraction finds English URLs', () => {
  const extractKyoceraDetailUrls = detailUrlExtractors['kyoto-city-kyocera-museum-of-art'];
  const listingHtml = `
    <a href="/en/exhibition/20260310-20260517">Main exhibition</a>
    <a href="https://kyotocity-kyocera.museum/en/exhibition/20260320-20260524">Special exhibition</a>
  `;

  assert.deepEqual(
    extractKyoceraDetailUrls(listingHtml, 'https://kyotocity-kyocera.museum/en/exhibition/'),
    [
      'https://kyotocity-kyocera.museum/en/exhibition/20260310-20260517',
      'https://kyotocity-kyocera.museum/en/exhibition/20260320-20260524',
    ],
  );
});

test('Fukuda detail extraction reads only exhibition cards inside exArv', () => {
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
    detailUrlExtractors['fukuda-art-museum'](
      listingHtml,
      'https://fukuda-art-museum.jp/exhibition',
    ),
    [
      'https://fukuda-art-museum.jp/exhibition/202512264487',
      'https://fukuda-art-museum.jp/exhibition/202604134657',
    ],
  );
});

test('Fukuda event extraction uses exhibition overview dates', () => {
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
    name: 'Fukuda Art Museum',
    taxonomy: testTaxonomy(['museum']),
    language: 'ja',
  };

  const event = eventExtractors['fukuda-art-museum'](
    detailHtml,
    source,
    'https://fukuda-art-museum.jp/exhibition/202512264487',
  );

  assert.equal(event.title, '若冲にトリハダ！ 野菜もウリ！');
  assert.equal(event.date_text, '2026年4月25日（土）～ 2026年 7月5日（日）');
  assert.equal(event.start_date, '2026-04-25');
  assert.equal(event.end_date, '2026-07-05');
  assert.equal(
    event.primary_image_url,
    'https://fukuda-art-museum.jp/wp/wp-content/uploads/2025/12/fukubi_jyakuchu_torihada_banner_1226-03.jpg',
  );
});

test('Fukuda English event extraction parses overview date order', () => {
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
    name: 'Fukuda Art Museum',
    taxonomy: testTaxonomy(['museum']),
    language: 'en',
  };

  const event = eventExtractors['fukuda-art-museum'](
    detailHtml,
    source,
    'https://fukuda-art-museum.jp/en/exhibition/202512111838',
  );

  assert.equal(event.title, 'Jakuchu: Prancing Feathers and Swelling Gourds');
  assert.equal(event.date_text, 'April 25 (Sat.) 2026 – July 5 (Sun.) 2026');
  assert.equal(event.start_date, '2026-04-25');
  assert.equal(event.end_date, '2026-07-05');
});

test('Kyoto National Museum extraction drops the first flyer image', () => {
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
    name: 'Kyoto National Museum',
    taxonomy: testTaxonomy(['museum']),
  };

  const event = eventExtractors['kyoto-national-museum'](
    detailHtml,
    source,
    'https://www.kyohaku.go.jp/eng/exhibitions/special/',
  );

  assert.deepEqual(event.image_urls, [
    'https://www.kyohaku.go.jp/images/exhibitions/install-view.jpg',
    'https://www.kyohaku.go.jp/images/exhibitions/detail.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://www.kyohaku.go.jp/images/exhibitions/install-view.jpg',
  );
  assert.equal(event.is_all_day, true);
});

test('Kyocera event extraction keeps images inside main post content only', () => {
  const event = eventExtractors['kyoto-city-kyocera-museum-of-art'](
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
      name: 'Kyoto City KYOCERA Museum of Art',
      address_text: '124 Okazaki Enshoji-cho, Sakyo-ku, Kyoto',
    },
    'https://kyotocity-kyocera.museum/exhibition/20260919-20261220',
  );

  assert.deepEqual(event.image_urls, [
    'https://kyotocity-kyocera.museum/wp-content/uploads/install-view.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://kyotocity-kyocera.museum/wp-content/uploads/install-view.jpg',
  );
});

test('Taka Ishii detail extraction keeps only Kyoto location events', () => {
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
    detailUrlExtractors['taka-ishii-gallery'](
      listingHtml,
      'https://www.takaishiigallery.com/en/exhibitions/kyoto-yada-cho/',
    ),
    [
      'https://www.takaishiigallery.com/en/archives/43428/',
      'https://www.takaishiigallery.com/en/archives/42707/',
    ],
  );
});

test('Taka Ishii event extraction uses heading02 detail title', () => {
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
    name: 'Taka Ishii Gallery',
    taxonomy: testTaxonomy(['gallery']),
  };

  const event = eventExtractors['taka-ishii-gallery'](
    detailHtml,
    source,
    'https://www.takaishiigallery.com/en/archives/42707/',
  );

  assert.equal(event.title, 'Martin Margiela');
});

test('locale URL extraction finds alternate links in header and metadata', () => {
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
    extractLocaleUrlsFromHtml(html, 'https://example.test/en/exhibitions/quiet-forms/'),
    {
      ja: 'https://example.test/ja/exhibitions/quiet-forms/',
    },
  );
});

test('native locale URL validation rejects sitewide language roots for detail pages', () => {
  assert.equal(
    isUsableNativeLocaleUrl(
      'https://www.takaishiigallery.com/en/archives/42707/',
      'https://www.takaishiigallery.com/en',
    ),
    false,
  );
  assert.equal(
    isUsableNativeLocaleUrl(
      'https://example.test/ja/exhibitions/quiet-forms/',
      'https://example.test/en/exhibitions/quiet-forms/',
    ),
    true,
  );
  assert.equal(
    isUsableNativeLocaleUrl(
      'https://example.test/ja/exhibitions/quiet-forms/',
      'https://attacker.test/en/exhibitions/quiet-forms/',
    ),
    false,
  );
});

test('native locale event validation rejects conflicting parsed dates', () => {
  assert.equal(
    nativeLocaleEventMatchesCanonical(
      { start_date: '2026-04-17', end_date: '2026-05-16' },
      { start_date: '2026-06-06', end_date: '2026-07-04' },
    ),
    false,
  );
  assert.equal(
    nativeLocaleEventMatchesCanonical(
      { start_date: '2026-04-17', end_date: '2026-05-16' },
      { start_date: '2026-04-17', end_date: '2026-05-16' },
    ),
    true,
  );
  assert.equal(
    nativeLocaleEventMatchesCanonical(
      { start_date: '2026-04-17', end_date: '2026-05-16' },
      { start_date: null, end_date: null },
    ),
    false,
  );
});

test('generic event extraction returns title, dates, and images', async () => {
  const detailHtml = await readFile(resolve(fixturesRoot, 'generic-detail.html'), 'utf8');
  const source = {
    name: 'Example Gallery',
    taxonomy: testTaxonomy(['gallery']),
  };

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://example.test/exhibitions/2026/quiet-forms/',
  );

  assert.equal(event.title, 'Quiet Forms');
  assert.equal(event.start_date, '2026-04-12');
  assert.equal(event.end_date, '2026-05-31');
  assert.equal(
    event.description,
    'This exhibition gathers quiet sculptural forms, hand-built vessels, and works on paper from artists working in Kyoto.',
  );
  assert.equal(event._description_origin, 'page_body');
  assert.equal(event.primary_image_url, 'https://example.test/images/install-view.jpg');
  assert.equal(event.image_urls.includes('https://example.test/media/quiet-forms.jpg'), true);
  assert.equal(event.image_urls.includes('https://example.test/images/venue-mark.jpg'), false);
  assert.equal(
    event.image_urls.includes('https://example.test/media/event-strip-300x80.jpg'),
    false,
  );
  assert.equal(
    event.image_urls.includes('https://example.test/media/cdn-thumb.jpg?width=240&height=80'),
    false,
  );
  assert.equal(event.image_urls.includes('https://example.test/images/program-thumb.jpg'), false);
  assert.equal(hasExtractedImage(event), true);
});

test('description resolver recovers prose and rejects structured-field copy', () => {
  const source = {
    name: 'Example Gallery',
    address_text: '1 Example Street, Kyoto',
  };
  const event = {
    title: 'Quiet Forms',
    date_text: 'April 12, 2026 - May 31, 2026',
    venue_name: 'Example Gallery',
    institution_name: 'Example Gallery',
    address_text: source.address_text,
    description: 'April 12, 2026 - May 31, 2026',
  };
  const recovered = resolveEventDescription(event, source, {
    html: '<main><p>April 12, 2026 - May 31, 2026</p></main>',
    fitHtml:
      '<main><p>Quiet Forms brings recent sculpture and works on paper to Example Gallery.</p></main>',
  });
  const rejected = resolveEventDescription(event, source, {
    html: '<main><p>Quiet Forms</p><p>Example Gallery</p><p>April 12, 2026 - May 31, 2026</p></main>',
  });
  const retained = resolveEventDescription(
    {
      ...event,
      description:
        'Quiet Forms brings recent sculpture and works on paper to Example Gallery for the first time.',
    },
    source,
    { html: '' },
  );

  assert.equal(
    recovered.description,
    'Quiet Forms brings recent sculpture and works on paper to Example Gallery.',
  );
  assert.equal(recovered._description_origin, 'crawl4ai_fit');
  assert.equal(recovered._description_recovered, true);
  assert.equal(rejected.description, null);
  assert.equal(rejected._description_valid, false);
  assert.equal(
    retained.description,
    'Quiet Forms brings recent sculpture and works on paper to Example Gallery for the first time.',
  );
  assert.equal(retained._description_valid, true);
});

test('source-specific description remains authoritative over generic page prose', () => {
  const source = { name: 'Example Gallery' };
  const event = withSourceSpecificDescriptionOrigin({
    title: 'Quiet Forms',
    description:
      'Quiet Forms presents a focused selection chosen explicitly by the source extractor.',
    _description_origin: 'page_body',
  });
  const resolved = resolveEventDescription(event, source, {
    html: '<main><p>Quiet Forms presents competing generic prose found elsewhere on the page.</p></main>',
  });

  assert.equal(
    resolved.description,
    'Quiet Forms presents a focused selection chosen explicitly by the source extractor.',
  );
  assert.equal(resolved._description_origin, 'source_specific_extractor');
  assert.equal(hasValidEventDescription(resolved), true);
});

test('required-field retry includes invalid title date description and image', () => {
  const validEvent = {
    title: 'Quiet Forms',
    start_date: '2026-04-12',
    date_precision: 'date',
    description: 'Quiet Forms presents recent sculpture and works on paper in Kyoto.',
    _description_valid: true,
    primary_image_url: 'https://example.test/images/quiet-forms.jpg',
  };
  const cases = [
    ['title', { ...validEvent, title: 'Exhibition', _title_valid: false }],
    ['date', { ...validEvent, start_date: null }],
    ['description', { ...validEvent, description: null, _description_valid: false }],
    ['image', { ...validEvent, primary_image_url: null, image_urls: [] }],
    [
      'image',
      {
        ...validEvent,
        primary_image_url: 'https://example.test/images/lqip-placeholder.jpg',
      },
    ],
  ];

  assert.deepEqual(getInvalidRequiredEventFields(validEvent), []);
  assert.equal(shouldRetryDetailWithCrawl4Ai(validEvent, 'auto', 'fetch'), false);
  for (const [field, event] of cases) {
    assert.ok(getInvalidRequiredEventFields(event).includes(field));
    assert.equal(shouldRetryDetailWithCrawl4Ai(event, 'auto', 'fetch'), true);
  }
  assert.equal(shouldRetryDetailWithCrawl4Ai(cases[0][1], 'auto', 'crawl4ai'), false);
  assert.equal(shouldRetryDetailWithCrawl4Ai(cases[0][1], 'never', 'fetch'), false);
});

test('generic event extraction ignores common site chrome images', () => {
  const source = {
    name: 'Oyamazaki Villa Museum',
    address_text: '5-3 Zenihara, Oyamazaki-cho, Kyoto',
    taxonomy: testTaxonomy(['museum']),
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
    'https://www.asahigroup-oyamazaki.com/english/exhibition/future/',
  );

  assert.deepEqual(event.image_urls, []);
  assert.equal(event.primary_image_url, null);
  assert.equal(hasExtractedImage(event), false);
});

test('generic event extraction honors skip_og_image without configured media', () => {
  const source = {
    slug: 'artro',
    name: 'Artro',
    taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
    skip_og_image: true,
  };
  const event = extractGenericEvent(
    `
      <meta property="og:image" content="https://artro.jp/uploads/site-card.jpg">
      <article>
        <h1>Gallery-room exhibition</h1>
        <time>April 12 - May 31, 2026</time>
        <p>Useful exhibition copy.</p>
        <img src="/uploads/install-view.jpg" width="900" height="600" alt="">
      </article>
    `,
    source,
    'https://artro.jp/exhibition/gallery-room/',
  );

  assert.deepEqual(event.image_urls, ['https://artro.jp/uploads/install-view.jpg']);
  assert.equal(event.primary_image_url, 'https://artro.jp/uploads/install-view.jpg');
});

test('configured media filters UI and LQIP URLs and keeps largest srcset candidate', () => {
  const event = extractGenericEvent(
    `
      <main class="event-media">
        <img src="/assets/logo.png" width="600" height="200">
        <img src="https://static.wixstatic.com/media/w_40,h_40,blur_2/preview.jpg">
        <img src="/images/art-400.jpg" srcset="/images/art-400.jpg 400w, /images/art-1600.jpg 1600w">
      </main>
    `,
    {
      name: 'Example Gallery',
      taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
      selectors: { images: '.event-media img' },
    },
    'https://example.test/exhibitions/example/',
  );

  assert.deepEqual(event.image_urls, ['https://example.test/images/art-1600.jpg']);
});

test('generic inline media outranks Open Graph fallback', () => {
  const event = extractGenericEvent(
    `
      <meta property="og:image" content="/images/event-card.jpg">
      <article><img src="/images/installation.jpg" width="800" height="600"></article>
    `,
    { name: 'Example Gallery', taxonomy: testTaxonomy(['gallery'], [], ['exhibition']) },
    'https://example.test/exhibitions/example/',
  );

  assert.equal(event.primary_image_url, 'https://example.test/images/installation.jpg');
});

test('Artro listing extraction follows exhibition card links', () => {
  const source = {
    slug: 'artro',
    allowed_domains: ['artro.jp'],
    event_page_patterns: ['/exhibition/'],
    selectors: {
      listing_links: '.section__colImageSingle a',
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
    extractGenericDetailUrls(listingHtml, 'https://artro.jp/exhibition/?state=before', source, 8),
    ['https://artro.jp/exhibition/ai-makita/'],
  );
  assert.deepEqual(
    extractGenericDetailUrls(
      '<a href="/exhibition/?state=before">Upcoming</a><a href="/news/">News</a>',
      'https://artro.jp/exhibition/',
      source,
      8,
    ),
    [],
  );
});

test('Artro event extraction reads main visual event fields', () => {
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
  const event = eventExtractors.artro(
    detailHtml,
    { name: 'Artro', address_text: 'Kyoto' },
    'https://artro.jp/exhibition/ai-makita/',
  );

  assert.equal(event.title, 'First Shadows, Then Reflections, Then the Things Themselves');
  assert.equal(event.start_date, '2026-06-06');
  assert.equal(event.end_date, '2026-07-05');
  assert.equal(
    event.primary_image_url,
    'https://artro.jp/cms_wp/wp-content/uploads/2026/04/P1155587-scaled.jpg',
  );
  assert.equal(event.metadata.artist, 'AI MAKITA 牧田愛');
});

test('HOSOO event extraction keeps theme exhibition slides', () => {
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
  const event = eventExtractors['hosoo-gallery'](
    detailHtml,
    { name: 'HOSOO GALLERY', address_text: 'Kyoto' },
    'https://www.hosoogallery.jp/en/exhibitions/glorious-robe/',
  );

  assert.equal(event.title, 'Theaster Gates: Glorious Robe');
  assert.equal(event.start_date, '2026-04-11');
  assert.equal(event.end_date, '2026-08-30');
  assert.equal(
    event.primary_image_url,
    'https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/slide_01.jpg',
  );
  assert.deepEqual(event.image_urls, [
    'https://www.hosoogallery.jp/wp/wp-content/themes/hosoogallery/img/exhibitions/glorious-robe/slide_01.jpg',
  ]);
});

test('generic event extraction can use configured field selectors', () => {
  const detailHtml = `
    <article>
      <h1 class="event-title">Configured Title</h1>
      <p class="event-date">2026/04/12 - 2026/05/31</p>
      <div class="event-description"><p>Configured description with enough detail for the card.</p></div>
      <figure class="event-media"><img src="/images/configured.jpg" alt=""></figure>
    </article>
  `;
  const source = {
    name: 'Example Gallery',
    taxonomy: testTaxonomy(['gallery']),
    selectors: {
      title: '.event-title',
      date: '.event-date',
      description: '.event-description',
      images: '.event-media img',
    },
  };

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://example.test/exhibitions/configured/',
  );

  assert.equal(event.title, 'Configured Title');
  assert.equal(event.description, 'Configured description with enough detail for the card.');
  assert.equal(event.start_date, '2026-04-12');
  assert.equal(event.end_date, '2026-05-31');
  assert.equal(event.primary_image_url, 'https://example.test/images/configured.jpg');
});

test('Standing Pine Tokyo extraction reads left-column title and period', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'standing-pine-tokyo');
  const listingHtml = `
    <ul class="split-block__items">
      <li class="split-block__item info_outside">
        <a class="split-block__item-link" href="/en/exhibitions/402">
          <ul class="split-block__item-descriptions">
            <li class="split-block__item-description is_date">2026.07.04 Sat - 2026.07.25 Sat</li>
            <li class="split-block__item-description is_title">Dear Summer | Youki Hirakawa、intext、Masayuki Arai</li>
          </ul>
        </a>
      </li>
    </ul>
  `;
  const detailHtml = `
    <section class="content-detail">
      <div class="content-detail__image">
        <img class="content-detail__image-body" src="https://standingpine.storage.googleapis.com/exhibitions/402/cover_images/original/aIMG_4872.JPG?1782285446">
      </div>
      <div class="content-detail__description">
        <li class="content-detail__description-item is_title">Dear Summer | Youki Hirakawa、intext、Masayuki Arai</li>
        <li class="split-block__item-description-item is_date_in-detail">2026.07.04 Sat - 2026.07.25 Sat</li>
      </div>
      <div class="content-detail__content">
        <p>STANDING PINE is pleased to present Dear Summer, a group exhibition featuring works by Youki Hirakawa, intext, and Masayuki Arai.</p>
      </div>
    </section>
  `;

  assert.equal(source.start_urls[0], 'https://standingpine.jp/en/exhibitions');
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://standingpine.jp/en/exhibitions', source, 8),
    ['https://standingpine.jp/en/exhibitions/402'],
  );

  const event = eventExtractors[source.slug](
    detailHtml,
    source,
    'https://standingpine.jp/en/exhibitions/402',
  );

  assert.equal(event.title, 'Dear Summer');
  assert.equal(event.date_text, '2026.07.04 Sat - 2026.07.25 Sat');
  assert.equal(event.start_date, '2026-07-04');
  assert.equal(event.end_date, '2026-07-25');
  assert.match(event.description, /^STANDING PINE is pleased to present Dear Summer/);
  assert.equal(
    event.primary_image_url,
    'https://standingpine.storage.googleapis.com/exhibitions/402/cover_images/original/aIMG_4872.JPG?1782285446',
  );
});

test('Artizon source config uses artwork list images instead of flyer image', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'artizon-museum');
  const detailHtml = `
    <h1>Ettore Sottsass: Design begins where magic begins</h1>
    <p class="exhibitionPostDate">June 23 [Tue] - October 4 [Sun], 2026</p>
    <div class="detail-img"><img src="https://atz-image.s3.ap-northeast-1.amazonaws.com/flyer.jpg" alt=""></div>
    <section class="container">
      <h2>Art works</h2>
      <div class="container col4Box exhibitionGallery">
        <div class="col"><div class="trimBox"><img class="objectFit objectFit--contain protect" src="https://atz-image.s3.ap-northeast-1.amazonaws.com/work-01.jpg" alt=""></div></div>
        <div class="col"><div class="trimBox"><img class="objectFit objectFit--contain protect" src="https://atz-image.s3.ap-northeast-1.amazonaws.com/work-02.jpg" alt=""></div></div>
      </div>
    </section>
  `;

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.artizon.museum/en/exhibition/detail/603',
  );

  assert.deepEqual(event.image_urls, [
    'https://atz-image.s3.ap-northeast-1.amazonaws.com/work-01.jpg',
    'https://atz-image.s3.ap-northeast-1.amazonaws.com/work-02.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://atz-image.s3.ap-northeast-1.amazonaws.com/work-01.jpg',
  );
});

test('Mori Art Museum source config uses content-main copy and images', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'mori-art-museum');
  const detailHtml = `
    <meta property="og:image" content="https://www.mori.art.museum/assets_c/2026/03/flyer-og.jpg">
    <img src="../../common/img/mam_logo.svg" alt="MORI ART MUSEUM">
    <img src="../../common/img/_blank.png" data-pcimg="/assets_c/2026/03/flyer.jpg">
    <div class="module-grid content">
      <div class="module-gridItem8 content-main">
        <article>
          <p>Ron Mueck sculptures challenge our perception of reality.</p>
          <div class="pcOnly">
            <div class="content-img content-imgW50">
              <figure><img src="../../../files/exhibitions/2025/10/23/work-01.jpg" alt="Ron Mueck Mass"></figure>
            </div>
          </div>
          <div class="spOnly">
            <div class="content-img content-imgW100">
              <figure><img src="../../../files/exhibitions/2025/10/23/work-01.jpg" alt="Ron Mueck Mass"></figure>
            </div>
          </div>
          <div class="pcOnly">
            <figure class="content-img content-imgW75">
              <img src="../../../files/exhibitions/2025/10/23/work-02.jpg" alt="Second work">
            </figure>
          </div>
          <div class="content-info mT50">
            <h2 class="content-info_title">Ron Mueck</h2>
            <table><tbody><tr><th>Exhibition Period</th><td>Wednesday, April 29, 2026 - Wednesday, September 23, 2026</td></tr></tbody></table>
          </div>
        </article>
      </div>
    </div>
    <div class="relatedExhibition"><img src="../../../assets_c/2026/05/related.jpg"></div>
  `;

  assert.deepEqual(source?.start_urls, ['https://www.mori.art.museum/en/exhibitions/index.html']);
  assert.deepEqual(source?.locales?.ja?.start_urls, [
    'https://www.mori.art.museum/jp/exhibitions/index.html',
  ]);

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.mori.art.museum/en/exhibitions/ronmueck/index.html',
  );

  assert.match(event.description, /Ron Mueck sculptures/);
  assert.doesNotMatch(event.description, /relatedExhibition/);
  assert.deepEqual(event.image_urls, [
    'https://www.mori.art.museum/files/exhibitions/2025/10/23/work-01.jpg',
    'https://www.mori.art.museum/files/exhibitions/2025/10/23/work-02.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://www.mori.art.museum/files/exhibitions/2025/10/23/work-01.jpg',
  );
});

test('Museum of Contemporary Art Tokyo keeps only exhibition-entry art', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'museum-of-contemporary-art-tokyo');
  const artUrl = 'https://www.mot-art-museum.jp/assets/exhibitions/b077-eric-carle.jpg';
  const detailHtml = `
    <meta property="og:image" content="https://www.mot-art-museum.jp/_assets/images/head/og-image@2x.png">
    <h1>Eric Carle Exhibition</h1>
    <p>July 1, 2026 - September 30, 2026</p>
    <p>Exhibition description long enough for the generic extractor to keep as useful event copy.</p>
    <div class="l-exhibitions-entry-main__image">
      <picture><source srcset="${artUrl}"><img src="${artUrl}" alt="Eric Carle artwork"></picture>
    </div>
    <button><img src="https://www.mot-art-museum.jp/_assets/images/ico-sp-open-arrow@2x.png" alt="open"></button>
    <a href="https://x.com/"><img src="https://www.mot-art-museum.jp/_assets/images/ico-x.png" alt="X"></a>
  `;

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.mot-art-museum.jp/en/exhibitions/eric-carle/',
  );
  const probedUrls = [];
  const normalized = await normalizeEventImagesForSource(event, source, {
    fetchImageDimensionsFn: async (url) => {
      probedUrls.push(url);
      return { width: 1600, height: 1200 };
    },
  });

  assert.equal(source?.selectors?.images, '.l-exhibitions-entry-main__image');
  assert.equal(source?.skip_og_image, true);
  assert.equal(source?.measure_image_dimensions, true);
  assert.deepEqual(event.image_urls, [artUrl]);
  assert.deepEqual(normalized.image_urls, [artUrl]);
  assert.deepEqual(probedUrls, [artUrl]);
});

test('National Art Center Tokyo keeps hero and editorial art outside shared arrow UI', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'national-art-center-tokyo');
  const heroUrl = 'https://www.nact.jp/media/_louvre26_Banner_yoko_001.jpg';
  const editorialUrl = 'https://www.nact.jp/media/louvre-installation-01.jpg';
  const detailHtml = `
    <meta property="og:image" content="https://www.nact.jp/common/img/ogp.jpg">
    <h1>Louvre Museum Exhibition</h1>
    <p>September 9, 2026 - December 13, 2026</p>
    <p>Exhibition description long enough for the generic extractor to keep as useful event copy.</p>
    <div class="main_v"><div><div class="main"><img src="${heroUrl}" alt="Louvre exhibition"></div></div></div>
    <img class="mt-image-none" src="${editorialUrl}" alt="Installation view">
    <a href="/english/exhibition_and_event/"><img src="https://www.nact.jp/common/img/common/arrow01.svg" alt="Back"></a>
  `;

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.nact.jp/english/exhibition_special/2026/louvre2026/',
  );
  const probedUrls = [];
  const normalized = await normalizeEventImagesForSource(event, source, {
    fetchImageDimensionsFn: async (url) => {
      probedUrls.push(url);
      return { width: 1600, height: 900 };
    },
  });

  assert.deepEqual(source?.selectors?.images, ['.main_v', '.mt-image-none']);
  assert.equal(source?.skip_og_image, true);
  assert.equal(source?.measure_image_dimensions, true);
  assert.deepEqual(event.image_urls, [heroUrl, editorialUrl]);
  assert.deepEqual(normalized.image_urls, [heroUrl, editorialUrl]);
  assert.deepEqual(probedUrls, [heroUrl, editorialUrl]);
});

test('Yutaka Kikutake Gallery source config keeps current/upcoming and artwork images', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'yutaka-kikutake-gallery');
  const listingHtml = `
    <div class="row ex-current-row">
      <div class="ex-time-title"><p>CURRENT</p></div>
      <ul class="ex-current">
        <li><a href="https://www.yutakakikutakegallery.com/exhibitions/kako-shirahata-solo-show/">Kako Shirahata</a></li>
      </ul>
    </div>
    <div class="row ex-upcoming-row">
      <div class="ex-time-title"><p>UPCOMING</p></div>
      <ul class="ex-upcoming">
        <li><a href="https://www.yutakakikutakegallery.com/exhibitions/future-show/">Future Show</a></li>
      </ul>
    </div>
    <div class="row ex-past-row">
      <div class="ex-time-title"><p>PAST</p></div>
      <a href="https://www.yutakakikutakegallery.com/exhibitions/old-show/">Old Show</a>
    </div>
  `;
  const detailHtml = `
    <h1 class="ex-artist">Kako Shirahata</h1>
    <h2 class="ex-title">Breathing, trying to weep</h2>
    <p class="ex-spec"><span>Current</span><br>Kyobashi<br>May 30 (Sat) - July 25 (Sat), 2026<br>11:00 - 19:00 Closed on Sun, Mon and National Holidays</p>
    <div class="ex-description"><p>Kako Shirahata exhibition copy long enough to be useful in the card.</p></div>
    <div class="artwork"><img src="https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/work-01-900x600.jpg" alt=""></div>
    <div class="artwork"><img src="https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/work-02-900x600.jpg" alt=""></div>
    <ul class="royalSlider"><li class="rsContent"><img class="rsImg" src="" srcset=" 1x, 2x" alt=""></li></ul>
  `;

  assert.deepEqual(
    extractGenericDetailUrls(
      listingHtml,
      'https://www.yutakakikutakegallery.com/exhibitions/',
      source,
      8,
    ),
    [
      'https://www.yutakakikutakegallery.com/exhibitions/kako-shirahata-solo-show/',
      'https://www.yutakakikutakegallery.com/exhibitions/future-show/',
    ],
  );

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.yutakakikutakegallery.com/exhibitions/kako-shirahata-solo-show/',
  );

  assert.equal(event.title, 'Breathing, trying to weep');
  assert.equal(
    event.date_text,
    'Current Kyobashi May 30 (Sat) - July 25 (Sat), 2026 11:00 - 19:00 Closed on Sun, Mon and National Holidays',
  );
  assert.equal(event.start_date, '2026-05-30');
  assert.equal(event.end_date, '2026-07-25');
  assert.deepEqual(event.image_urls, [
    'https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/work-01-900x600.jpg',
    'https://www.yutakakikutakegallery.com/ykgg/wp-content/uploads/2026/05/work-02-900x600.jpg',
  ]);
});

test('SNOW Contemporary source config reads current page title date and single image', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'snow-contemporary');
  const listingHtml = `
    <a href="http://snowcontemporary.com/exhibition/current.html">/Jp</a>
    <a href="upcoming.html">upcoming</a>
    <a href="past.html">past</a>
    <div id="resizeimage">
      <img src="../../img/exhibition/202605/top.jpg" alt="snow contemporary">
    </div>
    <div id="boxEX1">
      <strong>Rintaro Fuse Solo exhibition “Exhibition for Time Travelers”</strong><br />
      session：2026.5.22fri - 7.4sat 13:00 - 19:00<br />
      *closed on Sun, Mon, Tue and public holidays.<br />
      venue：SNOW Contemporary / 404 Hayano Bldg. 2-13-12 Nishiazabu, Minato-ku, Tokyo<br />
      opening reception : 2026.5.22fri 17:00 - 19:00<br />
      <br />
      Intro copy for the exhibition.
    </div>
    <img src="../img/exhibition/202110/old.jpg" alt="old image">
  `;

  assert.deepEqual(
    extractSourceSpecificDetailUrls(
      detailUrlExtractors[source.slug],
      [{ url: 'http://www.snowcontemporary.com/en/exhibition/current.html', html: listingHtml }],
      source,
    ),
    ['http://www.snowcontemporary.com/en/exhibition/current.html'],
  );

  const event = (eventExtractors[source.slug] ?? extractGenericEvent)(
    listingHtml,
    source,
    'http://www.snowcontemporary.com/en/exhibition/current.html',
  );

  assert.equal(event.title, 'Exhibition for Time Travelers');
  assert.equal(event.date_text, 'session：2026.5.22fri - 7.4sat 13:00 - 19:00');
  assert.equal(event.start_date, '2026-05-22');
  assert.equal(event.end_date, '2026-07-04');
  assert.equal(event.start_time_text, '13:00');
  assert.equal(event.end_time_text, '19:00');
  assert.deepEqual(event.image_urls, [
    'http://www.snowcontemporary.com/img/exhibition/202605/top.jpg',
  ]);
});

test('Ginza Graphic Gallery source config uses Tokyo schedule pages and first image only', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'ginza-graphic-gallery');
  const listingHtml = `
    <div class="ttl-cmn-exhibition-wrap s-border s-mt-20">
      <h3 class="ttl-cmn-exhibition">
        <a href="/CGI/gallery/schedule/detail.cgi?l=2&t=1&seq=00000855">
          <span class="ttl01">The 414th ginza graphic gallery Exhibition</span>
          <span class="ttl02">Kota Iguchi: Motion Graphics</span>
        </a>
      </h3>
      <p class="date">May 26, 2026 - July 04, 2026</p>
    </div><!-- /ttl-cmn-exhibition-wrap -->
    <div class="ttl-cmn-exhibition-wrap s-border s-mt-20">
      <h3 class="ttl-cmn-exhibition">
        <a href="/CGI/gallery/schedule/detail.cgi?l=2&t=1&seq=00000860">
          <span class="ttl01">The 415th ginza graphic gallery Exhibition</span>
          <span class="ttl02">Dafi Kuhne: Constructing Posters</span>
        </a>
      </h3>
      <p class="date">July 14, 2026 - August 26, 2026</p>
    </div><!-- /ttl-cmn-exhibition-wrap -->
  `;
  const detailHtml = `
    <meta property="og:image" content="https://www.dnpfcp.jp/gallery/schedule/schedule_images/IMG_1_00000855.jpg">
    <span class="ttl01">The 414th ginza graphic gallery Exhibition</span>
    <span class="ttl-cmn-01">Kota Iguchi: Motion Graphics</span>
    <p class="date">May 26, 2026 - July 04, 2026</p>
    <div class="txt"><p>Motion graphics exhibition description.</p></div>
    <img src="schedule_images/IMG_2_00000855.jpg" alt="">
  `;

  assert.equal(source.start_urls[0], 'https://www.dnpfcp.jp/CGI/gallery/schedule/list.cgi?t=1&l=2');
  assert.deepEqual(source.locales.ja.start_urls, [
    'https://www.dnpfcp.jp/CGI/gallery/schedule/list.cgi?t=1&l=1',
  ]);
  assert.deepEqual(
    detailUrlExtractors[source.slug](
      listingHtml,
      'https://www.dnpfcp.jp/CGI/gallery/schedule/list.cgi?t=1&l=2',
    ),
    [
      'https://www.dnpfcp.jp/CGI/gallery/schedule/detail.cgi?l=2&t=1&seq=00000855',
      'https://www.dnpfcp.jp/CGI/gallery/schedule/detail.cgi?l=2&t=1&seq=00000860',
    ],
  );

  const event = eventExtractors[source.slug](
    detailHtml,
    source,
    'https://www.dnpfcp.jp/CGI/gallery/schedule/detail.cgi?l=2&t=1&seq=00000855',
  );

  assert.equal(event.title, 'Kota Iguchi: Motion Graphics');
  assert.equal(event.start_date, '2026-05-26');
  assert.equal(event.end_date, '2026-07-04');
  assert.deepEqual(event.image_urls, [
    'https://www.dnpfcp.jp/gallery/schedule/schedule_images/IMG_1_00000855.jpg',
  ]);
});

test('Setagaya source config uses Works on Display images only', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'setagaya-art-museum');
  const detailHtml = `
    <meta property="og:image" content="https://www.setagayaartmuseum.or.jp/assets/exhibition/images/flyer-og.jpg">
    <h1>Textiles of Sweden</h1>
    <p class="date">2026.06.28 - 09.15</p>
    <p class="image"><img src="https://www.setagayaartmuseum.or.jp/assets/exhibition/images/flyer.jpg" alt=""></p>
    <div class="exhb_unit01 works open">
      <h2>Works on Display</h2>
      <ul class="list02 cf" id="EXHB-WORKS-LIST">
        <li><a href="/assets/exhibition/images/work-01-large.jpg" class="enlarge"><p class="image"><img src="/assets/exhibition/images/work-01.jpg" alt=""></p></a></li>
      </ul>
      <ul class="list02 cf more">
        <li><a href="/assets/exhibition/images/work-02-large.jpg" class="enlarge"><p class="image"><img src="/assets/exhibition/images/work-02.jpg" alt=""></p></a></li>
      </ul>
    </div>
    <div class="wrap exhibition_other_wrap">
      <h2><span class="en">Pickup</span></h2>
      <a href="/en/exhibition/special/detail.php?id=sp00228"><p class="image"><img src="/assets/exhibition/images/pickup.jpg" alt=""></p></a>
    </div>
  `;

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.setagayaartmuseum.or.jp/en/exhibition/special/detail.php?id=sp00230',
  );

  assert.deepEqual(event.image_urls, [
    'https://www.setagayaartmuseum.or.jp/assets/exhibition/images/work-01.jpg',
    'https://www.setagayaartmuseum.or.jp/assets/exhibition/images/work-02.jpg',
  ]);
});

test('Tokyo Node source config keeps only the second event image', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'tokyo-node');
  const detailHtml = `
    <h1>ヨシロットン展 彼方との交信／BEYOND EARTH</h1>
    <p>2026.5.23（土）- 2026.7.20（月・祝）</p>
    <img src="/assets/images/logo/LogoTN-Small.svg" loading="lazy" alt="" class="logo_image">
    <div class="e-gallery_fv_thumbnail_pc">
      <img src="/assets/images/yoshirotten/tokyonode_kv_0525.jpg" loading="lazy" alt="" class="image-widescreen a-16-9">
    </div>
    <div class="e-gallery_fv_thumbnail_mobile">
      <img src="/assets/images/yoshirotten/tokyonode_kv_0524_1x1.jpg" loading="lazy" alt="" class="image-square">
    </div>
    <img src="/assets/images/yoshirotten/yoshirotten-portrait.jpg" loading="lazy" alt="" class="image-widescreen a-16-9">
    <section class="section_lab_whatson">
      <img src="/assets/event/related-event.jpg" loading="lazy" alt="" class="image-square">
    </section>
  `;

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.tokyonode.jp/events/yoshirotten/index.html',
  );

  assert.deepEqual(event.image_urls, [
    'https://www.tokyonode.jp/assets/images/yoshirotten/tokyonode_kv_0524_1x1.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://www.tokyonode.jp/assets/images/yoshirotten/tokyonode_kv_0524_1x1.jpg',
  );
});

test('PARCO Hall Shinsaibashi extraction keeps only the first image', async () => {
  const sources = await loadSourcesConfig({ city: 'osaka' });
  const source = sources.find((candidate) => candidate.slug === 'parco-hall-shinsaibashi');
  const detailHtml = `
    <meta property="og:image" content="https://art.parco.jp/assets/eventhall/main.jpg">
    <h1>PARCO Art Fair Osaka</h1>
    <p>2026.7.1 - 2026.7.20</p>
    <p>Useful exhibition copy for the PARCO event page.</p>
    <img src="/assets/eventhall/detail-01.jpg" alt="">
    <img src="/assets/eventhall/detail-02.jpg" alt="">
  `;

  const event = (eventExtractors[source.slug] ?? extractGenericEvent)(
    detailHtml,
    source,
    'https://art.parco.jp/eventhall/detail/?id=2000',
  );

  assert.equal(event.primary_image_url, 'https://art.parco.jp/assets/eventhall/main.jpg');
  assert.deepEqual(event.image_urls, ['https://art.parco.jp/assets/eventhall/main.jpg']);
});

test('Oyamazaki extraction uses article metadata and skips flyer image', () => {
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
    name: 'Oyamazaki Villa Museum',
    taxonomy: testTaxonomy(['museum']),
    selectors: {
      title: '.p-news_title',
      date: '.p-news_date',
      description: '.p-exhibitionArticle_text',
      images: '.p-exhibitionArticle img',
    },
  };

  const event = eventExtractors['oyamazaki-villa-museum'](
    detailHtml,
    source,
    'https://www.asahigroup-oyamazaki.com/english/exhibition/kawai-hamada/',
  );

  assert.equal(event.title, 'Resonance: Kanjiro Kawai x Shoji Hamada');
  assert.equal(event.start_date, '2026-03-20');
  assert.equal(event.end_date, '2026-09-06');
  assert.deepEqual(event.image_urls, [
    'https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-01.jpg',
    'https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-02.jpg',
  ]);
  assert.equal(
    event.primary_image_url,
    'https://www.asahigroup-oyamazaki.com/english/uploads/2026/01/22/work-01.jpg',
  );

  const japaneseEvent = eventExtractors['oyamazaki-villa-museum'](
    detailHtml.replace(
      'Friday, March 20 to Sunday, September 6, 2026 10:00 a.m. to 5:00 p.m.',
      '2026年3月20日(金・祝)－9月6日(日)',
    ),
    source,
    'https://www.asahigroup-oyamazaki.com/exhibition/kawai-hamada/',
  );

  assert.equal(japaneseEvent.start_date, '2026-03-20');
  assert.equal(japaneseEvent.end_date, '2026-09-06');
});

test('Baiken event extraction cleans Japanese title dates and infers year', () => {
  const source = {
    name: 'Gallery Baiken',
    taxonomy: testTaxonomy(['gallery']),
    address_text: '682 Takenoko-cho, Nakagyo-ku, Kyoto 604-8153 Japan',
    lat: 35.004873,
    lng: 135.759387,
    selectors: {
      title: '.post-title',
      date: '.field-date',
      description: '.des-box',
      images: '.detail-content img',
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

  const event = eventExtractors['gallery-baiken'](
    detailHtml,
    source,
    'https://baiken.jp/exhibition/%e2%97%a4%e6%87%b8%e6%83%b3%e3%81%ae%e7%9c%b8%e2%97%a2-5%e6%9c%889%e6%97%a5%e5%9c%9f%ef%bd%9e16%e6%97%a5%e5%9c%9f/',
  );

  assert.equal(event.title, '♢♢懸想の眸♢♢');
  assert.equal(event.start_date, '2026-05-09');
  assert.equal(event.end_date, '2026-05-16');
  assert.equal(
    event.primary_image_url,
    'https://baiken.jp/manage/wp-content/uploads/exhibition/2026/04/main.jpg',
  );
});

test('source capabilities declare native locales and machine translation behavior', () => {
  const source = {
    language: 'ja',
    capabilities: {
      native_locales: ['ja'],
      machine_translate_missing_locales: false,
    },
  };

  assert.equal(sourceHasNativeLocale(source, 'ja'), true);
  assert.equal(sourceHasNativeLocale(source, 'en'), false);
  assert.equal(shouldMachineTranslateMissingLocales(source), false);
});

test('source config validator reports missing source truth', () => {
  assert.deepEqual(
    validateSourceConfig({
      slug: 'draft-source',
      name: 'Draft Source',
      capabilities: {
        native_locales: ['ja'],
      },
    }),
    [
      'draft-source: missing taxonomy.venue_category',
      'draft-source: missing taxonomy.display_category',
      'draft-source: missing taxonomy.event_category',
      'draft-source: missing lat/lng',
    ],
  );
});

test('source config validator rejects unregistered filter categories', () => {
  assert.deepEqual(
    validateSourceConfig({
      slug: 'bad-category',
      name: 'Bad Category',
      taxonomy: testTaxonomy(['gallery'], [], ['book fair']),
      lat: 35,
      lng: 135,
      capabilities: { native_locales: ['ja'] },
    }),
    ['bad-category: unsupported event_category "book fair"'],
  );
});

test('source config validator requires boolean image and landing controls', () => {
  assert.deepEqual(
    validateSourceConfig({
      slug: 'bad-media-control',
      name: 'Bad Media Control',
      taxonomy: testTaxonomy(),
      lat: 35,
      lng: 135,
      capabilities: { native_locales: ['ja'] },
      skip_og_image: 'yes',
      measure_image_dimensions: 'yes',
      landing_slider: 'yes',
    }),
    [
      'bad-media-control: skip_og_image must be boolean',
      'bad-media-control: measure_image_dimensions must be boolean',
      'bad-media-control: landing_slider must be boolean',
    ],
  );
});

test('city source configs are valid crawl inputs', async () => {
  for (const city of ['osaka', 'tokyo', 'hong-kong']) {
    const sources = await loadSourcesConfig({ city });

    assert.ok(sources.length > 0);
    for (const source of sources) {
      assert.equal(source.city, city);
      assert.deepEqual(validateSourceConfig(source), []);
    }
  }
});

test('CURATION FAIR sources discover only current-year announcement news', async () => {
  const year = currentYearInTokyo();
  const kyotoSources = await loadSourcesConfig({ city: 'kyoto' });
  const tokyoSources = await loadSourcesConfig({ city: 'tokyo' });
  const kyoto = kyotoSources.find((item) => item.slug === 'curation-fair-kyoto');
  const tokyo = tokyoSources.find((item) => item.slug === 'curation-fair-tokyo');
  const listingHtml = `
    <a href="/en/news/post_20260402">Announcement of CURATION⇄FAIR Kyoto ${year}</a>
    <a href="/en/news/release_20251106">CURATION⇄FAIR Tokyo ${year} dates announced</a>
    <a href="/en/news/post_20250402">Announcement of CURATION⇄FAIR Tokyo ${Number(year) - 1}</a>
  `;

  assert.deepEqual(kyoto?.taxonomy, testTaxonomy(['fair'], ['contemporary'], ['fair']));
  assert.deepEqual(kyoto?.start_urls, ['https://curation-fair.com/en/news/kyoto']);
  assert.deepEqual(detailUrlExtractors[kyoto.slug](listingHtml, kyoto.start_urls[0], kyoto), [
    'https://curation-fair.com/en/news/release_20260706',
  ]);
  assert.deepEqual(tokyo?.taxonomy, testTaxonomy(['fair'], [], ['fair']));
  assert.deepEqual(tokyo?.start_urls, ['https://curation-fair.com/en/news/tokyo']);
  assert.deepEqual(detailUrlExtractors[tokyo.slug](listingHtml, tokyo.start_urls[0], tokyo), []);

  const event = eventExtractors[kyoto.slug](
    `<h1>Press release</h1>
     <p>CURATION⇄FAIR Kyoto brings together galleries and programs across three historic temples in Nishijin.</p>
     <p>Visitors encounter art, architecture, gardens, and Kyoto culture through one annual fair.</p>
     <p>Dates: Friday 6 November - Sunday 8 November, 2026</p>
     <img src="https://curation-fair.com/kyoto-2026.jpg" width="1600" height="900">`,
    kyoto,
    kyoto.event_info_urls.en,
  );

  assert.equal(event.title, 'CURATION⇄FAIR Kyoto');
  assert.equal(event.start_date, '2026-11-06');
  assert.equal(event.end_date, '2026-11-08');
});

test('ARTS&SCIENCE keeps current Kyoto details and reads only Kyoto schedule', async () => {
  const sources = await loadSourcesConfig({ city: 'kyoto' });
  const source = sources.find((item) => item.slug === 'arts-science-kyoto');
  const kyotoUrl = 'https://arts-science.com/events/kyoto-and-tokyo/';
  const listingJson = JSON.stringify([
    {
      link: kyotoUrl,
      acf: {
        period: [
          {
            location: { post_title: 'HIN / Arts & Science, Nijodori Kyoto' },
            startday: '2099-07-10',
            endday: '2099-07-27',
          },
          {
            location: { post_title: 'HIN / Arts & Science, Aoyama' },
            startday: '2099-07-31',
            endday: '2099-08-11',
          },
        ],
        event_details: {
          repeater_event_details: [
            { event_detail_heading: 'KYOTO', event_detail_text: '<p>Kyoto schedule</p>' },
            { event_detail_heading: 'TOKYO', event_detail_text: '<p>Tokyo schedule</p>' },
          ],
        },
      },
    },
    {
      link: 'https://arts-science.com/events/tokyo-only/',
      acf: {
        period: [
          {
            location: { post_title: 'HIN / Arts & Science, Aoyama' },
            startday: '2099-07-31',
            endday: '2099-08-11',
          },
        ],
        event_details: {
          repeater_event_details: [
            { event_detail_heading: 'TOKYO', event_detail_text: '<p>Tokyo schedule</p>' },
          ],
        },
      },
    },
    {
      link: 'https://arts-science.com/events/past-kyoto/',
      acf: {
        period: [
          {
            location: { post_title: 'A&S Kyoto' },
            startday: '2020-01-01',
            endday: '2020-01-02',
          },
        ],
        event_details: {
          repeater_event_details: [
            { event_detail_heading: 'STORES', event_detail_text: '<p>A&S Kyoto</p>' },
          ],
        },
      },
    },
  ]);

  assert.ok(source);
  assert.equal(source.beta, true);
  assert.deepEqual(detailUrlExtractors[source.slug](listingJson), [kyotoUrl]);

  const event = eventExtractors[source.slug](
    `<main class="eventsDetail">
      <h1 class="hero__title">KITAWORKS Exhibition vol.4</h1>
      <p class="hero__lead">Useful description of the furniture exhibition and participating maker.</p>
      <img class="hero__image" src="https://arts-science.com/wp/uploads/kitaworks.jpg">
      <dl>
        <dt class="event__heading">KYOTO</dt>
        <dd class="event__detail"><p><a href="/stores/hin/">HIN / Arts &amp; Science, Nijodori Kyoto</a><br>2026年7月10日（金） — 7月27日（月） / 12:00 – 18:00</p></dd>
        <dt class="event__heading">TOKYO</dt>
        <dd class="event__detail"><p><a href="/stores/hin-aoyama/">HIN / Arts &amp; Science, Aoyama</a><br>2026年7月31日（金） — 8月11日（火） / 11:00 – 19:00</p></dd>
      </dl>
    </main>`,
    source,
    kyotoUrl,
  );

  assert.equal(event.title, 'KITAWORKS Exhibition vol.4');
  assert.equal(event.venue_name, 'HIN / Arts & Science, Nijodori Kyoto');
  assert.equal(event.start_date, '2026-07-10');
  assert.equal(event.end_date, '2026-07-27');
  assert.equal(event.primary_image_url, 'https://arts-science.com/wp/uploads/kitaworks.jpg');

  const englishEvent = eventExtractors[source.slug](
    `<h1 class="hero__title">KITAWORKS Exhibition vol.4</h1>
     <p class="hero__lead">Useful English exhibition description for visitors.</p>
     <img class="hero__image" src="https://arts-science.com/wp/uploads/kitaworks.jpg">
     <dl><dt class="event__heading">KYOTO</dt><dd class="event__detail"><p><a>HIN / Arts &amp; Science, Nijodori Kyoto</a><br>July 10th (Friday) — July 27th (Monday) 2026 / 12:00 – 18:00</p></dd></dl>`,
    source,
    'https://arts-science.com/en/events/kyoto-and-tokyo/',
  );
  assert.equal(englishEvent.start_date, '2026-07-10');
  assert.equal(englishEvent.end_date, '2026-07-27');
});

test('source config includes Imura Art exhibition tabs', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'imura-art');

  assert.equal(source?.name, 'Imura Art');
  assert.equal(source?.language, 'en');
  assert.deepEqual(source?.start_urls, [
    'https://www.imuraart.com/exhibition/current.html',
    'https://www.imuraart.com/exhibition/future.html',
  ]);
  assert.equal(source?.selectors?.listing_links, '.content a.c-card');
  assert.equal(source?.crawl_hints?.requires_render, true);
  assert.deepEqual(source?.locales?.en?.start_urls, source?.start_urls);
});

test('source config includes Purple Purple with Japanese default', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'purple-purple');

  assert.equal(source?.name, 'Purple Purple');
  assert.equal(source?.language, 'ja');
  assert.deepEqual(source?.start_urls, ['https://purple-purple.com/exhibition/']);
  assert.equal(source?.selectors?.listing_links, '#exhibition .ind_in a');
  assert.equal(source?.locales?.ja?.start_urls?.[0], 'https://purple-purple.com/exhibition/');
  assert.equal(source?.locales?.en?.start_urls?.[0], 'https://purple-purple.com/en/exhibition/');
  assert.match(source?.notes ?? '', /English top link is https:\/\/purple-purple\.com\/en\//);
});

test('source config includes Museum of Kyoto special exhibitions', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'museum-of-kyoto');
  const listingHtml = `
    <a href="https://www.bunpaku.or.jp/exhi_special_post_en/20260704-0906/" class="look-item">
      <figure class="poster_img">
        <img src="https://www.bunpaku.or.jp/wp-content/uploads/2026/03/20260704-0906_marimekko_poster-2.webp" alt="">
      </figure>
    </a>
    <a href="https://www.bunpaku.or.jp/en/general_exhibition/">General Exhibition</a>
  `;
  const detailHtml = `
    <section id="single_main">
      <div class="title_box"><span>Title</span><p>Marimekko: Art of Printmaking-Beauty,Dream,Love</p></div>
      <div class="date_box"><span>Date</span><p>2026.7.4(Sat) 〜 9.6(Sun)</p></div>
      <div class="outline"><p>Marimekko special exhibition copy.</p></div>
      <figure class="right poster_img">
        <img src="https://www.bunpaku.or.jp/wp-content/uploads/2026/03/20260704-0906_marimekko_poster-2.webp" alt="">
      </figure>
      <div class="poster_img">
        <img src="https://www.bunpaku.or.jp/wp-content/uploads/2026/03/related-poster.webp" alt="">
      </div>
    </section>
  `;

  assert.equal(source?.name, 'The Museum of Kyoto');
  assert.equal(source?.language, 'en');
  assert.deepEqual(source?.start_urls, ['https://www.bunpaku.or.jp/en/exhi_special/']);
  assert.equal(source?.selectors?.listing_links, 'a.look-item[href*="/exhi_special_post_en/"]');
  assert.equal(source?.selectors?.images, '#single_main .right.poster_img img');
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://www.bunpaku.or.jp/en/exhi_special/', source, 6),
    ['https://www.bunpaku.or.jp/exhi_special_post_en/20260704-0906/'],
  );

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://www.bunpaku.or.jp/exhi_special_post_en/20260704-0906/',
  );

  assert.equal(event.title, 'Marimekko: Art of Printmaking-Beauty,Dream,Love');
  assert.equal(event.date_text, '2026.7.4(Sat) 〜 9.6(Sun)');
  assert.equal(event.start_date, '2026-07-04');
  assert.equal(event.end_date, '2026-09-06');
  assert.equal(
    event.primary_image_url,
    'https://www.bunpaku.or.jp/wp-content/uploads/2026/03/20260704-0906_marimekko_poster-2.webp',
  );
  assert.deepEqual(event.image_urls, [
    'https://www.bunpaku.or.jp/wp-content/uploads/2026/03/20260704-0906_marimekko_poster-2.webp',
  ]);
});

test('source config includes Hosomi Museum current exhibition', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'hosomi-museum');
  const detailHtml = `
    <div id="exhi_waku" class="exhibition">
      <h2>Water Sceneries： An Invitation to Cool Serenity</h2>
      <div class="opening" id="time">
        <h4>June 13 (Sat) – August 2 (Sun), 2026</h4>
      </div>
      <img src="../../img_exhi/ex093/main_ban-pc.jpg" alt="Water Sceneries" width="650" />
      <ul class="exhi_credit"><li>Opening Hours<h3><b>10:00 am to 5:00 pm</b></h3></li></ul>
    </div>
    <a href="collection.html">Collection</a>
    <img src="../../hosomi_images/back_eng.gif" alt="" />
  `;

  assert.equal(source?.name, 'Hosomi Museum');
  assert.equal(source?.language, 'en');
  assert.deepEqual(source?.start_urls, ['https://www.emuseum.or.jp/eng/exhibition_eng/index.html']);
  assert.deepEqual(detailUrlExtractors['hosomi-museum'](detailHtml, source.start_urls[0]), [
    'https://www.emuseum.or.jp/eng/exhibition_eng/index.html',
  ]);

  const event = extractGenericEvent(detailHtml, source, source.start_urls[0]);

  assert.equal(event.title, 'Water Sceneries： An Invitation to Cool Serenity');
  assert.equal(event.date_text, 'June 13 (Sat) – August 2 (Sun), 2026');
  assert.equal(event.start_date, '2026-06-13');
  assert.equal(event.end_date, '2026-08-02');
  assert.deepEqual(event.image_urls, ['https://www.emuseum.or.jp/img_exhi/ex093/main_ban-pc.jpg']);
});

test('source config includes KyotoBa gallery events with Japanese default', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'kyotoba');

  assert.equal(source?.name, 'KyotoBa');
  assert.equal(source?.language, 'ja');
  assert.deepEqual(source?.start_urls, ['https://kyoto-ba.jp/gallery/']);
  assert.equal(source?.selectors?.listing_links, '.mec-event-title a');
  assert.equal(source?.selectors?.title, '.mec-single-title');
  assert.equal(source?.locales?.ja?.start_urls?.[0], 'https://kyoto-ba.jp/gallery/');
  assert.match(source?.notes ?? '', /Gallery events are listed on \/gallery\//);
});

test('source config includes hakari contemporary exhibition cards', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'hakari-contemporary');
  const listingHtml = `
    <figure><a href="https://hakari.art/exhibitions/ateleology/">Ateleology</a></figure>
    <nav><a href="https://hakari.art/about/">About</a></nav>
  `;

  assert.equal(source?.name, 'hakari contemporary');
  assert.equal(source?.language, 'ja');
  assert.deepEqual(source?.start_urls, ['https://hakari.art/exhibitions/']);
  assert.equal(source?.selectors?.listing_links, 'figure a');
  assert.equal(source?.capabilities?.machine_translate_missing_locales, true);
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://hakari.art/exhibitions/', source, 6),
    ['https://hakari.art/exhibitions/ateleology/'],
  );
});

test('source config includes Sokyo Kyoto location exhibitions', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'sokyo-kyoto');

  assert.equal(source?.name, 'Sokyo Kyoto');
  assert.equal(source?.language, 'ja');
  assert.deepEqual(source?.start_urls, ['https://sokyogallery.com/exhibitions/']);
  assert.deepEqual(source?.selectors?.listing_links, [
    '#exhibitions-grid-current a[href*="/exhibitions/"][href$="/overview/"]',
    '#exhibitions-grid-upcoming a[href*="/exhibitions/"][href$="/overview/"]',
  ]);
  assert.equal(source?.locales?.ja?.start_urls?.[0], 'https://sokyogallery.com/exhibitions/');
  assert.equal(source?.locales?.en?.start_urls?.[0], 'https://sokyogallery.com/en/exhibitions/');
  assert.match(source?.notes ?? '', /Current and Upcoming/);
});

test('source config follows Kuramonzen detail pages for per-event fields', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'kuramonzen');
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

  assert.equal(source?.language, 'en');
  assert.deepEqual(source?.locales?.ja?.start_urls, [
    'https://kuramonzen.com/ja/blogs/exhibitions',
  ]);
  assert.deepEqual(source?.locales?.en?.start_urls, ['https://kuramonzen.com/blogs/exhibitions']);
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://kuramonzen.com/blogs/exhibitions', source, 4),
    [
      'https://kuramonzen.com/blogs/exhibitions/2026-solo-exhibition',
      'https://kuramonzen.com/blogs/exhibitions/nomura-ko',
    ],
  );

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://kuramonzen.com/blogs/exhibitions/nomura-ko',
  );

  assert.equal(event.title, '野村 耕 -Nomura Ko || SCREAMING LOTS OF DIFFERENT SONGS');
  assert.equal(event.date_text, '2026.02.28 - 06.01');
  assert.equal(event.start_date, '2026-02-28');
  assert.equal(event.end_date, '2026-06-01');
  assert.equal(
    event.primary_image_url,
    'https://kuramonzen.com/cdn/shop/articles/nomura.jpg?v=1776495202',
  );
  assert.doesNotMatch(event.description, /Others exhibitions/);
  assert.deepEqual(event.image_urls, [
    'https://kuramonzen.com/cdn/shop/articles/nomura.jpg?v=1776495202',
    'https://cdn.shopify.com/s/files/1/0658/7472/3063/files/work.jpg?v=1',
  ]);
});

test('Hakari extraction keeps prose and skips both poster images', () => {
  const event = eventExtractors['hakari-contemporary'](
    `
      <title>非道| Ateleology - hakari contemporary</title>
      <div class="post_content">
        <figure><img src="data:image/gif;base64,placeholder" data-src="https://hakari.art/wp-content/uploads/Ateleology_KV_1080_1920.jpg" width="1920" height="1080"></figure>
        <figure><img data-src="https://hakari.art/wp-content/uploads/Ateleology_KV_1080_1350.jpg" width="1080" height="1350"></figure>
        <p><strong>Floating Island</strong><br>Feb. 15 - Mar. 15, 2025<br>12:00 - 18:00</p>
        <p>このたび、hakari contemporaryでは、展覧会「Floating Island」を開催いたします。</p>
        <p>本展では、映像、彫刻、パフォーマンスを通して、身体と知覚の関係を問い直します。</p>
        <p>Hakari Contemporary is pleased to present “Floating Island,” a new exhibition.</p>
        <figure><img data-src="https://hakari.art/wp-content/uploads/Installation-View.jpg" width="1600" height="1200"></figure>
        <figure><img data-src="https://hakari.art/wp-content/uploads/Artwork_Ask-Anything.jpg" width="1600" height="1200"></figure>
      </div>
    `,
    {
      slug: 'hakari-contemporary',
      name: 'hakari contemporary',
      address_text: 'Porte de Okazaki #103, Kyoto',
      taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
    },
    'https://hakari.art/exhibitions/floating-island/',
  );

  assert.equal(event.title, '非道| Ateleology');
  assert.equal(event.date_text, 'Feb 15 - Mar 15, 2025');
  assert.equal(event.start_date, '2025-02-15');
  assert.equal(event.end_date, '2025-03-15');
  assert.equal(
    event.description,
    'このたび、hakari contemporaryでは、展覧会「Floating Island」を開催いたします。\n\n本展では、映像、彫刻、パフォーマンスを通して、身体と知覚の関係を問い直します。',
  );
  assert.equal(
    event.primary_image_url,
    'https://hakari.art/wp-content/uploads/Installation-View.jpg',
  );
  assert.deepEqual(event.image_urls, [
    'https://hakari.art/wp-content/uploads/Installation-View.jpg',
    'https://hakari.art/wp-content/uploads/Artwork_Ask-Anything.jpg',
  ]);
});

test('SAMAC extraction keeps only the first image', () => {
  const event = eventExtractors.samac(
    `
      <title>Summer Exhibition | SAMAC</title>
      <meta property="og:image" content="https://www.samac.jp/images/exhibition/main.jpg">
      <p>Summer exhibition description with enough text for generic extraction.</p>
      <img src="https://www.samac.jp/images/exhibition/detail-1.jpg" width="1200" height="800">
      <img src="https://www.samac.jp/images/exhibition/detail-2.jpg" width="1200" height="800">
    `,
    {
      slug: 'samac',
      name: 'SAMAC',
      taxonomy: testTaxonomy(['museum'], [], ['exhibition']),
    },
    'https://www.samac.jp/en/exhibition/example.php',
  );

  assert.equal(event.primary_image_url, 'https://www.samac.jp/images/exhibition/detail-1.jpg');
  assert.deepEqual(event.image_urls, ['https://www.samac.jp/images/exhibition/detail-1.jpg']);
});

test('source config keeps MTK exhibition links in listing order', async () => {
  const payload = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, '../../../data/sources/kyoto-sources.json'),
      'utf8',
    ),
  );
  const source = payload.sources.find((item) => item.slug === 'mtk');
  const listingHtml = `
    <ul class="ex__list">
      <li><a href="https://mtkcontemporaryart.com/exhibition/paths/">Paths</a></li>
      <li><a href="https://mtkcontemporaryart.com/exhibition/it_takes_two/">It Takes Two</a></li>
    </ul>
    <div class="pagination"><a href="https://mtkcontemporaryart.com/exhibition/page/2/">2</a></div>
  `;

  assert.equal(source?.selectors?.listing_links, '.ex__list a');
  assert.deepEqual(
    extractGenericDetailUrls(listingHtml, 'https://mtkcontemporaryart.com/exhibition/', source, 8),
    [
      'https://mtkcontemporaryart.com/exhibition/paths/',
      'https://mtkcontemporaryart.com/exhibition/it_takes_two/',
    ],
  );
});

test('noisy generic sources pin event title and discovery fields', async () => {
  const sources = await loadAllSourcesConfig();
  const plusY = sources.find((source) => source.slug === 'plus-y-gallery');
  const artcourt = sources.find((source) => source.slug === 'artcourt-gallery');
  const tobikan = sources.find((source) => source.slug === 'tokyo-metropolitan-art-museum');
  const opera = sources.find((source) => source.slug === 'tokyo-opera-city-art-gallery');
  const momat = sources.find((source) => source.slug === 'national-museum-of-modern-art-tokyo');
  const yamatane = sources.find((source) => source.slug === 'yamatane-museum-of-art');
  const kouichi = sources.find((source) => source.slug === 'kouichi-fine-arts');

  const plusYEvent = extractGenericEvent(
    `<main id="content_area"><div class="j-text"><p>Past</p><p>北辻 良央 展</p><p>会期 ｜ 2026年7月19日ー8月12日</p></div><img src="/show.jpg"></main>`,
    plusY,
    'https://www.plus-y-gallery.com/2026-example/',
  );
  const artcourtUrls = extractGenericDetailUrls(
    `<section class="ex-sec"><h2>Current Exhibitions</h2>
      <article><a href="/eng/exhibitions/14290/">Current one</a></article>
      <article><a href="/eng/exhibitions/14008/">Current two</a></article>
    </section>
    <section class="ex-sec ex-sec_past"><h2>Past Exhibitions</h2>
      <article><a href="/eng/exhibitions/14239/">Past</a></article>
    </section>`,
    artcourt.start_urls[0],
    artcourt,
    8,
  );
  const artcourtEvent = extractGenericEvent(
    `<div class="ex-header-text"><h1>Current show</h1><p>2026. 7. 11 [sat] - 8.29 [sat]</p></div>
    <ul id="mvSlider"><li><img src="/eng/wp-content/uploads/sites/2/current.jpg"></li></ul>
    <section class="ex-contents-about"><p>Current exhibition description with enough useful detail for visitors.</p></section>`,
    artcourt,
    'https://www.artcourtgallery.com/eng/exhibitions/14290/',
  );

  assert.equal(plusYEvent.title, '北辻 良央 展');
  assert.equal(plusYEvent._title_origin, 'configured_selector');
  assert.equal(artcourt.start_urls[0], 'https://www.artcourtgallery.com/eng/exhibitions/');
  assert.deepEqual(artcourtUrls, [
    'https://www.artcourtgallery.com/eng/exhibitions/14290/',
    'https://www.artcourtgallery.com/eng/exhibitions/14008/',
  ]);
  assert.equal(artcourt?.selectors?.title, '.ex-header-text h1');
  assert.equal(artcourtEvent.start_date, '2026-07-11');
  assert.equal(artcourtEvent.end_date, '2026-08-29');
  assert.equal(artcourtEvent._description_origin, 'configured_selector');
  assert.equal(
    artcourtEvent.primary_image_url,
    'https://www.artcourtgallery.com/eng/wp-content/uploads/sites/2/current.jpg',
  );
  assert.equal(tobikan?.selectors?.listing_links, '.exhibition-item');
  assert.equal(tobikan?.selectors?.title, '.exhibition-header-title');
  assert.equal(opera?.selectors?.listing_links, "main a[href*='/ag/exh/']");
  assert.ok(opera?.crawl_hints?.skip_patterns.includes('/ag/exh/current_exhibitions'));
  assert.equal(momat?.selectors?.description, '#section-01 p');
  assert.deepEqual(yamatane?.selectors?.description, [
    '.l-exhibition-intro__text',
    '.l-exhibition-intro__content p',
  ]);
  assert.equal(kouichi?.selectors?.description, '.HTML__Container-sc-1im40xc-0 p');
});

test('new Osaka gallery sources discover concrete exhibition details', async () => {
  const sources = await loadAllSourcesConfig();
  const artAndSpace = sources.find((source) => source.slug === 'art-and-space-gallery');
  const iGallery = sources.find((source) => source.slug === 'i-gallery-osaka');
  const ichion = sources.find((source) => source.slug === 'ichion-contemporary');

  assert.ok(artAndSpace);
  assert.ok(iGallery);
  assert.ok(ichion);
  assert.equal(artAndSpace.beta, true);
  assert.equal(iGallery.beta, true);
  assert.equal(ichion.beta, true);

  assert.deepEqual(
    extractGenericDetailUrls(
      `<div class="archive_card_layout">
        <article class="archive_card"><a href="/exhibition/fix/">FIX</a></article>
        <article class="archive_card"><a href="/exhibition/older/">Older</a></article>
      </div>`,
      artAndSpace.start_urls[0],
      artAndSpace,
      8,
    ),
    ['https://art.andspace.net/exhibition/fix/', 'https://art.andspace.net/exhibition/older/'],
  );
  const artAndSpaceEvent = extractGenericEvent(
    `<main>
      <div class="single_thumbnail"><img src="/wp/uploads/fix.jpg" alt="FIX"></div>
      <h1 class="single_main_title">FIX</h1>
      <p class="single_info"><span class="date">2026.06.26-07.24</span></p>
      <div class="single_body"><p>Substantive exhibition description for the current ART AND SPACE show.</p></div>
    </main>`,
    artAndSpace,
    'https://art.andspace.net/exhibition/fix/',
  );
  assert.equal(artAndSpaceEvent.title, 'FIX');
  assert.equal(artAndSpaceEvent.start_date, '2026-06-26');
  assert.equal(artAndSpaceEvent.end_date, '2026-07-24');
  assert.equal(artAndSpaceEvent.primary_image_url, 'https://art.andspace.net/wp/uploads/fix.jpg');

  const iGalleryUrls = [
    ...new Set(
      [
        `<main><a href="/liakimura-i-gallery-osaka">Learn More</a></main>`,
        `<main>
          <a href="/archive-2025">2025</a>
          <a href="/tokyobuild-iteration"><img src="/tokyobuild.jpg"></a>
          <a href="/aiyoshida-floating"><img src="/floating.jpg"></a>
        </main>`,
      ].flatMap((html, index) =>
        extractGenericDetailUrls(html, iGallery.start_urls[index], iGallery, 8),
      ),
    ),
  ];
  assert.deepEqual(iGalleryUrls, [
    'https://www.igallery-osaka.com/liakimura-i-gallery-osaka',
    'https://www.igallery-osaka.com/tokyobuild-iteration',
    'https://www.igallery-osaka.com/aiyoshida-floating',
  ]);
  const iGalleryEvent = eventExtractors['i-gallery-osaka'](
    `<main>
      <h2>リア・キムラ</h2><h2>Remnants</h2>
      <p>i GALLERY OSAKAでは、リア・キムラによる個展「Remnants」を開催いたします。</p>
      <p>本展では、像が消失へ向かう途中に生まれる存在の気配に焦点を当てます。</p>
      <p>2026年7月4日(土) - 8月3日(月)</p>
      <img src="https://static.wixstatic.com/media/remnants.jpg" width="980" height="587">
    </main>`,
    iGallery,
    'https://www.igallery-osaka.com/liakimura-i-gallery-osaka',
  );
  assert.equal(iGalleryEvent.title, 'リア・キムラ — Remnants');
  assert.equal(iGalleryEvent.start_date, '2026-07-04');
  assert.equal(iGalleryEvent.end_date, '2026-08-03');
  assert.match(iGalleryEvent.description, /個展「Remnants」/u);
  assert.equal(iGalleryEvent.primary_image_url, 'https://static.wixstatic.com/media/remnants.jpg');

  const iGalleryOldEvent = eventExtractors['i-gallery-osaka'](
    `<main>
      <p>吉田 愛</p><p>浮遊</p><p>2026年4月10日 - 27日</p>
      <p>本展「浮遊」において、吉田愛は自然環境の中で生成された作品を都市へ導入します。</p>
      <img src="https://static.wixstatic.com/media/floating.jpg" width="980" height="587">
    </main>`,
    iGallery,
    'https://www.igallery-osaka.com/aiyoshida-floating',
  );
  assert.equal(iGalleryOldEvent.title, '吉田 愛 — 浮遊');
  assert.equal(iGalleryOldEvent.start_date, '2026-04-10');
  assert.equal(iGalleryOldEvent.end_date, '2026-04-27');

  const ichionListingHtml = `<div class="ExhibitionList">
    <div class="exhibition">
      <h3 class="title"><span>Landscape</span><span>水の記憶 交差する視線</span></h3>
      <p class="date">2026.06.29 Mon. - 2026.07.31 Fri.</p>
      <div class="lernMore"><a class="TextLink" href="/exhibition/xm8ojagre0-0">Learn More</a></div>
    </div>
  </div>`;
  const ichionUrls = extractGenericDetailUrls(ichionListingHtml, ichion.start_urls[0], ichion, 8);
  assert.deepEqual(ichionUrls, ['https://ichion-contemporary.com/exhibition/xm8ojagre0-0']);
  const ichionEvent = eventExtractors['ichion-contemporary'](
    `<title>Landscape | Exhibition | ICHION CONTEMPORARY</title>
    <main class="ExhibitionDetail">
      <div class="kv"><img src="https://images.microcms-assets.io/landscape.jpg"></div>
      <div class="section">
        <p>横溝美由紀は、時間、空間、光を重要な要素とするインスタレーションを発表してきました。</p>
        <p>近年は平面作品を組み合わせ、展示空間との関係から心象風景を立ち上げています。</p>
      </div>
      <div class="image"><img src="https://images.microcms-assets.io/artwork.jpg"></div>
    </main>`,
    ichion,
    ichionUrls[0],
    { listingPages: [{ html: ichionListingHtml, url: ichion.start_urls[0] }] },
  );
  assert.equal(ichionEvent.title, 'Landscape 水の記憶 交差する視線');
  assert.equal(ichionEvent.start_date, '2026-06-29');
  assert.equal(ichionEvent.end_date, '2026-07-31');
  assert.equal(ichionEvent._date_origin, 'listing_card');
  assert.deepEqual(ichionEvent.image_urls, [
    'https://images.microcms-assets.io/landscape.jpg',
    'https://images.microcms-assets.io/artwork.jpg',
  ]);
  const ichionEnglishEvent = eventExtractors['ichion-contemporary'](
    `<title>Landscape Memories of Water: Intersecting Gazes | Exhibition | ICHION CONTEMPORARY</title>
    <main><div class="section"><p>Exhibition description with enough detail for visitors to understand the current show.</p></div></main>`,
    { ...ichion, language: 'en' },
    'https://ichion-contemporary.com/en/exhibition/xm8ojagre0-0',
    { listingPages: [{ html: ichionListingHtml, url: ichion.start_urls[0] }] },
  );
  assert.equal(ichionEnglishEvent.title, 'Landscape Memories of Water: Intersecting Gazes');
});

test('reported Osaka title leaks resolve to concrete event pages and title nodes', async () => {
  const sources = await loadSourcesConfig({ city: 'osaka' });
  const newPure = sources.find((source) => source.slug === 'new-pure-plus');
  const jitsuzaisei = sources.find((source) => source.slug === 'jitsuzaisei');
  const nakanoshima = sources.find((source) => source.slug === 'nakanoshima-kosetsu-museum');

  const newPureUrls = extractGenericDetailUrls(
    `
      <section id="current-section"><a title="Current show" href="/17318">Current show</a></section>
      <section id="upcoming-section"><a title="Upcoming show" href="/17349">Upcoming show</a></section>
      <a href="/exhibition/upcoming">Upcoming exhibition</a>
      <a href="/exhibition/past">Past exhibition</a>
    `,
    newPure.start_urls[0],
    newPure,
    6,
  );
  const jitsuzaiseiUrls = extractGenericDetailUrls(
    `
      <a href="/post/mirror-of-the-soul">Current exhibition</a>
      <a href="/post/reality-in-flux">Current exhibition</a>
      <a href="/post/luminescent-x">Next exhibition</a>
      <a href="/post/againstthegrid">Past exhibition</a>
      <a href="/post/pinkypop-osaka-exhibition">Past exhibition</a>
      <a href="/blog/categories/past-exhibitions">Past exhibitions</a>
      <a href="/news-topics">NEWS &amp; TOPICS</a>
    `,
    jitsuzaisei.start_urls[0],
    jitsuzaisei,
    getSourceDetailLimit(jitsuzaisei, 8, 50),
  );
  const nakanoshimaEvent = extractGenericEvent(
    `
      <div class="single__info__txtwrap--ttl">特別展「インコ イズ カミング！」</div>
      <h1>みどころ</h1>
      <p>2026年6月27日 - 2026年8月30日</p>
    `,
    nakanoshima,
    'https://www.kosetsu-museum.or.jp/nakanoshima/exhibition/now/',
  );

  assert.deepEqual(newPureUrls, ['https://newpureplus.com/17318', 'https://newpureplus.com/17349']);
  assert.deepEqual(jitsuzaiseiUrls, [
    'https://www.jitsuzaisei.com/post/mirror-of-the-soul',
    'https://www.jitsuzaisei.com/post/reality-in-flux',
    'https://www.jitsuzaisei.com/post/luminescent-x',
    'https://www.jitsuzaisei.com/post/againstthegrid',
    'https://www.jitsuzaisei.com/post/pinkypop-osaka-exhibition',
  ]);
  assert.equal(nakanoshimaEvent.title, '特別展「インコ イズ カミング！」');
  assert.equal(nakanoshimaEvent._title_origin, 'configured_selector');
});

test('Tokyo Metropolitan Art Museum keeps only the exhibition poster', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((candidate) => candidate.slug === 'tokyo-metropolitan-art-museum');
  const posterUrl = 'https://www.tobikan.jp/media/img/poster/2026_britishmuseum_l.jpg';
  const event = extractGenericEvent(
    `<meta property="og:image" content="https://tobikan.jp/media/img/poster/2026_britishmuseum_l.jpg">
     <h1>British Museum Exhibition</h1>
     <p>July 25, 2026 - October 18, 2026</p>
     <div class="exhibition-poster"><img src="../../media/img/poster/2026_britishmuseum_l.jpg"></div>
     <img src="https://tobikan.jp/media/img/poster/2026_britishmuseum_l.jpg">`,
    source,
    'https://www.tobikan.jp/en/exhibition/2026_britishmuseum.html',
  );

  assert.equal(source?.selectors?.images, '.exhibition-poster');
  assert.equal(source?.skip_og_image, true);
  assert.deepEqual(event.image_urls, [posterUrl]);
});

test('crawl QA report summarizes saved events, missing translations, and diagnostics', () => {
  assert.deepEqual(
    buildCrawlQaReport({
      source: { slug: 'example-gallery' },
      sourceOutcome: 'source_ok',
      detailUrls: ['https://example.test/one', 'https://example.test/two'],
      savedEvents: [{ translations: ['ja', 'en'] }, { translations: ['ja'] }],
      skippedEvents: [{ reason: 'missing image' }, { reason: 'missing valid description' }],
      diagnostics: {
        fetched_static_count: 2,
        fetched_crawl4ai_count: 1,
        retry_count: 1,
        bot_challenge_count: 0,
        js_shell_count: 1,
        missing_image_count: 1,
        skipped_missing_date_count: 0,
        skipped_missing_description_count: 1,
        skipped_past_count: 0,
        skipped_old_count: 0,
        skipped_other_count: 0,
        crawl4ai_render_count: 1,
        crawl4ai_render_limit: 5,
        crawl4ai_render_skipped_count: 0,
        description_recovered_count: 1,
        description_rejected_count: 0,
        description_missing_count: 0,
        description_extractions: [
          {
            url: 'https://example.test/one',
            origin: 'page_body',
            valid: true,
            recovered: true,
            rejections: [],
          },
        ],
      },
    }),
    {
      source: 'example-gallery',
      outcome: 'source_ok',
      detail_urls_found: 2,
      events_saved: 2,
      events_skipped: 2,
      missing_translations: { en: 1, ja: 0 },
      fetch: {
        static: 2,
        rendered: 1,
        retries: 1,
        bot_challenges: 0,
        js_shells: 1,
        detail_limit_hits: 0,
        detail_page_cache_hits: 0,
      },
      skips: {
        missing_image: 1,
        missing_date: 0,
        missing_description: 1,
        invalid_title: 0,
        past: 0,
        old: 0,
        other: 0,
        reasons: {
          'missing image': 1,
          'missing valid description': 1,
        },
      },
      titles: {
        render_retries: 0,
        extractions: [],
      },
      descriptions: {
        recovered: 1,
        rejected: 0,
        missing: 0,
        extractions: [
          {
            url: 'https://example.test/one',
            origin: 'page_body',
            valid: true,
            recovered: true,
            rejections: [],
          },
        ],
      },
      crawl4ai: {
        render_count: 1,
        render_limit: 5,
        render_skipped: 0,
      },
    },
  );
});

test('Postgres text sanitizer removes null bytes recursively', () => {
  assert.equal(sanitizePostgresText('a\u0000b'), 'ab');
  assert.deepEqual(
    sanitizePostgresJson({
      title: 'A\u0000B',
      nested: ['C\u0000D'],
    }),
    {
      title: 'AB',
      nested: ['CD'],
    },
  );
});

test('source locale config applies localized source names', async () => {
  const detailHtml = await readFile(resolve(fixturesRoot, 'generic-detail.html'), 'utf8');
  const source = withSourceLocaleConfig(
    {
      name: 'Kyoto Art Center',
      names: {
        ja: '京都芸術センター',
      },
      taxonomy: testTaxonomy(['institute'], [], ['exhibition']),
    },
    'ja',
  );

  const event = extractGenericEvent(
    detailHtml,
    source,
    'https://example.test/exhibitions/2026/quiet-forms/',
  );

  assert.equal(event.institution_name, '京都芸術センター');
  assert.equal(event.venue_name, '京都芸術センター');
});

test('source-specific skip rule drops MOMAK calendar pages', () => {
  assert.equal(
    getSourceSpecificSkipReason({ slug: 'momak' }, { title: 'Calendar of Events' }),
    'title contains calendar',
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'momak' },
      { title: 'Antonio Fontanesi: Transcending Landscape' },
    ),
    null,
  );
});

test('source-specific skip rule drops Kyocera Collection Room pages', () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'kyoto-city-kyocera-museum-of-art' },
      { title: 'Collection Room: Spring Collection' },
    ),
    'title contains Collection Room',
  );
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'kyoto-city-kyocera-museum-of-art' },
      { title: '［2026春期］コレクションルーム　特集「没後20年　井田照一」' },
    ),
    'title contains Collection Room',
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'kyoto-city-kyocera-museum-of-art' },
      { title: 'Special Exhibition' },
    ),
    null,
  );
});

test('Kankakari extraction parses exhibition periods and cleans title dates', () => {
  const source = {
    name: 'Kankakari',
    taxonomy: testTaxonomy(['gallery'], ['ceramics']),
    address_text: '15 Murasakino Shimotsukiyama-cho, Kita-ku, Kyoto Japan',
  };
  const gakuEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Gaku Nakazawa exhibition 4/4-19">
      <meta property="og:description" content="『中沢学 個展』 2026. 4. 4 sat - 19 sun 13:00-18:00 水曜休">
      <meta property="article:published_time" content="2026-03-24T01:30:14.114Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/gaku.jpg">
    `,
    source,
    'https://www.kankakari.com/single-post/gaku-nakazawa-exhibition-4-4-19',
  );
  const naotoEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Naoto Ishii exhibition 3/1-16">
      <meta property="og:description" content="石井直人 新作展2026. 3. 1 sun - 16 mon 時間 13:00-18:00">
      <meta property="article:published_time" content="2026-02-12T01:30:14.114Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/naoto.jpg">
    `,
    source,
    'https://www.kankakari.com/single-post/naoto-ishii-exhibition-3-1-16',
  );
  const titleOnlyEvent = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Title Date exhibition 6/1-15">
      <meta property="og:description" content="No explicit date in body.">
      <meta property="article:published_time" content="2026-05-29T06:55:56.481Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/title-only.jpg">
    `,
    source,
    'https://www.kankakari.com/single-post/title-date-exhibition-6-1-15',
  );

  assert.equal(gakuEvent.title, 'Gaku Nakazawa exhibition');
  assert.equal(gakuEvent.date_text, '2026-04-04 - 2026-04-19');
  assert.equal(gakuEvent.start_date, '2026-04-04');
  assert.equal(gakuEvent.end_date, '2026-04-19');
  assert.equal(naotoEvent.title, 'Naoto Ishii exhibition');
  assert.equal(naotoEvent.start_date, '2026-03-01');
  assert.equal(naotoEvent.end_date, '2026-03-16');
  assert.equal(titleOnlyEvent.title, 'Title Date exhibition');
  assert.equal(titleOnlyEvent.start_date, '2026-06-01');
  assert.equal(titleOnlyEvent.end_date, '2026-06-15');
});

test('Kusakabe extraction reads homepage order and replaces blurred Wix image', () => {
  const source = {
    slug: 'kusakabe-gallery',
    name: 'Kusakabe Gallery',
    address_text: '486 Nakatsukasa-cho, Kamigyo-ku, Kyoto',
    taxonomy: testTaxonomy(['gallery'], ['contemporary'], ['exhibition']),
  };
  const html = `
    <section>
      <p>Kusakabe gallery</p>
      <p>7月の展示のお知らせ</p>
      <p>2026年７月11日(Sat.)〜 7月21日(Tue)</p>
      <p>11:00 - 18:00　水曜日休み</p>
      <wow-image data-image-info="{&quot;imageData&quot;:{&quot;width&quot;:1418,&quot;height&quot;:1772,&quot;uri&quot;:&quot;f549a3_feature~mv2.png&quot;}}">
        <img src="https://static.wixstatic.com/media/f549a3_feature~mv2.png/v1/fill/w_56,h_70,blur_2/feature.png">
      </wow-image>
      <p>作品と同時に、Tシャツやポストカードにかたちを変えたものを同時に展示いたします。</p>
      <p>さまざまなジャンルの作品を、いつもと異なる視点からお楽しみください。</p>
    </section>
  `;
  const url = 'https://www.kusakabeg.com/';
  const event = eventExtractors[source.slug](html, source, url);

  assert.deepEqual(detailUrlExtractors[source.slug](html, url), [url]);
  assert.equal(event.title, '7月の展示のお知らせ');
  assert.equal(event.start_date, '2026-07-11');
  assert.equal(event.end_date, '2026-07-21');
  assert.equal(event.start_time_text, '11:00');
  assert.equal(event.end_time_text, '18:00');
  assert.equal(
    event.primary_image_url,
    'https://static.wixstatic.com/media/f549a3_feature~mv2.png',
  );
  assert.match(event.description, /Tシャツやポストカード/);
});

test('source-specific skip rule drops past Kankakari events', () => {
  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'kankakari' },
      {
        title: 'Past exhibition',
        start_date: '2020-03-01',
        end_date: '2020-03-16',
      },
    ),
    'past event',
  );

  assert.equal(
    getSourceSpecificSkipReason(
      { slug: 'kankakari' },
      {
        title: 'Future exhibition',
        start_date: '2099-03-01',
        end_date: '2099-03-16',
      },
    ),
    null,
  );
});

test('Raku Museum extraction keeps only the first image', async () => {
  const detailHtml = `
    <section class="tabContent">
      <h4>
        <span>Tea Bowls Across Time</span>
        <span>June 6, 2027 - September 6, 2027</span>
      </h4>
      <p>This exhibition brings together historic Raku tea bowls and related works from the collection.</p>
      <img src="/images/install-view.jpg" width="900" height="600" alt="Installation view">
      <img src="/images/second-view.jpg" width="900" height="600" alt="Second installation view">
    </section>
  `;
  const source = {
    name: 'Raku Museum',
    language: 'en',
    taxonomy: testTaxonomy(['museum']),
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    'https://www.raku-yaki.or.jp/e/museum/exhibition/forthcoming_exhibitions.html',
  );

  assert.equal(event.primary_image_url, 'https://www.raku-yaki.or.jp/images/install-view.jpg');
  assert.deepEqual(event.image_urls, ['https://www.raku-yaki.or.jp/images/install-view.jpg']);
});

test('Raku Museum detail URLs include current and forthcoming English tabs', () => {
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

  const urls = detailUrlExtractors['raku-museum'](
    listingHtml,
    'https://www.raku-yaki.or.jp/e/museum/exhibition/index.html',
  );

  assert.deepEqual(urls, [
    'https://www.raku-yaki.or.jp/e/museum/exhibition/index.html',
    'https://www.raku-yaki.or.jp/e/museum/exhibition/forthcoming_exhibitions.html',
  ]);
});

test('Raku Museum English exhibition extraction reads tab content date', () => {
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
    name: 'Raku Museum',
    taxonomy: testTaxonomy(['museum'], ['ceramics']),
    language: 'en',
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    'https://www.raku-yaki.or.jp/e/museum/exhibition/index.html',
  );

  assert.equal(
    event.title,
    'Special Exhibition: Raku Successive Generations - Raku Tea Bowls Crossing Time',
  );
  assert.equal(event.date_text, 'Saturday 25 April - Wednesday 26 August 2026');
  assert.equal(event.start_date, '2026-04-25');
  assert.equal(event.end_date, '2026-08-26');
  assert.equal(
    event.primary_image_url,
    'https://www.raku-yaki.or.jp/common/img/exhibition/flyer63.jpg',
  );
});

test('Raku Museum Japanese homepage extraction reads info row', () => {
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
    name: 'Raku Museum',
    taxonomy: testTaxonomy(['museum'], ['ceramics']),
    language: 'ja',
  };

  const event = extractRakuMuseumEvent(
    detailHtml,
    source,
    'https://www.raku-yaki.or.jp/index.html',
  );

  assert.equal(event.title, '特別展　樂歴代 −時代を超える茶碗たち−');
  assert.equal(event.date_text, '会 期：2026年4月25日（土）〜 8月26日（水）');
  assert.equal(event.start_date, '2026-04-25');
  assert.equal(event.end_date, '2026-08-26');
  assert.equal(event.source_url, 'https://www.raku-yaki.or.jp/index.html');
});

test('koen detail extraction crawls the main event page itself', () => {
  const urls = detailUrlExtractors['koen-kyoto'](
    `<main><h1>event information</h1></main>`,
    'https://koenkyoto.theshop.jp/p/00006',
  );

  assert.deepEqual(urls, ['https://koenkyoto.theshop.jp/p/00006']);
});

test('koen event extraction reads the main container listing', () => {
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
    name: 'koen',
    taxonomy: testTaxonomy(['gallery']),
    language: 'ja',
    address_text: '15-2 Ichijoji Tsukamotocho, Sakyo-ku, Kyoto 606-8176 Japan',
  };

  const event = eventExtractors['koen-kyoto'](
    detailHtml,
    source,
    'https://koenkyoto.theshop.jp/p/00006',
  );

  assert.equal(event.title, '“koen zine fair” 作品の募集');
  assert.equal(event.date_text, '開催日時 : 2025.11.1(土)-9(日) 11:00-22:00 ※月・火・水定休');
  assert.equal(event.start_date, '2025-11-01');
  assert.equal(event.end_date, '2025-11-09');
  assert.equal(event.description.includes('zineの展示販売会'), true);
  assert.equal(
    event.primary_image_url,
    'https://baseec-img-mng.akamaized.net/images/shop_front/koenkyoto-theshop-jp/79aef0731e7e60975e7cd0e589a13ef6.png',
  );
});

test('source-specific skip rule drops past koen events', () => {
  const reason = getSourceSpecificSkipReason(
    { slug: 'koen-kyoto' },
    {
      title: 'past koen event',
      start_date: '2025-11-01',
      end_date: '2025-11-09',
    },
  );

  assert.equal(reason, 'past event');
});

test('Sen-Oku extraction removes the trailing ad image', () => {
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
    name: 'Sen-Oku Hakukokan Museum',
    taxonomy: testTaxonomy(['museum']),
  };

  const event = extractSenOkuEvent(
    detailHtml,
    source,
    'https://sen-oku.or.jp/program/202604_special/',
  );

  assert.equal(event.title, 'Special Exhibition');
  assert.equal(event.primary_image_url, 'https://sen-oku.or.jp/wp-content/uploads/hero.jpg');
  assert.deepEqual(event.image_urls, [
    'https://sen-oku.or.jp/wp-content/uploads/hero.jpg',
    'https://sen-oku.or.jp/wp-content/uploads/detail-1.jpg',
    'https://sen-oku.or.jp/wp-content/uploads/detail-2.jpg',
  ]);
});

test('Sen-Oku title extraction drops subtitle spans without font wrapper', () => {
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
      name: 'Sen-Oku Hakukokan Museum',
      taxonomy: testTaxonomy(['museum']),
    },
    'https://sen-oku.or.jp/program/202604_special/',
  );

  assert.equal(event.title, 'Special Exhibition');
});

test('Gallery Unfold rejects its measured artist-link icon', async () => {
  const sources = await loadSourcesConfig({ city: 'kyoto' });
  const source = sources.find((candidate) => candidate.slug === 'gallery-unfold');
  const main = 'https://galleryunfold.com/img/exh/27/main%20visual.jpg';
  const linkIcon = 'https://galleryunfold.com/img/link.png';
  const normalized = await normalizeEventImagesForSource(
    {
      source_url: 'https://galleryunfold.com/archives/exh27',
      primary_image_url: main,
      image_urls: [main, linkIcon],
    },
    source,
    {
      fetchImageDimensionsFn: async (url) =>
        url === linkIcon ? { width: 40, height: 40 } : { width: 1200, height: 1200 },
    },
  );

  assert.equal(source?.measure_image_dimensions, true);
  assert.equal(normalized.primary_image_url, main);
  assert.deepEqual(normalized.image_urls, [main]);
});

test('image normalization rejects measured media below 540px and caps stored images', async () => {
  const diagnostics = createCrawlDiagnostics();
  const source = {
    measure_image_dimensions: true,
  };
  const event = {
    primary_image_url: 'https://example.test/narrow.jpg',
    image_urls: [
      'https://example.test/narrow.jpg',
      'https://example.test/hero.jpg',
      'https://example.test/gallery-1.jpg',
      'https://example.test/gallery-2.jpg',
      'https://example.test/gallery-3.jpg',
    ],
  };

  const normalized = await normalizeEventImagesForSource(event, source, {
    diagnostics,
    fetchImageDimensionsFn: async (url) =>
      url.includes('narrow')
        ? { width: 1200, height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX - 1 }
        : { width: 1200, height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX },
  });

  assert.deepEqual(normalized.image_urls, [
    'https://example.test/hero.jpg',
    'https://example.test/gallery-1.jpg',
    'https://example.test/gallery-2.jpg',
    'https://example.test/gallery-3.jpg',
  ]);
  assert.equal(normalized.primary_image_url, 'https://example.test/hero.jpg');
  assert.deepEqual(normalized.image_metadata, [
    {
      url: 'https://example.test/hero.jpg',
      width: 1200,
      height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX,
    },
    {
      url: 'https://example.test/gallery-1.jpg',
      width: 1200,
      height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX,
    },
    {
      url: 'https://example.test/gallery-2.jpg',
      width: 1200,
      height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX,
    },
    {
      url: 'https://example.test/gallery-3.jpg',
      width: 1200,
      height: MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX,
    },
  ]);
  assert.equal(diagnostics.image_dimension_probe_count, 5);
  assert.equal(diagnostics.image_dimension_probe_rejected_count, 1);
});

test('landing slider sources measure final image dimensions without a second opt-in', async () => {
  let probes = 0;
  const imageUrl = 'https://example.test/landing.jpg';
  const normalized = await normalizeEventImagesForSource(
    {
      source_url: 'https://example.test/exhibition',
      primary_image_url: imageUrl,
      image_urls: [imageUrl],
    },
    { landing_slider: true },
    {
      fetchImageDimensionsFn: async () => {
        probes += 1;
        return { width: 2000, height: 1500 };
      },
    },
  );

  assert.equal(probes, 1);
  assert.deepEqual(normalized.image_metadata, [{ url: imageUrl, width: 2000, height: 1500 }]);
});

test('requested Kyoto sources are landing slider sources', async () => {
  const sources = await loadSourcesConfig({ city: 'kyoto' });

  for (const slug of [
    'leica-gallery-kyoto',
    'sokyo-kyoto',
    'gallery-yamahon',
    'hakari-contemporary',
    'zenbi',
  ]) {
    assert.equal(sources.find((source) => source.slug === slug)?.landing_slider, true, slug);
  }
});

test('final media safety filters custom UI and LQIP candidates without reordering', async () => {
  const normalized = await normalizeEventImagesForSource(
    {
      source_url: 'https://example.test/exhibitions/example/',
      primary_image_url: '/assets/icon-share.svg',
      image_urls: [
        '/assets/icon-share.svg',
        'https://static.wixstatic.com/media/w_40,h_40,blur_2/preview.jpg',
        '/images/second-artwork.jpg',
        '/images/first-artwork.jpg',
      ],
    },
    {},
  );

  assert.deepEqual(normalized.image_urls, [
    'https://example.test/images/second-artwork.jpg',
    'https://example.test/images/first-artwork.jpg',
  ]);
  assert.equal(normalized.primary_image_url, 'https://example.test/images/second-artwork.jpg');
});

test('suspicious unknown image is probed but retained when probe fails', async () => {
  const diagnostics = createCrawlDiagnostics();
  const normalized = await normalizeEventImagesForSource(
    {
      source_url: 'https://example.test/exhibitions/example/',
      primary_image_url: '/images/exhibition-thumb.jpg',
      image_urls: ['/images/exhibition-thumb.jpg'],
    },
    {},
    {
      diagnostics,
      fetchImageDimensionsFn: async () => {
        throw new Error('probe failed');
      },
    },
  );

  assert.deepEqual(normalized.image_urls, ['https://example.test/images/exhibition-thumb.jpg']);
  assert.equal(diagnostics.image_dimension_probe_count, 1);
  assert.equal(diagnostics.image_dimension_probe_failed_count, 1);
});

test('image normalization caps non-offender event images at five', async () => {
  const normalized = await normalizeEventImagesForSource(
    {
      primary_image_url: 'https://example.test/hero.jpg',
      image_urls: [
        'https://example.test/hero.jpg',
        'https://example.test/gallery-1.jpg',
        'https://example.test/gallery-2.jpg',
        'https://example.test/gallery-3.jpg',
        'https://example.test/gallery-4.jpg',
      ],
    },
    {},
  );

  assert.deepEqual(normalized.image_urls, [
    'https://example.test/hero.jpg',
    'https://example.test/gallery-1.jpg',
    'https://example.test/gallery-2.jpg',
    'https://example.test/gallery-3.jpg',
    'https://example.test/gallery-4.jpg',
  ]);
});

test('image byte parser reads common remote image dimensions', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAIAAAD2HxkiAAAAAklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUrIIBAAAMAAGQvR6bAAAAAElFTkSuQmCC',
    'base64',
  );

  assert.deepEqual(parseImageDimensionsFromBytes(png, 'image/png'), {
    width: 300,
    height: 80,
  });
});

test('Chushin extraction treats exh sections as individual events', () => {
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
    <section class="" id="exh071">
      <h2 class="cate_heading02">六兵衛清水 CERAMIC SIGHT</h2>
      <h3 class="cate_heading03">２０２４年２月７日（水）～３月１５日（金） 月曜日休館</h3>
      <img src="/bijyutu/exhibition/images/img_bijyutu_exhibition_71.jpg" alt="">
    </section>
  `;
  const source = {
    name: 'Chushin Museum of Art',
    taxonomy: testTaxonomy(['museum']),
  };

  const urls = extractChushinDetailUrls(
    listingHtml,
    'https://www.chushin.co.jp/bijyutu/exhibition/index.html',
  );

  assert.deepEqual(urls, [
    'https://www.chushin.co.jp/bijyutu/exhibition/index.html#exh073',
    'https://www.chushin.co.jp/bijyutu/exhibition/index.html#exh072',
    'https://www.chushin.co.jp/bijyutu/exhibition/index.html#exh071',
  ]);

  const event = extractChushinEvent(listingHtml, source, urls[0]);

  assert.equal(event.title, '山本容子版画展 物語をつつむ');
  assert.equal(event.start_date, '2026-05-12');
  assert.equal(event.end_date, '2026-06-26');
  assert.equal(
    event.primary_image_url,
    'https://www.chushin.co.jp/bijyutu/exhibition/images/img_bijyutu_exhibition_73.jpg',
  );
  assert.equal(event.source_url, urls[0]);
  assert.equal(event.external_id, 'exh073');

  const rubyEvent = extractChushinEvent(listingHtml, source, urls[1]);
  assert.equal(rubyEvent.title, '西野康造 空・宙');
  assert.equal(rubyEvent.external_id, 'exh072');

  const fullWidthDateEvent = extractChushinEvent(listingHtml, source, urls[2]);
  assert.equal(fullWidthDateEvent.start_date, '2024-02-07');
  assert.equal(fullWidthDateEvent.end_date, '2024-03-15');
  assert.equal(fullWidthDateEvent.calendar_starts_at, '2024-02-07T10:00:00+09:00');
  assert.equal(fullWidthDateEvent.calendar_ends_at, '2024-03-15T17:00:00+09:00');
  assert.equal(new Set([event, rubyEvent, fullWidthDateEvent].map(buildEventDedupeKey)).size, 3);
});

test('fetch classification distinguishes bot challenges from renderable JS shells', () => {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });

  assert.equal(
    classifyFetchResult({
      response: new Response('<title>Just a moment...</title><p>Checking your browser</p>', {
        status: 200,
        headers,
      }),
      html: '<title>Just a moment...</title><p>Checking your browser</p>',
    }),
    'bot_challenge',
  );

  const normalHtmlWithChallengeWords = `
    <title>Current Exhibitions</title>
    <main>${'Current exhibition information with dates and image links. '.repeat(50)}</main>
    <script id="captcha-bootstrap">window.analyticsMessage = "request blocked"; window.formProtection = "hcaptcha g-recaptcha";</script>
  `;

  assert.equal(
    classifyFetchResult({
      response: new Response(normalHtmlWithChallengeWords, {
        status: 200,
        headers,
      }),
      html: normalHtmlWithChallengeWords,
    }),
    'ok',
  );

  assert.equal(
    classifyFetchResult({
      response: new Response('<div id="root"></div><script src="/app.js"></script>', {
        status: 200,
        headers,
      }),
      html: '<div id="root"></div><script src="/app.js"></script>',
    }),
    'js_shell',
  );
});

test('diagnostics and source outcome summarize crawl health', () => {
  const diagnostics = createCrawlDiagnostics({
    CRAWL4AI_MAX_RENDERS_PER_SOURCE: '3',
  });

  recordFetchedPage(diagnostics, {
    metadata: {
      fetched_via: 'fetch',
      fetch_classification: 'js_shell',
      fetch_attempts: 2,
    },
  });
  recordFetchedPage(diagnostics, {
    metadata: {
      fetched_via: 'crawl4ai',
    },
  });

  assert.equal(diagnostics.fetched_static_count, 1);
  assert.equal(diagnostics.fetched_crawl4ai_count, 1);
  assert.equal(diagnostics.retry_count, 1);
  assert.equal(diagnostics.js_shell_count, 1);
  assert.equal(diagnostics.crawl4ai_render_limit, 3);

  recordSkippedEvent(diagnostics, 'missing valid description');
  assert.equal(diagnostics.skipped_missing_description_count, 1);

  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://example.test/events/a/'],
      savedEvents: [],
      skippedEvents: [{ reason: 'missing image' }],
      diagnostics: { ...diagnostics, missing_image_count: 1 },
      usedGenericExtractor: true,
    }),
    'source_needs_review',
  );

  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://example.test/events/a/'],
      savedEvents: [{ title: 'Good title' }],
      diagnostics,
      usedGenericExtractor: true,
    }),
    'source_needs_review',
  );

  assert.equal(
    classifySourceOutcome({
      detailUrls: ['https://sibasi.jp/event/a/', 'https://sibasi.jp/event/b/'],
      savedEvents: [],
      skippedEvents: [{ reason: 'past event' }, { reason: 'missing verifiable event date' }],
      diagnostics: { skipped_past_count: 1, skipped_missing_date_count: 1 },
      sourceSlug: 'sibasi',
    }),
    'source_no_current_events',
  );

  assert.equal(
    classifySourceOutcome({
      detailUrls: [],
      sourceSlug: 'curation-fair-tokyo',
    }),
    'source_no_current_events',
  );
});

test('Kitano inline exhibitions become separate one-image events', () => {
  const html = `
    <div class="wrapper" id="202607081">
      <h5>First Show</h5><p>2026.07.08 - 2026.07.13</p>
      <img src="images/first.png"><div class="wrapper mt-3"><p>First description</p></div>
    </div>
    <div class="wrapper" id="202607151">
      <h5>Second Show</h5><p>2026.07.15 - 2026.07.20</p>
      <img src="images/second.png"><div class="wrapper mt-3"><p>Second description</p></div>
    </div>`;
  const source = {
    name: 'Art Gallery Kitano',
    taxonomy: testTaxonomy(['gallery'], ['contemporary'], ['exhibition']),
  };
  const urls = detailUrlExtractors['art-gallery-kitano'](
    html,
    'https://www.gallery-kitano.com/exhibition.aspx',
  );
  const events = urls.map((url) => eventExtractors['art-gallery-kitano'](html, source, url));
  const event = events[0];

  assert.deepEqual(urls, [
    'https://www.gallery-kitano.com/exhibition.aspx#202607081',
    'https://www.gallery-kitano.com/exhibition.aspx#202607151',
  ]);
  assert.equal(event.title, 'First Show');
  assert.equal(event.external_id, '202607081');
  assert.equal(event.start_date, '2026-07-08');
  assert.deepEqual(event.image_urls, ['https://www.gallery-kitano.com/images/first.png']);
  assert.notEqual(buildEventDedupeKey(events[0]), buildEventDedupeKey(events[1]));
  assert.equal(dedupeEvents(events).length, 2);
});

test('Gallery Take Two drops coming-soon placeholders and keeps one image', () => {
  const galleryData = {
    appsWarmupData: {
      gallery: {
        schedule_galleryData: {
          items: [
            {
              itemId: 'real-event',
              mediaUrl: 'real.jpg',
              metaData: {
                title: 'Real Exhibition',
                description: '2026年7月10日(金) 〜 7月15日(水)\nDetails',
                fileName: 'poster.jpg',
              },
            },
            {
              itemId: 'placeholder',
              mediaUrl: 'placeholder.jpg',
              metaData: {
                title: 'Later',
                description: '2026年8月1日',
                fileName: 'coming soon.jpeg',
              },
            },
          ],
        },
      },
    },
  };
  const html = `<script id="wix-warmup-data">${JSON.stringify(galleryData)}</script>`;
  const source = {
    name: 'Gallery Take Two',
    taxonomy: testTaxonomy(['gallery'], [], ['exhibition']),
  };
  const urls = detailUrlExtractors['gallery-take-two'](
    html,
    'https://www.gallery-taketwo.com/schedule',
  );
  const event = eventExtractors['gallery-take-two'](html, source, urls[0]);

  assert.deepEqual(urls, ['https://www.gallery-taketwo.com/schedule#real-event']);
  assert.equal(event.title, 'Real Exhibition');
  assert.equal(event.external_id, 'real-event');
  assert.equal(event.end_date, '2026-07-15');
  assert.deepEqual(event.image_urls, ['https://static.wixstatic.com/media/real.jpg']);
});

test('Pola Museum Annex stays on the Ginza one-page exhibition', async () => {
  const sources = await loadSourcesConfig({ city: 'tokyo' });
  const source = sources.find((item) => item.slug === 'pola-museum-annex');
  const listingUrl = 'https://www.po-holdings.co.jp/m-annex/exhibition/index.html';
  const html = `
    <div class="article dataBox"><div class="inBox"><dl>
      <dt class="ttl">「束芋画 国宝」<!--<br><span>old subtitle</span>--></dt>
      <dt class="day">前期：2026年7月17日(金)–8月9日(日)<br>後期：2026年8月11日(火・祝)–8月30日(日)</dt>
      <dd class="right"><img src="../images/exhibition/archive/2026/detail_202607/img01.jpg"></dd>
      <dd class="txt"><p>『国宝』のために制作した挿絵を前後期に分けて展示します。</p></dd>
    </dl></div></div>`;

  assert.equal(source.base_url, listingUrl);
  assert.deepEqual(source.allowed_domains, ['www.po-holdings.co.jp', 'po-holdings.co.jp']);
  assert.deepEqual(detailUrlExtractors[source.slug](html, listingUrl), [listingUrl]);

  const event = eventExtractors[source.slug](html, source, listingUrl);
  assert.equal(event.title, '「束芋画 国宝」');
  assert.equal(event.start_date, '2026-07-17');
  assert.equal(event.end_date, '2026-08-30');
  assert.deepEqual(event.image_urls, [
    'https://www.po-holdings.co.jp/m-annex/images/exhibition/archive/2026/detail_202607/img01.jpg',
  ]);
});

test('Issey Kura discovery keeps only ON VIEW cards', () => {
  const listingHtml = `
    <a href="/blogs/kyotokura/1" class="news _cell"><p class="_tag">ON VIEW</p></a>
    <a href="/blogs/kyotokura/2" class="news _cell"><p class="_tag"></p></a>`;
  const urls = detailUrlExtractors['issey-miyake-kyoto-kura'](
    listingHtml,
    'https://www.isseymiyake.com/blogs/kyotokura',
  );

  assert.deepEqual(urls, ['https://www.isseymiyake.com/blogs/kyotokura/1']);

  const event = eventExtractors['issey-miyake-kyoto-kura'](
    `<h2>2026.07.01 | ISSEY MIYAKE KYOTO | KURA 「WALL WHITE HEM」</h2>
     <img src="https://cdn.shopify.com/KURA_2026jul01_01.jpg">
     <img src="https://cdn.shopify.com/KURA_2026jul01_02.jpg">`,
    {
      name: 'ISSEY MIYAKE KYOTO | KURA',
      taxonomy: testTaxonomy(['gallery'], ['textile'], ['exhibition']),
    },
    urls[0],
  );

  assert.equal(event.title, '「WALL WHITE HEM」');
  assert.equal(event.start_date, '2026-07-01');
  assert.equal(event.end_date, null);
  assert.deepEqual(event.image_urls, [
    'https://cdn.shopify.com/KURA_2026jul01_01.jpg',
    'https://cdn.shopify.com/KURA_2026jul01_02.jpg',
  ]);
});

test('Sokyo discovery excludes Past cards', () => {
  const html = `
    <div id="exhibitions-grid-current"><a href="/exhibitions/1/overview/">Current</a></div>
    <div id="exhibitions-grid-upcoming"><a href="/exhibitions/2/overview/">Upcoming</a></div>
    <div id="exhibitions-grid-past"><a href="/exhibitions/3/overview/">Past</a></div>`;

  assert.deepEqual(
    detailUrlExtractors['sokyo-kyoto'](html, 'https://sokyogallery.com/exhibitions/'),
    [
      'https://sokyogallery.com/exhibitions/1/overview/',
      'https://sokyogallery.com/exhibitions/2/overview/',
    ],
  );
});

test('source-specific crawler registries only reference configured source slugs', async () => {
  const configuredSources = await loadAllSourcesConfig();
  const configuredSlugs = new Set(configuredSources.map((source) => source.slug));
  const registryEntries = [
    ['detailUrlExtractors', Object.keys(detailUrlExtractors)],
    ['eventExtractors', Object.keys(eventExtractors)],
    ['sourceContextLoaders', Object.keys(sourceContextLoaders)],
    ['sourceSpecificSkipMatchers', Object.keys(sourceSpecificSkipMatchers)],
  ];

  for (const [label, slugs] of registryEntries) {
    const unknownSlugs = slugs.filter((slug) => !configuredSlugs.has(slug));
    assert.deepEqual(
      unknownSlugs,
      [],
      `${label} contains unknown source slugs: ${unknownSlugs.join(', ')}`,
    );
  }
});
