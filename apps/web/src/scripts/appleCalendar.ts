const toIcsDate = (value: string) => value.replaceAll('-', '');

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

export const initAppleCalendar = () => {
  if (window.__appleCalendarBound) return;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('[data-apple-calendar-button]');
    if (!(button instanceof HTMLElement)) return;

    event.preventDefault();

    const start = button.dataset.calendarStart;
    if (!start) return;

    const end = button.dataset.calendarEnd || start;
    const exclusiveEnd = addDays(end, 1);
    const title = escapeIcsText(button.dataset.calendarTitle);
    const details = escapeIcsText(button.dataset.calendarDetails);
    const location = escapeIcsText(button.dataset.calendarLocation);
    const uid = `${crypto.randomUUID()}@kyonokyoto`;
    const dtStamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kyo no Kyoto//Events//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(exclusiveEnd)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${details}`,
      `LOCATION:${location}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

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
