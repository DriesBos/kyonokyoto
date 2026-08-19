export type AppleCalendarEvent = {
  title: string;
  details: string;
  location: string;
  start: string;
  end: string;
  isAllDay: boolean;
};

const addDays = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const escapeIcsText = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
};

export const buildAppleCalendarIcs = (
  event: AppleCalendarEvent,
  uid = `${crypto.randomUUID()}@kyonokyoto`,
  dtStamp = timestamp(new Date().toISOString())!,
) => {
  if (!event.start || !event.end) return null;
  const dateLines = event.isAllDay
    ? [
        `DTSTART;VALUE=DATE:${event.start.replaceAll('-', '')}`,
        `DTEND;VALUE=DATE:${addDays(event.end).replaceAll('-', '')}`,
      ]
    : (() => {
        const start = timestamp(event.start);
        const end = timestamp(event.end);
        return start && end ? [`DTSTART:${start}`, `DTEND:${end}`] : null;
      })();
  if (!dateLines) return null;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kyo no Kyoto//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    ...dateLines,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.details)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};
