import {
  activeOrNextScheduleSegment,
  classifyEventTiming,
  inferCanonicalScheduleType,
  normalizeDateOnly,
} from '../../../../packages/shared/event-schedule.mjs';
import type { AppLocale } from './i18n';

const formatDateOnly = (
  value: string,
  locale: AppLocale,
  fields: { year?: boolean; month?: boolean; day?: boolean } = {
    year: true,
    month: true,
    day: true,
  },
) =>
  new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-GB', {
    timeZone: 'UTC',
    year: fields.year ? 'numeric' : undefined,
    month: fields.month ? 'short' : undefined,
    day: fields.day ? 'numeric' : undefined,
  }).format(new Date(`${value}T00:00:00Z`));

export const formatEventDateRange = (
  start: string | null,
  end: string | null,
  fallback: string,
  locale: AppLocale = 'en',
): string => {
  const startDate = normalizeDateOnly(start);
  const endDate = normalizeDateOnly(end);
  if (!startDate) return fallback;
  if (!endDate || endDate === startDate) return formatDateOnly(startDate, locale);

  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  const sameMonth = sameYear && startDate.slice(5, 7) === endDate.slice(5, 7);
  const startText = formatDateOnly(startDate, locale, {
    year: !sameYear,
    month: !sameMonth,
    day: true,
  });
  return `${startText} – ${formatDateOnly(endDate, locale)}`;
};

export const formatOngoingEventEnd = (
  end: string | null,
  fallback = 'ongoing',
  locale: AppLocale = 'en',
): string => {
  const endDate = normalizeDateOnly(end);
  if (!endDate) return fallback;
  if (locale === 'ja')
    return `開催中 — ${formatDateOnly(endDate, locale, { month: true, day: true })}`;
  const dayMonth = formatDateOnly(endDate, locale, { month: true, day: true });
  return `ONGOING — ${dayMonth.toUpperCase()} '${endDate.slice(2, 4)}`;
};

type EventDateSchedule = {
  start_date?: string | null;
  end_date?: string | null;
  calendar_starts_at?: string | null;
  calendar_ends_at?: string | null;
  is_all_day?: boolean | null;
  schedule_type?: string | null;
  schedule_segments?: unknown[] | null;
  occurrence_dates?: unknown[] | null;
};

export const formatEventScheduleDate = (
  event: EventDateSchedule,
  today: string,
  fallback: string,
  locale: AppLocale = 'en',
): string => {
  const selected = activeOrNextScheduleSegment(event, today);
  const start = selected?.is_all_day
    ? selected.start_date
    : (event.start_date ?? selected?.starts_at ?? event.calendar_starts_at);
  const end = selected?.is_all_day
    ? selected.end_date
    : (event.end_date ?? selected?.ends_at ?? event.calendar_ends_at);
  if (classifyEventTiming(event, today) === 'ongoing') {
    const ongoingEnd = selected?.is_all_day
      ? selected.end_date
      : (selected?.ends_at ?? event.calendar_ends_at ?? event.end_date);
    return formatOngoingEventEnd(
      ongoingEnd ?? null,
      locale === 'ja' ? '開催中' : 'ongoing',
      locale,
    );
  }
  if (inferCanonicalScheduleType(event) === 'open_ended') return fallback;
  // A split schedule still has verified dates. Raw publisher notes are not a card label.
  return formatEventDateRange(start ?? null, end ?? null, fallback, locale);
};
