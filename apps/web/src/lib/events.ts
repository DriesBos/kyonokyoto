import { dedupeEvents } from '../../../../packages/shared/event-dedupe.mjs';
import {
  classifyEventTiming,
  isEventWithinDisplayWindow,
} from '../../../../packages/shared/event-schedule.mjs';
import { supabase } from './supabase';
import type { AppCity } from './cities';
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

export type EventRow = {
  id: string;
  source_id: string;
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
  primary_image_url: string | null;
  image_urls: string[] | null;
  source_url: string;
  description: string | null;
  updated_at?: string | null;
  schedule_type?: 'range' | 'occurrence_set' | 'unknown';
  occurrence_dates?: string[] | null;
  sources?: EventSourceRelation | EventSourceRelation[];
  event_translations?: EventTranslationRow[] | null;
};

export type ClassifiedEvent = EventRow & {
  date_text: string;
  timing: 'ongoing' | 'upcoming' | 'past' | 'permanent';
  media_embeds?: { type: 'youtube'; url: string; video_id: string }[];
};

export const eventSelect =
  'id, source_id, title, categories, date_text, institution_name, venue_name, address_text, directions_query, lat, lng, start_date, end_date, calendar_starts_at, calendar_ends_at, primary_image_url, image_urls, source_url, description, updated_at, schedule_type, occurrence_dates';

export const eventTranslationSelect = 'event_translations(locale, title, description)';

const fetchEvents = ({ city, locale }: { city: AppCity; locale: AppLocale }) =>
  supabase
    .from('events')
    .select(`${eventSelect}, ${eventTranslationSelect}`)
    .eq('status', 'published')
    .eq('city', city)
    .eq('event_translations.locale', locale)
    .order('start_date', { ascending: true, nullsFirst: false });

export const fetchPublishedEvents = async (filters: { city: AppCity; locale: AppLocale }) => {
  const { data, error } = await fetchEvents(filters);
  if (error) throw error;
  return dedupeEvents((data ?? []) as EventRow[]);
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

export const toJapanDate = (value: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
  }).format(value);

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
    const event = localizeEvent(rawEvent, activeLocale);
    const sourceTruth = sourceTruthForEvent(event, configuredSources, activeLocale);
    const calendarStartsAt = event.calendar_starts_at ?? event.start_date;
    const calendarEndsAt = event.calendar_ends_at ?? event.end_date ?? event.start_date;
    const eventWithCalendarDates = {
      ...event,
      institution_name: sourceTruth.institution_name,
      venue_name: sourceTruth.venue_name,
      address_text: sourceTruth.address_text,
      directions_query: sourceTruth.directions_query,
      categories: sourceTruth.categories,
      lat: sourceTruth.lat,
      lng: sourceTruth.lng,
      calendar_starts_at: calendarStartsAt,
      calendar_ends_at: calendarEndsAt,
    };

    return {
      ...eventWithCalendarDates,
      date_text: formatEventDateRange(
        event.start_date ?? calendarStartsAt,
        event.end_date ?? calendarEndsAt,
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
  today = toJapanDate(new Date()),
}: {
  events: EventRow[];
  configuredSources: SourceConfig[];
  activeLocale: AppLocale;
  today?: string;
}) =>
  formatEventsForLocale({ events, activeLocale, configuredSources, today }).filter(
    (event) => event.timing !== 'past' && isEventWithinDisplayWindow(event, today),
  );
