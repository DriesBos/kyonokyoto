import { dedupeEvents } from '../../../../packages/shared/event-dedupe.mjs';
import { filterEventMediaByMinimumHeight } from '../../../../packages/shared/event-media.mjs';
import {
  activeOrNextScheduleSegment,
  classifyEventTiming,
  eventScheduleSegments,
  inferCanonicalScheduleType,
  isEventWithinDisplayWindow,
  nextRelevantScheduleStartDateOnly,
} from '../../../../packages/shared/event-schedule.mjs';
import { supabase } from './supabase';
import { dateOnlyInTimeZone, type AppCity } from './cities';
import type { AppLocale } from './i18n';
import { formatEventDateRange } from './calendar';
import type { SourceConfig } from './sources';
import { sourceTruthForEvent } from './sources';

export type EventTranslationRow = {
  locale: AppLocale;
  title: string;
  description: string | null;
};

export type EventSourceRelation = {
  slug: string | null;
} | null;

export type EventScheduleSegmentRow = {
  ordinal: number;
  is_all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
};

export type EventImageMetadata = {
  url: string;
  width: number | null;
  height: number | null;
};

export type EventRow = {
  id: string;
  source_id: string;
  event_kind?: 'event' | 'festival' | 'festival_program';
  festival_id?: string | null;
  festival_slug?: string | null;
  festival?: { title: string; slug: string; dateInherited: boolean } | null;
  title: string;
  categories: string[];
  date_text: string;
  institution_name: string;
  venue_name: string | null;
  address_text: string | null;
  directions_query: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
  calendar_starts_at: string | null;
  calendar_ends_at: string | null;
  is_all_day: boolean;
  primary_image_url: string | null;
  image_urls: string[] | null;
  image_metadata: EventImageMetadata[] | null;
  source_url: string;
  description: string | null;
  updated_at?: string | null;
  schedule_type?: 'single' | 'range' | 'occurrence_set' | 'open_ended' | 'unknown';
  occurrence_dates?: string[] | null;
  schedule_segments?: EventScheduleSegmentRow[] | null;
  sources?: EventSourceRelation | EventSourceRelation[];
  event_translations?: EventTranslationRow[] | null;
};

export type RawEventRow = Omit<EventRow, 'date_text' | 'institution_name' | 'source_url'> & {
  date_text: string | null;
  institution_name: string | null;
  source_url: string | null;
};

export type ClassifiedEvent = EventRow & {
  date_text: string;
  timing: 'ongoing' | 'upcoming' | 'past' | 'unknown' | 'permanent';
  media_embeds?: { type: 'youtube'; url: string; video_id: string }[];
};

export type DisplayEvent = Omit<ClassifiedEvent, 'timing'> & {
  timing: 'ongoing' | 'upcoming';
};

export const eventSelect =
  'id, source_id, event_kind, festival_id, festival_slug, title, categories, date_text, institution_name, venue_name, address_text, directions_query, lat, lng, start_date, end_date, calendar_starts_at, calendar_ends_at, is_all_day, primary_image_url, image_urls, image_metadata, source_url, description, updated_at, schedule_type, occurrence_dates, schedule_segments:event_schedule_segments(ordinal, is_all_day, start_date, end_date, starts_at, ends_at, timezone)';

export const eventTranslationSelect = 'event_translations(locale, title, description)';
export const eventSourceSelect = 'sources(slug)';

const fetchEvents = ({ city, locale }: { city: AppCity; locale: AppLocale }) =>
  supabase
    .from('events')
    .select(`${eventSelect}, ${eventSourceSelect}, ${eventTranslationSelect}`)
    .eq('status', 'published')
    .eq('city', city)
    .eq('event_translations.locale', locale)
    .order('start_date', { ascending: true, nullsFirst: false });

export const fetchPublishedEvents = async (filters: { city: AppCity; locale: AppLocale }) => {
  const { data, error } = await fetchEvents(filters);
  if (error) throw error;
  const rows = (data ?? []) as RawEventRow[];
  return [
    ...(dedupeEvents(rows.filter((row) => !row.event_kind || row.event_kind === 'event')) as RawEventRow[]),
    ...rows.filter((row) => row.event_kind === 'festival' || row.event_kind === 'festival_program'),
  ];
};

const filled = (value: string | null | undefined, fallback: string | null | undefined) =>
  value?.trim() ? value : (fallback ?? '');

export const resolveFestivalEvents = (rows: RawEventRow[], activeLocale: AppLocale = 'en'): EventRow[] => {
  const festivals = new Map(rows.filter((row) => row.event_kind === 'festival').map((row) => [row.id, row]));
  return rows
    .filter((row) => row.event_kind !== 'festival')
    .map((row): EventRow => {
      const festival = row.festival_id ? festivals.get(row.festival_id) : null;
      if (!festival || row.event_kind !== 'festival_program') {
        return {
          ...row,
          date_text: row.date_text ?? '',
          institution_name: row.institution_name ?? '',
          source_url: row.source_url ?? '',
        };
      }

      const dateInherited = !row.start_date && !row.calendar_starts_at && !row.schedule_segments?.length;
      const mediaInherited = !row.primary_image_url && !row.image_urls?.length;
      const localizedFestival = localizeEvent({
        ...festival,
        date_text: festival.date_text ?? '',
        institution_name: festival.institution_name ?? '',
        source_url: festival.source_url ?? '',
      }, activeLocale);
      return {
        ...row,
        festival: {
          title: localizedFestival.title,
          slug: festival.festival_slug ?? '',
          dateInherited,
        },
        date_text: filled(row.date_text, festival.date_text),
        institution_name: filled(row.institution_name, festival.venue_name),
        venue_name: filled(row.venue_name, festival.venue_name) || null,
        address_text: filled(row.address_text, festival.address_text) || null,
        directions_query: filled(row.directions_query, festival.directions_query) || null,
        lat: row.lat ?? festival.lat,
        lng: row.lng ?? festival.lng,
        start_date: dateInherited ? festival.start_date : row.start_date,
        end_date: dateInherited ? festival.end_date : row.end_date,
        calendar_starts_at: dateInherited ? festival.calendar_starts_at : row.calendar_starts_at,
        calendar_ends_at: dateInherited ? festival.calendar_ends_at : row.calendar_ends_at,
        is_all_day: dateInherited ? festival.is_all_day : row.is_all_day,
        schedule_type: dateInherited ? festival.schedule_type : row.schedule_type,
        schedule_segments: dateInherited ? festival.schedule_segments : row.schedule_segments,
        occurrence_dates: dateInherited ? festival.occurrence_dates : row.occurrence_dates,
        primary_image_url: mediaInherited ? festival.primary_image_url : row.primary_image_url,
        image_urls: mediaInherited ? festival.image_urls : row.image_urls,
        image_metadata: mediaInherited ? festival.image_metadata : row.image_metadata,
        source_url: filled(row.source_url, festival.source_url),
        description: filled(row.description, localizedFestival.description) || null,
        categories: row.categories?.length ? row.categories : festival.categories,
      };
    });
};

export const localizeEvent = (event: EventRow, activeLocale: AppLocale): EventRow => {
  const translations = event.event_translations ?? [];
  const preferred = translations.find((translation) => translation.locale === activeLocale) ?? null;
  const english = translations.find((translation) => translation.locale === 'en') ?? null;
  const japanese = translations.find((translation) => translation.locale === 'ja') ?? null;
  const fallback = activeLocale === 'ja' ? english : (english ?? japanese);
  const translation = preferred ?? fallback;

  if (!translation) return event;

  return {
    ...event,
    title: translation.title || event.title,
    description: translation.description ?? event.description,
  };
};

export const formatEventsForLocale = ({
  events,
  activeLocale,
  configuredSources,
  today,
}: {
  events: EventRow[];
  activeLocale: AppLocale;
  configuredSources: SourceConfig[];
  today: string;
}): ClassifiedEvent[] =>
  events.map((rawEvent) => {
    const event = filterEventMediaByMinimumHeight(
      localizeEvent(rawEvent, activeLocale),
    ) as EventRow;
    const sourceTruth = sourceTruthForEvent(event, configuredSources, activeLocale);
    const isFestivalProgram = event.event_kind === 'festival_program' && Boolean(event.festival);
    const scheduleSegments = eventScheduleSegments(event);
    const selectedSegment = activeOrNextScheduleSegment(event, today);
    const hasCanonicalSegments =
      Array.isArray(event.schedule_segments) && scheduleSegments.length > 0;
    const selectedCalendarStart = selectedSegment
      ? selectedSegment.is_all_day
        ? selectedSegment.start_date
        : selectedSegment.starts_at
      : null;
    const selectedCalendarEnd = selectedSegment
      ? selectedSegment.is_all_day
        ? selectedSegment.end_date
        : selectedSegment.ends_at
      : null;
    const calendarStartsAt = hasCanonicalSegments
      ? selectedCalendarStart
      : (event.calendar_starts_at ?? event.start_date);
    const calendarEndsAt = hasCanonicalSegments
      ? selectedCalendarEnd
      : (event.calendar_ends_at ?? event.end_date ?? event.start_date);
    const eventWithCalendarDates = {
      ...event,
      institution_name: isFestivalProgram ? event.institution_name : sourceTruth.institution_name,
      venue_name: isFestivalProgram ? event.venue_name : sourceTruth.venue_name,
      address_text: isFestivalProgram ? event.address_text : sourceTruth.address_text,
      directions_query: isFestivalProgram ? event.directions_query : sourceTruth.directions_query,
      categories: isFestivalProgram ? event.categories : sourceTruth.categories,
      lat: isFestivalProgram ? event.lat : sourceTruth.lat,
      lng: isFestivalProgram ? event.lng : sourceTruth.lng,
      calendar_starts_at: calendarStartsAt,
      calendar_ends_at: calendarEndsAt,
      is_all_day: selectedSegment?.is_all_day ?? event.is_all_day,
    };
    const scheduleType = inferCanonicalScheduleType(eventWithCalendarDates);
    const preserveSourceDateText = scheduleSegments.length > 1 || scheduleType === 'open_ended';
    const displayStart =
      selectedSegment?.is_all_day === true ? selectedSegment.start_date : event.start_date;
    const displayEnd =
      selectedSegment?.is_all_day === true ? selectedSegment.end_date : event.end_date;

    return {
      ...eventWithCalendarDates,
      start_date: preserveSourceDateText ? null : eventWithCalendarDates.start_date,
      end_date: preserveSourceDateText ? null : eventWithCalendarDates.end_date,
      date_text: preserveSourceDateText
        ? event.date_text
        : formatEventDateRange(
            displayStart ?? calendarStartsAt,
            displayEnd ?? calendarEndsAt,
            event.date_text,
            activeLocale,
          ),
      timing: classifyEventTiming(eventWithCalendarDates, today),
    };
  });

export const displayEventsForLocale = ({
  events,
  configuredSources,
  activeLocale,
  timeZone = 'Asia/Tokyo',
  today = dateOnlyInTimeZone(new Date(), timeZone),
}: {
  events: EventRow[];
  configuredSources: SourceConfig[];
  activeLocale: AppLocale;
  timeZone?: string;
  today?: string;
}) =>
  formatEventsForLocale({ events, activeLocale, configuredSources, today })
    .filter(
      (event): event is DisplayEvent =>
        (event.timing === 'ongoing' || event.timing === 'upcoming') &&
        isEventWithinDisplayWindow(event, today),
    )
    .sort((left, right) => {
      const leftStart = nextRelevantScheduleStartDateOnly(left, today) ?? '9999-12-31';
      const rightStart = nextRelevantScheduleStartDateOnly(right, today) ?? '9999-12-31';
      return leftStart.localeCompare(rightStart);
    });
