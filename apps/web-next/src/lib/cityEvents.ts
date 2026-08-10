import 'server-only';

import { dedupeEvents } from '../../../../packages/shared/event-dedupe.mjs';
import { filterEventMediaByMinimumHeight } from '../../../../packages/shared/event-media.mjs';
import {
  activeOrNextScheduleSegment,
  classifyEventTiming,
  eventDisplayGroup,
  eventScheduleSegments,
  inferCanonicalScheduleType,
  isEventWithinDisplayWindow,
  nextRelevantScheduleStartDateOnly,
} from '../../../../packages/shared/event-schedule.mjs';
import hongKongPermanentPayload from '../../../../data/permanent/hong-kong-permanent.json';
import kyotoPermanentPayload from '../../../../data/permanent/kyoto-permanent.json';
import osakaPermanentPayload from '../../../../data/permanent/osaka-permanent.json';
import tokyoPermanentPayload from '../../../../data/permanent/tokyo-permanent.json';
import hongKongSourcesPayload from '../../../../data/sources/hong-kong-sources.json';
import kyotoSourcesPayload from '../../../../data/sources/kyoto-sources.json';
import osakaSourcesPayload from '../../../../data/sources/osaka-sources.json';
import tokyoSourcesPayload from '../../../../data/sources/tokyo-sources.json';
import { type AppleCalendarEvent } from './appleCalendar';
import { calendarDetailsFor, calendarLocationFor, googleCalendarUrl, mapsUrl, safeHttpUrl } from './calendar';
import { cityConfigFor, dateOnlyInTimeZone, type AppCity } from './cities';
import { formatEventDateRange, formatOngoingEventEnd } from './eventDates';
import type { AppLocale } from './i18n';
import { sourceSlugForEvent } from './sourceMatching';
import { normalizeYouTubeEmbeds, type YouTubeEmbed } from './youtubeEmbed';

type Translation = {
  locale: AppLocale;
  title: string;
  description: string | null;
  venue_name?: string | null;
  date_text?: string | null;
};

type ScheduleSegment = {
  ordinal: number;
  is_all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
};

type SourceRelation = { slug: string | null } | { slug: string | null }[] | null;

type EventRow = {
  id: string;
  source_id: string | null;
  title: string;
  description: string | null;
  categories: string[] | null;
  institution_name: string;
  venue_name: string | null;
  address_text: string | null;
  directions_query: string | null;
  lat: number | null;
  lng: number | null;
  date_text: string;
  is_all_day: boolean | null;
  start_date: string | null;
  end_date: string | null;
  calendar_starts_at: string | null;
  calendar_ends_at: string | null;
  schedule_type: string;
  occurrence_dates: string[] | null;
  primary_image_url: string | null;
  image_urls: string[] | null;
  image_metadata: { url: string; width: number | null; height: number | null }[] | null;
  source_url: string;
  sources: SourceRelation;
  updated_at: string | null;
  schedule_segments: ScheduleSegment[] | null;
  event_translations: Translation[] | null;
};

type Taxonomy = {
  venue_category?: string[];
  display_category?: string[];
  event_category?: string[];
};

type SourceConfig = {
  slug: string;
  name: string;
  names?: Partial<Record<AppLocale, string>>;
  taxonomy?: Taxonomy;
  landing_slider?: boolean;
  map_visibility?: boolean;
  is_active?: boolean;
  beta?: boolean;
  base_url?: string;
  start_urls?: string[];
  allowed_domains?: string[];
  event_page_patterns?: string[];
  address_text?: string;
  directions_query?: string;
  lat?: number;
  lng?: number;
  venue_locations?: {
    name?: string;
    match?: string[];
    address_text?: string;
    directions_query?: string;
    lat?: number;
    lng?: number;
  }[];
};

export type CityEvent = {
  id: string;
  group: 'ongoing' | 'upcoming' | 'permanent';
  sourceSlug: string | null;
  landingEligible: boolean;
  mapVisible: boolean;
  categories: string[];
  date: string;
  institution: string;
  venue: string | null;
  title: string;
  description: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  imageWidth: number | null;
  imageHeight: number | null;
  images: { url: string; width: number | null; height: number | null }[];
  sourceUrl: string | null;
  mapsUrl: string;
  googleCalendarUrl: string | null;
  appleCalendar: AppleCalendarEvent | null;
  mediaEmbeds: YouTubeEmbed[];
  addressText: string | null;
  directionsQuery: string | null;
  calendarStartsAt: string | null;
  calendarEndsAt: string | null;
  isAllDay: boolean | null;
  lat: number | null;
  lng: number | null;
};

export type CategoryOption = {
  slug: string;
  label: string;
  dimension: keyof Taxonomy;
};

export type MapSource = {
  id: string;
  sourceSlug: string;
  name: string;
  categories: string[];
  lat: number;
  lng: number;
};

const EVENT_SELECT = [
  'id',
  'source_id',
  'is_all_day',
  'title',
  'description',
  'categories',
  'institution_name',
  'venue_name',
  'address_text',
  'directions_query',
  'lat',
  'lng',
  'date_text',
  'start_date',
  'end_date',
  'calendar_starts_at',
  'calendar_ends_at',
  'schedule_type',
  'occurrence_dates',
  'primary_image_url',
  'image_urls',
  'image_metadata',
  'source_url',
  'sources(slug)',
  'updated_at',
  'schedule_segments:event_schedule_segments(ordinal,is_all_day,start_date,end_date,starts_at,ends_at,timezone)',
  'event_translations(locale,title,description,venue_name,date_text)',
].join(',');

const sourcesByCity = {
  kyoto: kyotoSourcesPayload.sources,
  osaka: osakaSourcesPayload.sources,
  tokyo: tokyoSourcesPayload.sources,
  'hong-kong': hongKongSourcesPayload.sources,
} as unknown as Record<AppCity, SourceConfig[]>;

const permanentByCity = {
  kyoto: kyotoPermanentPayload.items,
  osaka: osakaPermanentPayload.items,
  tokyo: tokyoPermanentPayload.items,
  'hong-kong': hongKongPermanentPayload.items,
} as unknown as Record<AppCity, PermanentItem[]>;

const normalizedText = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const localized = (values: Partial<Record<AppLocale, string>> | undefined, locale: AppLocale, fallback: string) =>
  values?.[locale] || values?.en || values?.ja || fallback;
const taxonomyCategories = (taxonomy?: Taxonomy) =>
  [...new Set(Object.values(taxonomy ?? {}).flat().map(normalizedText).filter(Boolean))];

const coordinatePair = (lat: unknown, lng: unknown) => {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  return Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180 &&
    (parsedLat !== 0 || parsedLng !== 0)
    ? { lat: parsedLat, lng: parsedLng }
    : null;
};

const activeSourcesFor = (city: AppCity) =>
  sourcesByCity[city].filter((source) => source.is_active !== false);

const sourceTruth = (
  event: Pick<EventRow, 'sources' | 'source_id' | 'source_url' | 'institution_name' | 'venue_name' | 'address_text' | 'directions_query' | 'lat' | 'lng' | 'title' | 'categories'>,
  sources: SourceConfig[],
  locale: AppLocale,
) => {
  const slug = sourceSlugForEvent(event, sources);
  const source = slug ? sources.find((candidate) => candidate.slug === slug) : undefined;
  const eventText = [event.venue_name, event.address_text, event.directions_query, event.source_url, event.institution_name, event.title]
    .map(normalizedText)
    .filter(Boolean)
    .join(' ');
  const eventCoordinates = coordinatePair(event.lat, event.lng);
  const venue = source?.venue_locations?.find((location) =>
    (location.match ?? [location.name ?? ''])
      .map(normalizedText)
      .filter(Boolean)
      .some((match) => eventText.includes(match)),
  ) ?? source?.venue_locations?.find((location) => {
    const pair = coordinatePair(location.lat, location.lng);
    return eventCoordinates && pair && eventCoordinates.lat === pair.lat && eventCoordinates.lng === pair.lng;
  });
  const pair = coordinatePair(venue?.lat ?? source?.lat ?? event.lat, venue?.lng ?? source?.lng ?? event.lng);
  const addressText = venue?.address_text ?? source?.address_text ?? event.address_text;
  return {
    slug,
    source,
    institution: source ? localized(source.names, locale, source.name) : event.institution_name,
    venue: venue?.name ?? event.venue_name,
    addressText,
    directionsQuery: venue?.directions_query ?? source?.directions_query ?? event.directions_query ?? addressText,
    categories: taxonomyCategories(source?.taxonomy).length
      ? taxonomyCategories(source?.taxonomy)
      : (event.categories ?? []).map(normalizedText).filter(Boolean),
    lat: pair?.lat ?? null,
    lng: pair?.lng ?? null,
  };
};

const imageRecords = (event: Pick<EventRow, 'image_urls' | 'primary_image_url' | 'image_metadata'>) => {
  const urls = (event.image_urls ?? []).filter(Boolean).slice(0, 3);
  const display = urls.length ? urls : event.primary_image_url ? [event.primary_image_url] : [];
  return display.map((url) => {
    const metadata = event.image_metadata?.find((image) => image.url === url) ?? null;
    return { url, width: metadata?.width ?? null, height: metadata?.height ?? null };
  });
};

type CalendarInput = {
  title: string;
  description: string | null;
  institution: string;
  venue: string | null;
  addressText: string | null;
  directionsQuery: string | null;
  calendarStartsAt: string | null;
  calendarEndsAt: string | null;
  isAllDay: boolean | null;
  schedule_segments?: unknown[] | null;
};

const calendarFor = (event: CalendarInput) =>
  event.calendarStartsAt && event.calendarEndsAt && event.isAllDay !== null
    ? {
        title: event.title,
        details: calendarDetailsFor(event),
        location: calendarLocationFor(event),
        start: event.calendarStartsAt,
        end: event.calendarEndsAt,
        isAllDay: event.isAllDay,
      }
    : null;

const translationFor = (event: EventRow, locale: AppLocale) =>
  event.event_translations?.find((translation) => translation.locale === locale) ??
  event.event_translations?.find((translation) => translation.locale === 'en') ??
  event.event_translations?.find((translation) => translation.locale === 'ja') ??
  null;

export async function fetchCityEvents({ city, locale }: { city: AppCity; locale: AppLocale }): Promise<CityEvent[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase public environment variables');

  const endpoint = new URL('/rest/v1/events', url);
  endpoint.search = new URLSearchParams({ select: EVENT_SELECT, status: 'eq.published', city: `eq.${city}` }).toString();
  const response = await fetch(endpoint, { headers: { apikey: key }, next: { revalidate: 300 } });
  if (!response.ok) throw new Error(`Supabase events request failed: ${response.status}`);

  const sources = activeSourcesFor(city);
  const today = dateOnlyInTimeZone(new Date(), cityConfigFor(city)?.timeZone ?? 'Asia/Tokyo');
  const visibleSource = (slug: string | null) => {
    const source = sources.find((candidate) => candidate.slug === slug);
    return Boolean(source && (process.env.NODE_ENV !== 'production' || !source.beta));
  };

  const events = dedupeEvents((await response.json()) as EventRow[])
    .map((event) => filterEventMediaByMinimumHeight(event) as EventRow)
    .filter((event) => visibleSource(sourceSlugForEvent(event, sources)))
    .filter((event) => ['ongoing', 'upcoming'].includes(classifyEventTiming(event, today)) && isEventWithinDisplayWindow(event, today))
    .sort((left, right) =>
      (nextRelevantScheduleStartDateOnly(left, today) ?? '9999-12-31').localeCompare(
        nextRelevantScheduleStartDateOnly(right, today) ?? '9999-12-31',
      ),
    )
    .map((event): CityEvent => {
      const translation = translationFor(event, locale);
      const title = translation?.title || event.title;
      const description = translation?.description ?? event.description;
      const truth = sourceTruth({ ...event, title }, sources, locale);
      const images = imageRecords(event);
      const segments = eventScheduleSegments(event);
      const selected = activeOrNextScheduleSegment(event, today);
      const hasCanonical = Array.isArray(event.schedule_segments) && segments.length > 0;
      const calendarStartsAt = hasCanonical
        ? selected?.is_all_day ? selected.start_date : selected?.starts_at
        : (event.calendar_starts_at ?? event.start_date);
      const calendarEndsAt = hasCanonical
        ? selected?.is_all_day ? selected.end_date : selected?.ends_at
        : (event.calendar_ends_at ?? event.end_date ?? event.start_date);
      const isAllDay = selected?.is_all_day ?? event.is_all_day;
      const enriched = { ...event, calendar_starts_at: calendarStartsAt, calendar_ends_at: calendarEndsAt, is_all_day: isAllDay };
      const timing = classifyEventTiming(enriched, today);
      const preserveDateText = segments.length > 1 || inferCanonicalScheduleType(enriched) === 'open_ended';
      const displayStart = selected?.is_all_day ? selected.start_date : event.start_date;
      const displayEnd = selected?.is_all_day ? selected.end_date : event.end_date;
      const translatedDate = translation?.date_text || event.date_text;
      const date = timing === 'ongoing'
        ? formatOngoingEventEnd(calendarEndsAt ?? event.end_date, locale === 'ja' ? '開催中' : 'ongoing', locale)
        : preserveDateText
          ? translatedDate
          : formatEventDateRange(displayStart ?? calendarStartsAt ?? null, displayEnd ?? calendarEndsAt ?? null, translatedDate, locale);
      const venue = translation?.venue_name ?? truth.venue;
      const calendarInput: CalendarInput = {
        title,
        description,
        institution: truth.institution,
        venue,
        addressText: truth.addressText,
        directionsQuery: truth.directionsQuery,
        calendarStartsAt: calendarStartsAt ?? null,
        calendarEndsAt: calendarEndsAt ?? null,
        isAllDay: isAllDay ?? null,
        schedule_segments: event.schedule_segments,
      };
      const appleCalendar = calendarFor(calendarInput);
      return {
        id: event.id,
        group: eventDisplayGroup({ ...enriched, timing }, today),
        sourceSlug: truth.slug,
        landingEligible: Boolean(truth.source?.landing_slider),
        mapVisible: truth.source?.map_visibility !== false,
        categories: truth.categories,
        date,
        institution: truth.institution,
        venue,
        title,
        description,
        imageUrl: images[0]?.url ?? null,
        imageUrls: images.map((image) => image.url),
        imageWidth: images[0]?.width ?? null,
        imageHeight: images[0]?.height ?? null,
        images,
        sourceUrl: safeHttpUrl(event.source_url),
        mapsUrl: mapsUrl(calendarInput),
        googleCalendarUrl: appleCalendar ? googleCalendarUrl(calendarInput, today) : null,
        appleCalendar,
        mediaEmbeds: [],
        addressText: truth.addressText,
        directionsQuery: truth.directionsQuery,
        calendarStartsAt: calendarStartsAt ?? null,
        calendarEndsAt: calendarEndsAt ?? null,
        isAllDay: isAllDay ?? null,
        lat: truth.lat,
        lng: truth.lng,
      };
    });

  const permanent = permanentEventsFor({ city, locale, sources });
  return [
    ...events.filter((event) => event.group === 'ongoing'),
    ...events.filter((event) => event.group === 'upcoming'),
    ...events.filter((event) => event.group === 'permanent'),
    ...permanent,
  ];
}

type PermanentItem = {
  slug: string;
  cadence?: 'permanent' | 'occasional';
  name?: string;
  names?: Partial<Record<AppLocale, string>>;
  base_url?: string;
  taxonomy?: Taxonomy;
  address_text?: string;
  directions_query?: string;
  lat?: number;
  lng?: number;
  is_active?: boolean;
  beta?: boolean;
  urls?: Partial<Record<AppLocale, string>>;
  description?: Partial<Record<AppLocale, string>> | string | null;
  image_urls?: string[];
  primary_image_url?: string | null;
  media_embeds?: unknown;
};

const permanentEventsFor = ({ city, locale, sources }: { city: AppCity; locale: AppLocale; sources: SourceConfig[] }): CityEvent[] =>
  permanentByCity[city]
    .filter((item) => item.is_active !== false && (process.env.NODE_ENV !== 'production' || !item.beta))
    .flatMap((item) => {
      const source = sources.find((candidate) => candidate.slug === item.slug);
      const institution = localized(source?.names ?? item.names, locale, source?.name ?? item.name ?? '');
      const sourceUrl = safeHttpUrl(item.urls?.[locale] ?? item.urls?.en ?? item.urls?.ja ?? item.base_url ?? source?.base_url ?? null);
      if (!institution || !sourceUrl) return [];
      const imageUrls = item.image_urls?.filter(Boolean).slice(0, 3) ?? (item.primary_image_url ? [item.primary_image_url] : []);
      const images = imageUrls.map((url) => ({ url, width: null, height: null }));
      const addressText = source?.address_text ?? item.address_text ?? null;
      const directionsQuery = source?.directions_query ?? item.directions_query ?? null;
      const pair = coordinatePair(source?.lat ?? item.lat, source?.lng ?? item.lng);
      const description = typeof item.description === 'string'
        ? item.description
        : item.description?.[locale] ?? item.description?.en ?? item.description?.ja ?? null;
      return [{
        id: `${item.cadence ?? 'permanent'}:${item.slug}`,
        group: 'permanent' as const,
        sourceSlug: item.slug,
        landingEligible: false,
        mapVisible: source?.map_visibility !== false,
        categories: taxonomyCategories(item.taxonomy ?? source?.taxonomy),
        date: locale === 'ja' ? 'あわせて' : 'also visit',
        institution,
        venue: null,
        title: institution,
        description,
        imageUrl: images[0]?.url ?? null,
        imageUrls,
        imageWidth: null,
        imageHeight: null,
        images,
        sourceUrl,
        mapsUrl: mapsUrl({ institution, venue: null, addressText, directionsQuery }),
        googleCalendarUrl: null,
        appleCalendar: null,
        mediaEmbeds: normalizeYouTubeEmbeds(item.media_embeds),
        addressText,
        directionsQuery,
        calendarStartsAt: null,
        calendarEndsAt: null,
        isAllDay: null,
        lat: pair?.lat ?? null,
        lng: pair?.lng ?? null,
      }];
    });

const categoryLabel = (value: string) => value
  .split(/[-_\s]+/)
  .filter(Boolean)
  .map((word) => word[0]?.toUpperCase() + word.slice(1))
  .join(' ');

export function categoriesForEvents(events: CityEvent[], city: AppCity = 'kyoto'): CategoryOption[] {
  const visible = new Set(events.flatMap((event) => event.categories));
  const options = activeSourcesFor(city).flatMap((source) =>
    (Object.entries(source.taxonomy ?? {}) as [keyof Taxonomy, string[]][]).flatMap(([dimension, values]) =>
      values.filter((slug) => visible.has(normalizedText(slug))).map((slug) => ({
        slug: normalizedText(slug),
        label: categoryLabel(slug),
        dimension,
      })),
    ),
  );
  return [...new Map(options.map((option) => [`${option.dimension}:${option.slug}`, option])).values()]
    .sort((left, right) => left.dimension.localeCompare(right.dimension) || left.label.localeCompare(right.label));
}

export function mapSourcesForEvents(events: CityEvent[]): MapSource[] {
  const locations = new Map<string, MapSource>();
  events.forEach((event) => {
    if (!event.mapVisible || event.lat === null || event.lng === null) return;
    const id = `${event.lat.toFixed(6)},${event.lng.toFixed(6)}`;
    const current = locations.get(id);
    locations.set(id, {
      id,
      sourceSlug: current?.sourceSlug ?? event.sourceSlug ?? event.id,
      name: current?.name ?? event.venue ?? event.institution,
      categories: [...new Set([...(current?.categories ?? []), ...event.categories])],
      lat: event.lat,
      lng: event.lng,
    });
  });
  return [...locations.values()];
}

export const mapLocationIdForEvent = (event: Pick<CityEvent, 'lat' | 'lng'>) =>
  event.lat === null || event.lng === null ? null : `${event.lat.toFixed(6)},${event.lng.toFixed(6)}`;
