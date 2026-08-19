import { eventDisplayGroup } from '../../../../packages/shared/event-schedule.mjs';
import type { DisplayEvent } from './events';

export const groupDisplayEvents = (events: DisplayEvent[], today: string) => {
  const ongoingEvents: DisplayEvent[] = [];
  const upcomingEvents: DisplayEvent[] = [];
  const sourcePermanentEvents: DisplayEvent[] = [];

  for (const event of events) {
    const group = eventDisplayGroup(event, today);
    if (group === 'upcoming') {
      upcomingEvents.push(event);
      continue;
    }

    if (group === 'permanent') {
      sourcePermanentEvents.push(event);
    } else {
      ongoingEvents.push(event);
    }
  }

  return { ongoingEvents, upcomingEvents, sourcePermanentEvents };
};
