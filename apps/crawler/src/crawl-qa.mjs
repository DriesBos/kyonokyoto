const supportedLocales = ['en', 'ja'];

export function buildCrawlQaReport({
  source,
  sourceOutcome,
  detailUrls = [],
  savedEvents = [],
  skippedEvents = [],
  diagnostics = {},
}) {
  const missingTranslations = Object.fromEntries(
    supportedLocales.map((locale) => [
      locale,
      savedEvents.filter((event) => !event.translations?.includes(locale)).length,
    ]),
  );

  return {
    source: source?.slug ?? null,
    outcome: sourceOutcome,
    detail_urls_found: detailUrls.length,
    events_saved: savedEvents.length,
    events_skipped: skippedEvents.length,
    missing_translations: missingTranslations,
    fetch: {
      static: diagnostics.fetched_static_count ?? 0,
      rendered: diagnostics.fetched_crawl4ai_count ?? 0,
      retries: diagnostics.retry_count ?? 0,
      bot_challenges: diagnostics.bot_challenge_count ?? 0,
      js_shells: diagnostics.js_shell_count ?? 0,
    },
    skips: {
      missing_image: diagnostics.missing_image_count ?? 0,
      missing_date: diagnostics.skipped_missing_date_count ?? 0,
      invalid_title: diagnostics.skipped_invalid_title_count ?? 0,
      past: diagnostics.skipped_past_count ?? 0,
      old: diagnostics.skipped_old_count ?? 0,
      other: diagnostics.skipped_other_count ?? 0,
    },
    titles: {
      render_retries: diagnostics.title_render_retry_count ?? 0,
      extractions: diagnostics.title_extractions ?? [],
    },
    descriptions: {
      recovered: diagnostics.description_recovered_count ?? 0,
      rejected: diagnostics.description_rejected_count ?? 0,
      missing: diagnostics.description_missing_count ?? 0,
      extractions: diagnostics.description_extractions ?? [],
    },
    crawl4ai: {
      render_count: diagnostics.crawl4ai_render_count ?? 0,
      render_limit: diagnostics.crawl4ai_render_limit ?? 0,
      render_skipped: diagnostics.crawl4ai_render_skipped_count ?? 0,
    },
  };
}
