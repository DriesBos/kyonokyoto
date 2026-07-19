import {
  addMonthsDateOnly,
  eventEndDateOnly,
  inferCanonicalScheduleType,
} from '../../../../packages/shared/event-schedule.mjs';
import type { DisplayEvent } from './events';

export const groupDisplayEvents = (events: DisplayEvent[], today: string) => {
  const ongoingEvents: DisplayEvent[] = [];
  const upcomingEvents: DisplayEvent[] = [];
  const sourcePermanentEvents: DisplayEvent[] = [];
  const longRunningCutoff = addMonthsDateOnly(today, 12);

  for (const event of events) {
    if (event.timing === 'upcoming') {
      upcomingEvents.push(event);
      continue;
    }

    const scheduleType = inferCanonicalScheduleType(event);
    const endDate = scheduleType === 'range' ? eventEndDateOnly(event) : null;

    if (
      scheduleType === 'open_ended' ||
      (endDate && longRunningCutoff && endDate > longRunningCutoff)
    ) {
      sourcePermanentEvents.push(event);
    } else {
      ongoingEvents.push(event);
    }
  }

  return { ongoingEvents, upcomingEvents, sourcePermanentEvents };
};
