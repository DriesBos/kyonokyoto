import { validateScheduleSegments } from '../../../packages/shared/event-schedule.mjs';

export function buildScheduleSegmentRows(eventId, event) {
  if (!eventId) throw new Error('event schedule segments require an event id');

  const schedule = validateScheduleSegments(event);
  if (!schedule.valid) {
    throw new Error(`invalid event schedule: ${schedule.errors.join('; ')}`);
  }
  if (!schedule.schedule_segments.length) {
    throw new Error('published event schedule requires at least one segment');
  }

  return schedule.schedule_segments.map((segment, ordinal) => ({
    event_id: eventId,
    ordinal,
    is_all_day: segment.is_all_day,
    start_date: segment.is_all_day ? segment.start_date : null,
    end_date: segment.is_all_day ? segment.end_date : null,
    starts_at: segment.is_all_day ? null : segment.starts_at,
    ends_at: segment.is_all_day ? null : segment.ends_at,
    timezone: segment.timezone ?? event.timezone ?? 'Asia/Tokyo',
  }));
}

export async function upsertEventScheduleSegments({ env, eventId, event, request }) {
  const rows = buildScheduleSegmentRows(eventId, event);

  await request({
    env,
    path: 'event_schedule_segments?on_conflict=event_id,ordinal',
    method: 'POST',
    body: rows,
  });
  await request({
    env,
    path: `event_schedule_segments?event_id=eq.${encodeURIComponent(
      eventId,
    )}&ordinal=gte.${rows.length}`,
    method: 'DELETE',
  });

  return rows;
}
