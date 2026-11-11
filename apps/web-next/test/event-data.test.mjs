import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lib = new URL('../src/lib/', import.meta.url);
const app = new URL('../src/app/', import.meta.url);
const { buildAppleCalendarIcs } = await import(new URL('appleCalendar.ts', lib));
const { googleCalendarUrl, safeHttpUrl } = await import(new URL('calendar.ts', lib));
const { buildYouTubeEmbedSrc, normalizeYouTubeEmbeds } = await import(
  new URL('youtubeEmbed.ts', lib)
);
const { assertTaxonomy, CATEGORY_DIMENSIONS, taxonomyErrors } = await import(
  new URL('../../../data/categories.mjs', import.meta.url)
);
const { dedupeEvents } = await import(
  new URL('../../../packages/shared/event-dedupe.mjs', import.meta.url)
);

const calendarEvent = {
  title: 'Kyoto event',
  description: 'Details',
  institution: 'Kyoto venue',
  venue: null,
  addressText: 'Kyoto',
  directionsQuery: null,
  schedule_segments: null,
};

test('V2 event mapper preserves source, calendar, image and media contracts', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  assert.match(source, /'sources\(slug\)'/);
  assert.match(source, /'dedupe_key'/);
  assert.match(source, /'address_text'/);
  assert.match(source, /'directions_query'/);
  assert.match(source, /'calendar_starts_at'/);
  assert.match(source, /sourceUrl: safeHttpUrl/);
  assert.match(source, /mapsUrl: mapsUrl/);
  assert.match(source, /googleCalendarUrl:/);
  assert.match(source, /appleCalendar,/);
  assert.match(source, /mediaEmbeds: normalizeYouTubeEmbeds/);
  assert.match(source, /const group = eventDisplayGroup/);
  assert.match(source, /sourceSlug: truth\.slug/);
  assert.match(source, /landingEligible: Boolean/);
  assert.match(source, /group: 'permanent'/);
  assert.match(
    source,
    /endpoint\.search = new URLSearchParams\(\{\s*select: EVENT_SELECT,\s*status: 'eq\.published',\s*city: `eq\.\$\{city\}`,[^}]*or: `\(end_date\.is\.null,end_date\.gte\.\$\{today\}\)`,?\s*\}\)/,
  );
  assert.match(source, /translationFor\(event, locale\)/);
  assert.match(source, /dateOnlyInTimeZone/);
  assert.match(source, /events\.filter\(\(event\) => event\.group === 'ongoing' && event\.endsSoon\)/);
  assert.match(source, /lat: truth\.lat/);
  assert.match(source, /lng: truth\.lng/);
  assert.match(
    source,
    /\.\.\.events\.filter\(\(event\) => event\.group === 'permanent'\),\s+\.\.\.permanent/,
  );
});

test('Temples & Gardens taxonomy stays optional for existing configs and localizes collection', async () => {
  const existingTaxonomy = {
    venue_category: ['museum'],
    display_category: ['painting'],
    event_category: ['exhibition'],
  };
  assert.deepEqual(taxonomyErrors(existingTaxonomy), []);
  assert.equal(assertTaxonomy(existingTaxonomy).collection, undefined);
  assert.ok(CATEGORY_DIMENSIONS.includes('collection'));
  assert.ok(taxonomyErrors({ ...existingTaxonomy, collection: null }).length);
  assert.ok(taxonomyErrors({ ...existingTaxonomy, collection: ['unknown'] }).length);

  const categories = await readFile(
    new URL('../../../data/categories.mjs', import.meta.url),
    'utf8',
  );
  const cityEvents = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  const translations = await readFile(new URL('i18n.ts', lib), 'utf8');
  assert.match(categories, /'historic-site',[\s\S]*'garden'/);
  // temple/shrine are filter sub-picks derived from venue names, never taxonomy tags
  assert.doesNotMatch(categories.slice(0, categories.indexOf('export const CATEGORY_DIMENSIONS')), /'temple'|'shrine'/);
  assert.match(translations, /historicSite: 'Historic Site'/);
  assert.match(translations, /garden: '庭園'/);
  assert.match(cityEvents, /'venue_category:temple': 'venue_category:historic-site'/);
  assert.match(categories, /'special-opening'/);
  assert.match(translations, /templesGardens: 'Temples & Gardens'/);
  assert.match(translations, /templesGardens: '寺社・庭園'/);
  assert.match(cityEvents, /categoriesForEvents\([\s\S]*locale: AppLocale = 'en'/);
  assert.match(
    cityEvents,
    /lat === null[\s\S]*lat === undefined[\s\S]*lat === ''[\s\S]*lng === null[\s\S]*lng === undefined[\s\S]*lng === ''/,
  );
});

test('canonical temple events dedupe only by stable database id', () => {
  const canonical = {
    dedupe_key: 'temple:kyoto:shared-url-title-date',
    source_url: 'https://example.test/seasonal/',
    title: 'Special Opening',
    start_date: '2026-11-01',
    end_date: '2026-11-03',
  };
  const first = { ...canonical, id: 'canonical-one' };
  const second = { ...canonical, id: 'canonical-two' };

  assert.deepEqual(dedupeEvents([first, second]), [first, second]);
  assert.deepEqual(dedupeEvents([first, { ...first, description: 'Updated row' }]), [
    { ...first, description: 'Updated row' },
  ]);
});

test('aggregator events use event-owned location and taxonomy, with beta filtered before dedupe', async () => {
  const source = await readFile(new URL('cityEvents.ts', lib), 'utf8');
  const aggregatorTruth = source.slice(
    source.indexOf("if (source?.source_kind === 'aggregator')"),
    source.indexOf(
      'const eventText =',
      source.indexOf("if (source?.source_kind === 'aggregator')"),
    ),
  );
  assert.match(aggregatorTruth, /institution: localizedVenueName\(event\.institution_name, locale\)/);
  assert.match(aggregatorTruth, /venue: localizedVenueName\(event\.venue_name, locale\)/);
  assert.match(aggregatorTruth, /addressText: event\.address_text/);
  assert.match(aggregatorTruth, /event\.categories/);
  assert.doesNotMatch(aggregatorTruth, /source\?\.(?:lat|lng|address_text|directions_query)/);

  const fetchRows = source.slice(
    source.indexOf('const rows = (await response.json())'),
    source.indexOf('.map((event) => withConfiguredMedia'),
  );
  assert.ok(
    fetchRows.indexOf('rows.filter(') < fetchRows.indexOf('visibleSource(sourceSlugForEvent'),
  );
  assert.ok(fetchRows.indexOf('visibleSource(sourceSlugForEvent') < fetchRows.indexOf('),\n  )'));
});

test('calendar helper builds all-day, timed and open-ended actions', () => {
  const allDay = new URL(
    googleCalendarUrl(
      {
        ...calendarEvent,
        calendarStartsAt: '2026-08-10',
        calendarEndsAt: '2026-08-12',
        isAllDay: true,
      },
      '2026-08-09',
    ),
  );
  assert.equal(allDay.searchParams.get('dates'), '20260810/20260813');

  const timed = new URL(
    googleCalendarUrl(
      {
        ...calendarEvent,
        calendarStartsAt: '2026-08-10T10:00:00+09:00',
        calendarEndsAt: '2026-08-10T12:00:00+09:00',
        isAllDay: false,
      },
      '2026-08-09',
    ),
  );
  assert.equal(timed.searchParams.get('dates'), '20260810T010000Z/20260810T030000Z');
  assert.equal(
    googleCalendarUrl(
      {
        ...calendarEvent,
        calendarStartsAt: '2026-08-10',
        calendarEndsAt: null,
        isAllDay: true,
      },
      '2026-08-09',
    ),
    null,
  );
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
});

test('Apple ICS uses exclusive all-day end and escapes text', () => {
  const ics = buildAppleCalendarIcs(
    {
      title: 'Art, craft',
      details: 'Line one\nLine two',
      location: 'Kyoto; Japan',
      start: '2026-08-10',
      end: '2026-08-12',
      isAllDay: true,
    },
    'fixed@kyonokyoto',
    '20260809T000000Z',
  );
  assert.match(ics, /DTSTART;VALUE=DATE:20260810/);
  assert.match(ics, /DTEND;VALUE=DATE:20260813/);
  assert.match(ics, /SUMMARY:Art\\, craft/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
});

test('YouTube normalization keeps valid YouTube embeds only', () => {
  assert.deepEqual(
    normalizeYouTubeEmbeds([
      { type: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' },
      { type: 'youtube', url: 'https://youtu.be/xyz789' },
      { type: 'vimeo', url: 'https://vimeo.com/1' },
      { type: 'youtube', url: 'not a URL' },
    ]).map((embed) => embed.videoId),
    ['abc123', 'xyz789'],
  );
});

test('YouTube embed uses the privacy-enhanced host and CSP allows only it as a frame', async () => {
  assert.match(
    buildYouTubeEmbedSrc('abc123', 'https://x.test'),
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123\?/,
  );
  const config = await readFile(new URL('../next.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /'frame-src https:\/\/www\.youtube-nocookie\.com'/);
});

test('lead image owns media ratio and becomes the scrollable track only while open', async () => {
  const [grid, detail, mediaStyles, blocks, blockStyles] = await Promise.all([
    readFile(new URL('ExpandableGrid.tsx', app), 'utf8'),
    readFile(new URL('EventCardDetail.tsx', app), 'utf8'),
    readFile(new URL('EventCardDetail.module.sass', app), 'utf8'),
    readFile(new URL('CityEventsPage.tsx', app), 'utf8'),
    readFile(new URL('blocks/page.module.sass', app), 'utf8'),
  ]);
  assert.match(grid, /useState<string \| null>/);
  assert.match(grid, /aria-expanded=\{expanded\}/);
  assert.match(detail, /usableImages\.slice\(0, expanded \? 3 : 1\)/);
  assert.match(
    detail,
    /const visibleEmbeds = expanded \? embeds : usableImages\.length === 0 \? embeds\.slice\(0, 1\) : \[\]/,
  );
  assert.match(detail, /data-overflow=\{hasOverflow\}/);
  assert.match(detail, /naturalAspectRatios\[image\.src\]\) \?\? imageAspectRatio\(image\)/);
  assert.match(detail, /image\.naturalWidth \/ image\.naturalHeight/);
  assert.match(detail, /syncNaturalAspectRatio\(element, image\.src\)/);
  // Broken images drop out of the card instead of rendering a broken-image box.
  assert.match(detail, /onError=\{\(\) => markFailed\(image\.src\)\}/);
  assert.match(detail, /confirmBrokenImage\(element, image\.src\)/);
  assert.match(detail, /src && !failedSources\.has\(src\)/);
  assert.match(detail, /--media-lead-aspect-ratio/);
  assert.match(mediaStyles, /overflow-x: auto/);
  // Several open items share the lead's height (minus the peek) and keep their own widths.
  assert.match(
    mediaStyles,
    /height: calc\(\(100cqi - 2 \* var\(--media-inset, 0px\) - var\(--media-peek\)\) \/ var\(--media-lead-aspect-ratio, 4 \/ 3\)\)/,
  );
  assert.match(mediaStyles, /padding-inline: var\(--media-inset, 0\)/);
  assert.match(mediaStyles, /aspect-ratio: var\(--frame-aspect-ratio, auto\)/);
  assert.doesNotMatch(mediaStyles, /object-fit: contain/);
  const eventCardBlockStyles = blockStyles.slice(0, blockStyles.indexOf('.landing'));
  assert.doesNotMatch(eventCardBlockStyles, /aspect-ratio: 3 \/ 2|object-fit: cover/);
  assert.match(mediaStyles, /-webkit-line-clamp: 5/);
  assert.match(blocks, /<EventsGrid\s+events=\{events\}\s+locale=\{locale\}/);
  assert.match(blocks, /<MapExperience/);
  assert.match(detail, /buildAppleCalendarIcs/);
  assert.match(detail, /rel: 'noopener noreferrer'/);
  assert.match(detail, /<ActionIcon name="map"/);
  assert.equal(detail.match(/<ActionIcon name="calendar"/g)?.length, 2);
  assert.match(detail, /<ActionIcon name="exit"/);
  for (const label of ['directions', 'google', 'apple', 'website']) {
    assert.match(detail, new RegExp(`<span>\\{copy\\.${label}\\}<\\/span>`));
  }
  assert.match(detail, /className=\{styles\.actionContent\}/);
  assert.match(mediaStyles, /text-transform: lowercase/);
});

test('events use page scrolling until map opens an independently scrollable panel', async () => {
  const styles = await readFile(new URL('MapExperience.module.sass', app), 'utf8');
  const eventsStyles = styles.slice(styles.indexOf('.events'), styles.indexOf('.map'));
  // Desktop: the panel keeps scrolling while the map is mounted, including while it slides out.
  const desktopStart = styles.indexOf('@media (min-width: 769px)\n  .content[data-map-mounted]');
  const mapVisibleStyles = styles.slice(
    desktopStart,
    styles.indexOf('.content[data-map-visible]', desktopStart),
  );
  // Phones: no inner scroller and no viewport units, the document scrolls under Safari's bars.
  const phoneStyles = styles.slice(styles.indexOf('@media (max-width: 768px)'));

  assert.ok(desktopStart >= 0);
  assert.doesNotMatch(phoneStyles, /overflow-y: auto|\d(s|l|d)?vh/);
  assert.match(phoneStyles, /position: sticky/);

  assert.match(eventsStyles, /overflow: visible/);
  assert.doesNotMatch(eventsStyles, /overscroll-behavior/);
  assert.match(mapVisibleStyles, /overflow-y: auto/);
  assert.match(mapVisibleStyles, /overscroll-behavior-x: contain/);
  assert.match(mapVisibleStyles, /overscroll-behavior-y: none/);
  assert.match(mapVisibleStyles, /scrollbar-width: none/);
});

test('cards send each description once and build image URLs in the browser', async () => {
  const { withCalendarDetails, withoutCalendarDetails } = await import(
    new URL('appleCalendar.ts', lib)
  );
  const [grid, detail] = await Promise.all([
    readFile(new URL('EventsGrid.tsx', app), 'utf8'),
    readFile(new URL('EventCardDetail.tsx', app), 'utf8'),
  ]);
  const url =
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=A&dates=20261001/20261002&details=Long%20text&location=Kyoto';
  const stripped = withoutCalendarDetails(url);
  assert.equal(new URL(stripped).searchParams.has('details'), false);
  assert.equal(
    new URL(withCalendarDetails(stripped, 'Long text')).searchParams.get('details'),
    'Long text',
  );
  assert.match(grid, /images=\{event\.images\}/);
  assert.doesNotMatch(grid, /eventMediaDeliverySrcSet/);
  assert.match(detail, /eventMediaDeliveryUrl\(image\.url, useImageCdn\)/);
});
