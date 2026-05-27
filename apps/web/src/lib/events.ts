import { dedupeEvents } from "../../../../packages/shared/event-dedupe.mjs";
import {
  classifyEventTiming,
  isEventWithinDisplayWindow,
} from "../../../../packages/shared/event-schedule.mjs";
import { supabase } from "./supabase";
import type { AppLocale } from "./i18n";
import { formatEventDateRange, parseEnglishMonthDateRange } from "./calendar";
import type { SourceConfig } from "./sources";
import { sourceCategoriesForEvent } from "./sources";

export type EventTranslationRow = {
  locale: AppLocale;
  title: string;
  description: string | null;
};

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
  schedule_type?: "range" | "occurrence_set" | "unknown";
  occurrence_dates?: string[] | null;
  event_translations?: EventTranslationRow[] | null;
};

export type ClassifiedEvent = EventRow & {
  date_text: string;
  timing: "ongoing" | "upcoming" | "past" | "permanent";
  media_embeds?: { type: "youtube"; url: string; video_id: string }[];
};

export const eventSelect =
  "id, source_id, title, categories, date_text, institution_name, venue_name, address_text, directions_query, lat, lng, start_date, end_date, calendar_starts_at, calendar_ends_at, primary_image_url, image_urls, source_url, description, updated_at";

const eventSelectWithoutCoordinates =
  "id, source_id, title, categories, date_text, institution_name, venue_name, address_text, directions_query, start_date, end_date, calendar_starts_at, calendar_ends_at, primary_image_url, image_urls, source_url, description, updated_at";

export const eventTranslationSelect =
  "event_translations(locale, title, description)";

const fetchEvents = (select: string) =>
  supabase
    .from("events")
    .select(select)
    .eq("status", "published")
    .order("start_date", { ascending: true, nullsFirst: false });

const isRelationSelectError = (error: { code?: string } | null | undefined) =>
  error?.code === "PGRST200" || error?.code === "PGRST205";

const isMissingCoordinateError = (
  error: { code?: string; message?: string } | null | undefined,
) =>
  error?.code === "PGRST204" ||
  (error?.code === "42703" &&
    /events\.(lat|lng)|column events\.(lat|lng)/i.test(error.message ?? ""));

export const fetchPublishedEvents = async () => {
  const selectAttempts = [
    `${eventSelect}, ${eventTranslationSelect}`,
    `${eventSelectWithoutCoordinates}, ${eventTranslationSelect}`,
    eventSelect,
    eventSelectWithoutCoordinates,
  ];
  let lastError: unknown = null;

  for (const select of selectAttempts) {
    const { data, error } = await fetchEvents(select);

    if (!error) {
      return dedupeEvents((data ?? []) as EventRow[]);
    }

    lastError = error;

    if (!isRelationSelectError(error) && !isMissingCoordinateError(error)) {
      throw error;
    }
  }

  throw lastError;
};

export const localizeEvent = (
  event: EventRow,
  activeLocale: AppLocale,
): EventRow => {
  const translations = event.event_translations ?? [];
  const preferred =
    translations.find((translation) => translation.locale === activeLocale) ??
    null;
  const english =
    translations.find((translation) => translation.locale === "en") ?? null;
  const japanese =
    translations.find((translation) => translation.locale === "ja") ?? null;
  const fallback = activeLocale === "ja" ? english : (english ?? japanese);
  const translation = preferred ?? fallback;

  if (!translation) return event;

  return {
    ...event,
    title: translation.title || event.title,
    description: translation.description ?? event.description,
  };
};

export const toJapanDate = (value: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
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
    const sourceCategories = sourceCategoriesForEvent(event, configuredSources);
    const fallbackCalendarYear =
      event.source_url.match(/20\d{2}/)?.[0] ??
      event.updated_at?.match(/20\d{2}/)?.[0] ??
      today;
    const parsedCalendarDates =
      event.calendar_starts_at && event.calendar_ends_at
        ? null
        : parseEnglishMonthDateRange(event.date_text, fallbackCalendarYear);
    const calendarStartsAt =
      event.calendar_starts_at ??
      parsedCalendarDates?.calendar_starts_at ??
      null;
    const calendarEndsAt =
      event.calendar_ends_at ?? parsedCalendarDates?.calendar_ends_at ?? null;
    const eventWithCalendarDates = {
      ...event,
      calendar_starts_at: calendarStartsAt,
      calendar_ends_at: calendarEndsAt,
    };

    return {
      ...eventWithCalendarDates,
      categories: sourceCategories,
      date_text: formatEventDateRange(
        calendarStartsAt,
        calendarEndsAt,
        event.date_text,
      ),
      timing: classifyEventTiming(eventWithCalendarDates, today),
    };
  });

export const displayEventsByLocale = ({
  events,
  configuredSources,
  supportedLocales,
  today = toJapanDate(new Date()),
}: {
  events: EventRow[];
  configuredSources: SourceConfig[];
  supportedLocales: AppLocale[];
  today?: string;
}) =>
  Object.fromEntries(
    supportedLocales.map((supportedLocale) => [
      supportedLocale,
      formatEventsForLocale({
        events,
        activeLocale: supportedLocale,
        configuredSources,
        today,
      }).filter(
        (event) =>
          event.timing !== "past" && isEventWithinDisplayWindow(event, today),
      ),
    ]),
  ) as Record<AppLocale, ClassifiedEvent[]>;
