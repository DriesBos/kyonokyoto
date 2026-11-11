import type { AppleCalendarEvent } from './appleCalendar.ts';
import { withoutCalendarDetails } from './appleCalendar.ts';
import type { AppCity } from './cities.ts';
import type { AppLocale } from './i18n.ts';

// What an expanded card shows below its front (description and links). Kept out of the city page
// (each card used to carry it as client props in the RSC payload) and served per city and locale
// from /api/event-details/<city>/<locale>/, which loads once, on the first card a visitor opens.
export type EventCardDetailData = {
  description: string | null;
  mapsUrl: string | null;
  googleCalendarUrl: string | null;
  // details left out when the card has a description: the card fills them in from it
  appleCalendar: (Omit<AppleCalendarEvent, 'details'> & { details?: string }) | null;
  sourceUrl: string | null;
};

type DetailSourceEvent = {
  id: string;
  description: string | null;
  mapsUrl: string | null;
  googleCalendarUrl: string | null;
  appleCalendar: AppleCalendarEvent | null;
  sourceUrl: string | null;
};

export const eventDetailsPath = (city: AppCity, locale: AppLocale) =>
  `/api/event-details/${city}/${locale}/`;

export const eventCardDetailFor = (event: DetailSourceEvent): EventCardDetailData => ({
  description: event.description,
  mapsUrl: event.mapsUrl,
  // the description travels once; calendar links get it back on the client (EventCardDetail)
  googleCalendarUrl:
    event.description && event.googleCalendarUrl
      ? withoutCalendarDetails(event.googleCalendarUrl)
      : event.googleCalendarUrl,
  appleCalendar:
    event.description && event.appleCalendar
      ? { ...event.appleCalendar, details: undefined }
      : event.appleCalendar,
  sourceUrl: event.sourceUrl,
});

export const eventDetailsById = (events: DetailSourceEvent[]) =>
  Object.fromEntries(events.map((event) => [event.id, eventCardDetailFor(event)]));
