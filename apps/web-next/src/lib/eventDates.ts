import { normalizeDateOnly } from '../../../../packages/shared/event-schedule.mjs';
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
