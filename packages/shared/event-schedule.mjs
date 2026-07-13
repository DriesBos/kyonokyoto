const VALID_SCHEDULE_TYPES = new Set([
  'single',
  'range',
  'occurrence_set',
  'open_ended',
  'unknown',
]);

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isValidTimestamp(value) {
  const match = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})T/) : null;
  return (
    match != null &&
    isValidDateOnly(match[1]) &&
    /T[\s\S]*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function timestampDateOnly(value, timeZone) {
  if (!isValidTimestamp(value) || !isValidTimeZone(timeZone)) return null;

  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value));
}

function rawScheduleSegments(event) {
  if (Array.isArray(event?.schedule_segments) && event.schedule_segments.length > 0) {
    return event.schedule_segments;
  }

  const occurrenceDates = normalizeOccurrenceDates(event?.occurrence_dates).filter(isValidDateOnly);
  if (occurrenceDates.length > 0) {
    return occurrenceDates.map((date) => ({
      is_all_day: true,
      start_date: date,
      end_date: date,
    }));
  }

  if (event?.is_all_day === false && event?.calendar_starts_at) {
    return [
      {
        is_all_day: false,
        starts_at: event.calendar_starts_at,
        ends_at: event?.schedule_type === 'open_ended' ? null : (event.calendar_ends_at ?? null),
        timezone: event.timezone ?? 'Asia/Tokyo',
      },
    ];
  }

  const startDate = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  if (!startDate) return [];

  return [
    {
      is_all_day: true,
      start_date: startDate,
      end_date:
        event?.schedule_type === 'open_ended'
          ? null
          : (normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at) ?? startDate),
    },
  ];
}

function scheduleSegmentErrors(segment) {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    return ['segment must be an object'];
  }

  const errors = [];
  if (segment.ordinal != null && (!Number.isInteger(segment.ordinal) || segment.ordinal < 0)) {
    errors.push('ordinal must be a non-negative integer');
  }
  if (segment.is_all_day === true) {
    if (!isValidDateOnly(segment.start_date)) errors.push('all-day start_date must be valid');
    if (segment.end_date != null && !isValidDateOnly(segment.end_date)) {
      errors.push('all-day end_date must be valid or null');
    }
    if (
      isValidDateOnly(segment.start_date) &&
      isValidDateOnly(segment.end_date) &&
      normalizeDateOnly(segment.end_date) < normalizeDateOnly(segment.start_date)
    ) {
      errors.push('all-day end_date must not precede start_date');
    }
    if (segment.starts_at != null || segment.ends_at != null) {
      errors.push('all-day segment must not contain timestamps');
    }
  } else if (segment.is_all_day === false) {
    if (!isValidTimestamp(segment.starts_at)) {
      errors.push('timed starts_at must be an offset timestamp');
    }
    if (segment.ends_at != null && !isValidTimestamp(segment.ends_at)) {
      errors.push('timed ends_at must be an offset timestamp or null');
    }
    if (
      isValidTimestamp(segment.starts_at) &&
      isValidTimestamp(segment.ends_at) &&
      Date.parse(segment.ends_at) < Date.parse(segment.starts_at)
    ) {
      errors.push('timed ends_at must not precede starts_at');
    }
    if (!isValidTimeZone(segment.timezone)) errors.push('timed timezone must be valid');
    if (segment.start_date != null || segment.end_date != null) {
      errors.push('timed segment must not contain date-only fields');
    }
  } else {
    errors.push('is_all_day must be boolean');
  }

  return errors;
}

function scheduleSegmentDateBounds(segment) {
  if (segment.is_all_day) {
    return {
      start: normalizeDateOnly(segment.start_date),
      end: normalizeDateOnly(segment.end_date),
    };
  }

  return {
    start: timestampDateOnly(segment.starts_at, segment.timezone),
    end: segment.ends_at ? timestampDateOnly(segment.ends_at, segment.timezone) : null,
  };
}

function inferScheduleTypeFromSegments(segments) {
  if (segments.length === 0) return 'unknown';
  if (segments.length > 1) return 'occurrence_set';

  const { start, end } = scheduleSegmentDateBounds(segments[0]);
  if (!end) return 'open_ended';
  return start === end ? 'single' : 'range';
}

export function normalizeDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string') return null;

  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeOccurrenceDates(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeDateOnly).filter(Boolean))].sort();
}

export function normalizeScheduleSegment(segment) {
  if (scheduleSegmentErrors(segment).length > 0) return null;

  const ordinal = Number.isInteger(segment.ordinal) ? { ordinal: segment.ordinal } : {};

  if (segment.is_all_day) {
    return {
      ...ordinal,
      is_all_day: true,
      start_date: normalizeDateOnly(segment.start_date),
      end_date: segment.end_date == null ? null : normalizeDateOnly(segment.end_date),
    };
  }

  return {
    ...ordinal,
    is_all_day: false,
    starts_at: new Date(segment.starts_at).toISOString(),
    ends_at: segment.ends_at == null ? null : new Date(segment.ends_at).toISOString(),
    timezone: segment.timezone,
  };
}

export function eventScheduleSegments(event) {
  return rawScheduleSegments(event).map(normalizeScheduleSegment).filter(Boolean);
}

export function inferCanonicalScheduleType(event) {
  if (Array.isArray(event?.schedule_segments) && event.schedule_segments.length > 0) {
    return inferScheduleTypeFromSegments(eventScheduleSegments(event));
  }

  const explicitType =
    typeof event?.schedule_type === 'string' && VALID_SCHEDULE_TYPES.has(event.schedule_type)
      ? event.schedule_type
      : null;
  if (explicitType && explicitType !== 'unknown') return explicitType;

  return inferScheduleTypeFromSegments(eventScheduleSegments(event));
}

export function validateScheduleSegments(event) {
  const source = rawScheduleSegments(event);
  const segmentErrors = source.flatMap((segment, index) =>
    scheduleSegmentErrors(segment).map((error) => `segment ${index}: ${error}`),
  );
  const segments = source.map(normalizeScheduleSegment).filter(Boolean);
  const scheduleType = inferCanonicalScheduleType({
    ...event,
    schedule_segments: segments,
  });
  const shapeErrors = [];

  if (
    event?.schedule_type != null &&
    (typeof event.schedule_type !== 'string' || !VALID_SCHEDULE_TYPES.has(event.schedule_type))
  ) {
    shapeErrors.push('schedule_type is not supported');
  }

  if (scheduleType === 'unknown' && segments.length > 0) {
    shapeErrors.push('unknown schedule must not contain segments');
  }
  if (scheduleType !== 'unknown' && segments.length === 0) {
    shapeErrors.push(`${scheduleType} schedule requires a segment`);
  }
  if (['single', 'range', 'open_ended'].includes(scheduleType) && segments.length !== 1) {
    shapeErrors.push(`${scheduleType} schedule requires exactly one segment`);
  }
  if (scheduleType === 'occurrence_set' && segments.length < 1) {
    shapeErrors.push('occurrence_set schedule requires at least one segment');
  }
  if (
    scheduleType === 'occurrence_set' &&
    segments.some((segment) => scheduleSegmentDateBounds(segment).end == null)
  ) {
    shapeErrors.push('occurrence_set segments require ends');
  }

  if (segments.length === 1) {
    const { start, end } = scheduleSegmentDateBounds(segments[0]);
    if (scheduleType === 'single' && start !== end) {
      shapeErrors.push('single schedule requires matching start and end dates');
    }
    if (scheduleType === 'range' && (!end || start === end)) {
      shapeErrors.push('range schedule requires distinct start and end dates');
    }
    if (scheduleType === 'open_ended' && end != null) {
      shapeErrors.push('open_ended schedule must not have an end');
    }
    if (scheduleType !== 'open_ended' && end == null) {
      shapeErrors.push(`${scheduleType} schedule requires an end`);
    }
  }

  const errors = [...segmentErrors, ...shapeErrors];
  return {
    valid: errors.length === 0,
    errors,
    schedule_type: scheduleType,
    schedule_segments: segments,
  };
}

export function addMonthsDateOnly(dateOnly, months) {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized || !Number.isInteger(months)) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth + 1).padStart(2, '0'),
    String(targetDay).padStart(2, '0'),
  ].join('-');
}

export function eventStartDateOnly(event) {
  const starts = eventScheduleSegments(event)
    .map((segment) => scheduleSegmentDateBounds(segment).start)
    .filter(Boolean)
    .sort();
  if (starts.length > 0) return starts[0];

  return null;
}

export function nextRelevantScheduleStartDateOnly(event, todayDateOnly) {
  const today = normalizeDateOnly(todayDateOnly);
  if (!isValidDateOnly(today)) return null;

  const segment = activeOrNextScheduleSegment(event, today);
  if (!segment) return null;

  const { start, end } = scheduleSegmentDateBounds(segment);
  return start <= today && (end == null || end >= today) ? today : start;
}

export function activeOrNextScheduleSegment(event, todayDateOnly) {
  const today = normalizeDateOnly(todayDateOnly);
  if (!isValidDateOnly(today)) return null;

  const segments = eventScheduleSegments(event)
    .map((segment, index) => ({
      segment,
      index,
      ...scheduleSegmentDateBounds(segment),
    }))
    .sort(
      (left, right) =>
        left.start.localeCompare(right.start) ||
        (left.segment.ordinal ?? left.index) - (right.segment.ordinal ?? right.index),
    );
  const active = segments.find(({ start, end }) => start <= today && (end == null || end >= today));
  if (active) return active.segment;

  return segments.find(({ start }) => start > today)?.segment ?? null;
}

export function isEventWithinDisplayWindow(event, todayDateOnly, { monthsAhead = 6 } = {}) {
  const start = nextRelevantScheduleStartDateOnly(event, todayDateOnly);
  const cutoff = addMonthsDateOnly(todayDateOnly, monthsAhead);

  if (!start) return false;
  if (!cutoff) return true;
  return start <= cutoff;
}

export function inferScheduleType(event) {
  const explicitType =
    typeof event?.schedule_type === 'string' && VALID_SCHEDULE_TYPES.has(event.schedule_type)
      ? event.schedule_type
      : null;

  if (explicitType && explicitType !== 'unknown') return explicitType;

  if (Array.isArray(event?.schedule_segments) && event.schedule_segments.length > 0) {
    return inferScheduleTypeFromSegments(eventScheduleSegments(event));
  }

  const occurrenceDates = normalizeOccurrenceDates(event?.occurrence_dates);
  if (occurrenceDates.length > 0) return 'occurrence_set';

  const start = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  const end = normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at);

  if (start && end && start !== end) return 'range';
  if (start || end) return 'occurrence_set';

  return explicitType ?? 'unknown';
}

export function classifyEventTiming(event, todayDateOnly) {
  const today = normalizeDateOnly(todayDateOnly);
  if (!isValidDateOnly(today)) return 'unknown';

  const bounds = eventScheduleSegments(event).map(scheduleSegmentDateBounds);
  if (bounds.length === 0) return 'unknown';

  if (bounds.some(({ start, end }) => start <= today && (end == null || end >= today))) {
    return 'ongoing';
  }
  if (bounds.some(({ start }) => start > today)) return 'upcoming';
  if (bounds.every(({ end }) => end != null && end < today)) return 'past';

  return 'unknown';
}

export function buildScheduleFields({
  startDate = null,
  endDate = null,
  occurrenceDates = [],
} = {}) {
  const normalizedStartDate = normalizeDateOnly(startDate);
  const normalizedEndDate = normalizeDateOnly(endDate) ?? normalizedStartDate;
  const normalizedOccurrenceDates = normalizeOccurrenceDates(occurrenceDates);

  const scheduleType = inferScheduleType({
    start_date: normalizedStartDate,
    end_date: normalizedEndDate,
    occurrence_dates: normalizedOccurrenceDates,
  });

  return {
    schedule_type: scheduleType,
    occurrence_dates:
      scheduleType === 'occurrence_set'
        ? normalizedOccurrenceDates.length > 0
          ? normalizedOccurrenceDates
          : normalizedStartDate
            ? [normalizedStartDate]
            : []
        : [],
  };
}
