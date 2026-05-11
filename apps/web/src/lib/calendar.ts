import { normalizeDateOnly } from "../../../../packages/shared/event-schedule.mjs";

export type CalendarEvent = {
  title: string;
  description: string | null;
  institution_name: string;
  venue_name: string | null;
  address_text: string | null;
  directions_query?: string | null;
  calendar_starts_at: string | null;
  calendar_ends_at: string | null;
  source_url?: string;
};

export const decodeHtml = (value: string) =>
  value
    .replace(/&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);?/gi, (match, entity) => {
      const entities: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        quot: "\"",
        apos: "'",
        lt: "<",
        gt: ">",
        ndash: "–",
        mdash: "—",
        lsquo: "'",
        rsquo: "'",
        ldquo: "\"",
        rdquo: "\"",
        hellip: "…",
      };

      return entities[entity.toLowerCase()] ?? match;
    })
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
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
};

export const parseEnglishMonthDateRange = (dateText: string, fallbackYear?: string | null) => {
  const months: Record<string, string> = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12",
  };

  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const datedMatch = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/
  );
  const undatedMatch = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2})/);
  const match = datedMatch ?? undatedMatch;
  const normalizedFallbackYear = fallbackYear?.match(/20\d{2}/)?.[0] ?? null;

  if (!match) return { calendar_starts_at: null, calendar_ends_at: null };

  const [, startMonthName, startDay, endMonthName, endDay] = match;
  const year = datedMatch?.[5] ?? normalizedFallbackYear;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[endMonthName.toLowerCase()];

  if (!year || !startMonth || !endMonth) return { calendar_starts_at: null, calendar_ends_at: null };

  const startDate = `${year}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${year}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    calendar_starts_at: `${startDate}T09:00:00+09:00`,
    calendar_ends_at: `${endDate}T17:30:00+09:00`,
  };
};

export const formatEventDate = (value: string | null) => {
  if (!value) return "";

  const decodedValue = decodeHtml(value);
  const isoLikeMatch = decodedValue.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoLikeMatch) {
    const [, year, month, day] = isoLikeMatch;
    return `${year}.${month}.${day}`;
  }

  const dottedMatch = decodedValue.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (dottedMatch) {
    const [, year, month, day] = dottedMatch;
    return `${year}.${month}.${day}`;
  }

  const japaneseMatch = decodedValue.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (japaneseMatch) {
    const [, year, month, day] = japaneseMatch;
    return `${year}.${month.padStart(2, "0")}.${day.padStart(2, "0")}`;
  }

  return decodedValue;
};

export const formatEventDateRange = (start: string | null, end: string | null, fallback: string) => {
  const formattedStart = formatEventDate(start ?? fallback);
  const formattedEnd = formatEventDate(end);

  if (!formattedStart) return fallback;
  if (!formattedEnd || formattedEnd === formattedStart) return formattedStart;

  return `${formattedStart} - ${formattedEnd}`;
};

export const mapsUrl = (event: CalendarEvent) => {
  const query = event.directions_query ?? event.address_text ?? event.venue_name ?? event.institution_name;
  if (/^https?:\/\//i.test(query)) return query;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const toGoogleCalendarStamp = (value: string) => value.replaceAll("-", "");

export const calendarDetailsFor = (event: CalendarEvent) =>
  event.description
    ? cleanDisplayText(event.description)
    : `${event.institution_name}${event.venue_name ? ` — ${event.venue_name}` : ""}`;

export const calendarLocationFor = (event: CalendarEvent) =>
  event.address_text ?? event.venue_name ?? event.institution_name;

export const googleCalendarUrl = (event: CalendarEvent) => {
  const start = normalizeDateOnly(event.calendar_starts_at);
  if (!start) return null;

  const end = normalizeDateOnly(event.calendar_ends_at);
  const exclusiveEnd = addDays(end ?? start, 1);

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${toGoogleCalendarStamp(start)}/${toGoogleCalendarStamp(exclusiveEnd)}&details=${encodeURIComponent(calendarDetailsFor(event))}&location=${encodeURIComponent(calendarLocationFor(event))}`;
};
