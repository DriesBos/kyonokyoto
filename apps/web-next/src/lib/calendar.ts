import {
  activeOrNextScheduleSegment,
  normalizeDateOnly,
} from '../../../../packages/shared/event-schedule.mjs';

export type CalendarEvent = {
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

export const safeHttpUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

export const mapsUrl = (
  event: Pick<CalendarEvent, 'institution' | 'venue' | 'addressText' | 'directionsQuery'>,
) => {
  const query = event.directionsQuery ?? event.venue ?? event.addressText ?? event.institution;
  return (
    safeHttpUrl(query) ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  );
};

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const stamp = (value: string) => value.replaceAll('-', '');
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
};

export const calendarDetailsFor = (
  event: Pick<CalendarEvent, 'description' | 'institution' | 'venue'>,
) => event.description ?? `${event.institution}${event.venue ? ` — ${event.venue}` : ''}`;

export const calendarLocationFor = (
  event: Pick<CalendarEvent, 'addressText' | 'venue' | 'institution'>,
) => event.addressText ?? event.venue ?? event.institution;

export const googleCalendarUrl = (
  event: CalendarEvent,
  todayDateOnly = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()),
) => {
  const segment = activeOrNextScheduleSegment(
    {
      calendar_starts_at: event.calendarStartsAt,
      calendar_ends_at: event.calendarEndsAt,
      is_all_day: event.isAllDay,
      schedule_type: event.calendarEndsAt ? 'range' : 'open_ended',
      schedule_segments: event.schedule_segments,
    },
    todayDateOnly,
  );
  if (!segment) return null;
  const dates = segment.is_all_day
    ? (() => {
        const start = normalizeDateOnly(segment.start_date);
        const end = normalizeDateOnly(segment.end_date);
        return start && end ? `${stamp(start)}/${stamp(addDays(end, 1))}` : null;
      })()
    : segment.starts_at && segment.ends_at
      ? (() => {
          const start = timestamp(segment.starts_at);
          const end = timestamp(segment.ends_at);
          return start && end ? `${start}/${end}` : null;
        })()
      : null;
  if (!dates) return null;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${dates}&details=${encodeURIComponent(calendarDetailsFor(event))}&location=${encodeURIComponent(calendarLocationFor(event))}`;
};
