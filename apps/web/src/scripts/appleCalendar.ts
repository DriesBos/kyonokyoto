const toIcsDate = (value: string) => value.replaceAll('-', '');

const toIcsTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
};

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const escapeIcsText = (value: unknown) =>
  String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');

type AppleCalendarEvent = {
  title: string;
  details?: string;
  location?: string;
  start: string;
  end: string;
  isAllDay: boolean;
  uid?: string;
  dtStamp?: string;
};

export const buildAppleCalendarIcs = ({
  title,
  details,
  location,
  start,
  end,
  isAllDay,
  uid = `${crypto.randomUUID()}@kyonokyoto`,
  dtStamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z'),
}: AppleCalendarEvent) => {
  if (!start || !end) return null;

  let dateLines: string[];
  if (isAllDay) {
    const exclusiveEnd = addDays(end, 1);
    dateLines = [
      `DTSTART;VALUE=DATE:${toIcsDate(start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(exclusiveEnd)}`,
    ];
  } else {
    const utcStart = toIcsTimestamp(start);
    const utcEnd = toIcsTimestamp(end);
    if (!utcStart || !utcEnd) return null;
    dateLines = [`DTSTART:${utcStart}`, `DTEND:${utcEnd}`];
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kyo no Kyoto//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    ...dateLines,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(details)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

export const initAppleCalendar = () => {
  if (window.__appleCalendarBound) return;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('[data-apple-calendar-button]');
    if (!(button instanceof HTMLElement)) return;

    event.preventDefault();

    const start = button.dataset.calendarStart;
    const end = button.dataset.calendarEnd;
    if (!start || !end) return;

    const ics = buildAppleCalendarIcs({
      title: button.dataset.calendarTitle ?? 'event',
      details: button.dataset.calendarDetails,
      location: button.dataset.calendarLocation,
      start,
      end,
      isAllDay: button.dataset.calendarAllDay === 'true',
    });
    if (!ics) return;

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${(button.dataset.calendarTitle || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  window.__appleCalendarBound = true;
};
