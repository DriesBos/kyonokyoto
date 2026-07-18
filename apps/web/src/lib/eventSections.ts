import { inferCanonicalScheduleType } from '../../../../packages/shared/event-schedule.mjs';
import type { DisplayEvent } from './events';

export const groupDisplayEvents = (events: DisplayEvent[]) => {
  const ongoingEvents: DisplayEvent[] = [];
  const upcomingEvents: DisplayEvent[] = [];
  const sourcePermanentEvents: DisplayEvent[] = [];

  for (const event of events) {
    if (event.timing === 'upcoming') upcomingEvents.push(event);
    else if (inferCanonicalScheduleType(event) === 'open_ended') sourcePermanentEvents.push(event);
    else ongoingEvents.push(event);
  }

  return { ongoingEvents, upcomingEvents, sourcePermanentEvents };
};
