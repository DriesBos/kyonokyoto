import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lib = new URL('../src/lib/', import.meta.url);
const app = new URL('../src/app/', import.meta.url);
const { buildAppleCalendarIcs } = await import(new URL('appleCalendar.ts', lib));
const { googleCalendarUrl, safeHttpUrl } = await import(new URL('calendar.ts', lib));
const { normalizeYouTubeEmbeds } = await import(new URL('youtubeEmbed.ts', lib));

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
  assert.match(source, /'address_text'/);
  assert.match(source, /'directions_query'/);
  assert.match(source, /'calendar_starts_at'/);
  assert.match(source, /sourceUrl: safeHttpUrl/);
  assert.match(source, /mapsUrl: mapsUrl/);
  assert.match(source, /googleCalendarUrl:/);
  assert.match(source, /appleCalendar,/);
  assert.match(source, /mediaEmbeds: normalizeYouTubeEmbeds/);
  assert.match(source, /group: eventDisplayGroup/);
  assert.match(source, /sourceSlug: truth\.slug/);
  assert.match(source, /landingEligible: Boolean/);
  assert.match(source, /group: 'permanent'/);
  assert.match(source, /endpoint\.search = new URLSearchParams\(\{ select: EVENT_SELECT, status: 'eq\.published', city: `eq\.\$\{city\}` \}\)/);
  assert.match(source, /translationFor\(event, locale\)/);
  assert.match(source, /dateOnlyInTimeZone/);
  assert.match(source, /events\.filter\(\(event\) => event\.group === 'ongoing'\)/);
  assert.match(source, /lat: truth\.lat/);
  assert.match(source, /lng: truth\.lng/);
  assert.match(source, /\.\.\.events\.filter\(\(event\) => event\.group === 'permanent'\),\s+\.\.\.permanent/);
});

test('calendar helper builds all-day, timed and open-ended actions', () => {
  const allDay = new URL(googleCalendarUrl({
    ...calendarEvent,
    calendarStartsAt: '2026-08-10',
    calendarEndsAt: '2026-08-12',
    isAllDay: true,
  }, '2026-08-09'));
  assert.equal(allDay.searchParams.get('dates'), '20260810/20260813');

  const timed = new URL(googleCalendarUrl({
    ...calendarEvent,
    calendarStartsAt: '2026-08-10T10:00:00+09:00',
    calendarEndsAt: '2026-08-10T12:00:00+09:00',
    isAllDay: false,
  }, '2026-08-09'));
  assert.equal(timed.searchParams.get('dates'), '20260810T010000Z/20260810T030000Z');
  assert.equal(googleCalendarUrl({
    ...calendarEvent,
    calendarStartsAt: '2026-08-10',
    calendarEndsAt: null,
    isAllDay: true,
  }, '2026-08-09'), null);
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
});

test('Apple ICS uses exclusive all-day end and escapes text', () => {
  const ics = buildAppleCalendarIcs({
    title: 'Art, craft',
    details: 'Line one\nLine two',
    location: 'Kyoto; Japan',
    start: '2026-08-10',
    end: '2026-08-12',
    isAllDay: true,
  }, 'fixed@kyonokyoto', '20260809T000000Z');
  assert.match(ics, /DTSTART;VALUE=DATE:20260810/);
  assert.match(ics, /DTEND;VALUE=DATE:20260813/);
  assert.match(ics, /SUMMARY:Art\\, craft/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
});

test('YouTube normalization keeps valid YouTube embeds only', () => {
  assert.deepEqual(normalizeYouTubeEmbeds([
    { type: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' },
    { type: 'youtube', url: 'https://youtu.be/xyz789' },
    { type: 'vimeo', url: 'https://vimeo.com/1' },
    { type: 'youtube', url: 'not a URL' },
  ]).map((embed) => embed.videoId), ['abc123', 'xyz789']);
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
  assert.match(detail, /images\.slice\(0, expanded \? 3 : 1\)/);
  assert.match(detail, /const visibleEmbeds = expanded \? embeds : \[\]/);
  assert.match(detail, /data-overflow=\{hasOverflow\}/);
  assert.match(detail, /naturalLeadAspectRatio \?\? imageAspectRatio\(images\[0\]\)/);
  assert.match(detail, /image\.naturalWidth \/ image\.naturalHeight/);
  assert.match(detail, /ref=\{imageIndex === 0 \? syncNaturalLeadAspectRatio : undefined\}/);
  assert.match(detail, /--media-lead-aspect-ratio/);
  assert.match(mediaStyles, /overflow-x: auto/);
  assert.match(mediaStyles, /flex-basis: calc\(100% - var\(--media-peek\)\)/);
  assert.match(mediaStyles, /aspect-ratio: var\(--media-lead-aspect-ratio\)/);
  assert.match(mediaStyles, /object-fit: contain/);
  const eventCardBlockStyles = blockStyles.slice(0, blockStyles.indexOf(':global(html[data-blocks-landing-active])'));
  assert.doesNotMatch(eventCardBlockStyles, /aspect-ratio: 3 \/ 2|object-fit: cover/);
  assert.match(mediaStyles, /-webkit-line-clamp: 5/);
  assert.match(blocks, /<EventsGrid events=\{events\} locale=\{locale\}/);
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
