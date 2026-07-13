import {
  activeOrNextScheduleSegment,
  normalizeDateOnly,
} from '../../../../packages/shared/event-schedule.mjs';

type CalendarScheduleSegment = {
  ordinal?: number;
  is_all_day: boolean;
  start_date?: string | null;
  end_date?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
};

export type CalendarEvent = {
  title: string;
  description: string | null;
  institution_name: string;
  venue_name: string | null;
  address_text: string | null;
  directions_query?: string | null;
  lat?: number | null;
  lng?: number | null;
  calendar_starts_at: string | null;
  calendar_ends_at: string | null;
  is_all_day?: boolean;
  schedule_type?: 'single' | 'range' | 'occurrence_set' | 'open_ended' | 'unknown';
  schedule_segments?: CalendarScheduleSegment[] | null;
  source_url?: string;
};

export const decodeHtml = (value: string) =>
  value
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);?/gi,
      (match, entity) => {
        const entities: Record<string, string> = {
          nbsp: ' ',
          amp: '&',
          quot: '"',
          apos: "'",
          lt: '<',
          gt: '>',
          ndash: '–',
          mdash: '—',
          lsquo: "'",
          rsquo: "'",
          ldquo: '"',
          rdquo: '"',
          hellip: '…',
        };

        return entities[entity.toLowerCase()] ?? match;
      },
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    });

export const cleanDisplayText = (value: string) => {
  const decoded = decodeHtml(value);

  return decodeHtml(
    decoded
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
};

const formatDateOnly = (
  value: string,
  locale: 'en' | 'ja',
  fields: { year?: boolean; month?: boolean; day?: boolean } = {
    year: true,
    month: true,
    day: true,
  },
) => {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-GB', {
    timeZone: 'UTC',
    year: fields.year ? 'numeric' : undefined,
    month: fields.month ? (locale === 'ja' ? 'long' : 'short') : undefined,
    day: fields.day ? 'numeric' : undefined,
  }).format(date);
};

export const formatEventDateParts = (
  start: string | null,
  end: string | null,
  fallback: string,
  locale: 'en' | 'ja' = 'en',
) => {
  const startDate = normalizeDateOnly(start);
  const endDate = normalizeDateOnly(end);
  if (!startDate) {
    return { startDate: null, endDate: null, startText: fallback, endText: '', separator: '' };
  }
  if (!endDate || endDate === startDate) {
    return {
      startDate,
      endDate: null,
      startText: formatDateOnly(startDate, locale),
      endText: '',
      separator: '',
    };
  }

  const [startYear, startMonth] = startDate.split('-');
  const [endYear, endMonth] = endDate.split('-');
  const sameYear = startYear === endYear;
  const sameMonth = sameYear && startMonth === endMonth;
  const startText =
    locale === 'ja'
      ? formatDateOnly(startDate, locale)
      : formatDateOnly(startDate, locale, {
          year: !sameYear,
          month: !sameMonth,
          day: true,
        });
  const endText =
    locale === 'ja' && sameYear
      ? formatDateOnly(endDate, locale, { month: !sameMonth, day: true })
      : formatDateOnly(endDate, locale);

  return {
    startDate,
    endDate,
    startText,
    endText,
    separator: locale === 'ja' ? '〜' : ' – ',
  };
};

export const formatEventDateRange = (
  start: string | null,
  end: string | null,
  fallback: string,
  locale: 'en' | 'ja' = 'en',
) => {
  const parts = formatEventDateParts(start, end, fallback, locale);
  return parts.endText ? `${parts.startText}${parts.separator}${parts.endText}` : parts.startText;
};

const validCoordinatePair = (lat: unknown, lng: unknown) => {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (
    !Number.isFinite(parsedLat) ||
    !Number.isFinite(parsedLng) ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLng < -180 ||
    parsedLng > 180 ||
    (parsedLat === 0 && parsedLng === 0)
  ) {
    return null;
  }

  return `${parsedLat},${parsedLng}`;
};

export const mapsUrl = (event: CalendarEvent) => {
  const namedQuery =
    event.directions_query ?? event.venue_name ?? event.address_text ?? event.institution_name;
  if (/^https?:\/\//i.test(namedQuery)) return namedQuery;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(namedQuery)}`;
};

export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const toGoogleCalendarStamp = (value: string) => value.replaceAll('-', '');

export const toGoogleCalendarTimestamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

export const calendarDetailsFor = (event: CalendarEvent) =>
  event.description
    ? cleanDisplayText(event.description)
    : `${event.institution_name}${event.venue_name ? ` — ${event.venue_name}` : ''}`;

export const calendarLocationFor = (event: CalendarEvent) =>
  event.address_text ?? event.venue_name ?? event.institution_name;

export const googleCalendarUrl = (
  event: CalendarEvent,
  todayDateOnly = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()),
) => {
  const segment = activeOrNextScheduleSegment(event, todayDateOnly);
  if (!segment) return null;

  let dates: string;
  if (segment.is_all_day) {
    const start = normalizeDateOnly(segment.start_date);
    const end = normalizeDateOnly(segment.end_date);
    if (!start || !end) return null;

    dates = `${toGoogleCalendarStamp(start)}/${toGoogleCalendarStamp(addDays(end, 1))}`;
  } else {
    if (!segment.starts_at || !segment.ends_at) return null;
    dates = `${toGoogleCalendarTimestamp(segment.starts_at)}/${toGoogleCalendarTimestamp(segment.ends_at)}`;
  }

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${dates}&details=${encodeURIComponent(calendarDetailsFor(event))}&location=${encodeURIComponent(calendarLocationFor(event))}`;
};
