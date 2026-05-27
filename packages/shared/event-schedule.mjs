const VALID_SCHEDULE_TYPES = new Set(["range", "occurrence_set", "unknown"]);

export function normalizeDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") return null;

  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeOccurrenceDates(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeDateOnly).filter(Boolean))].sort();
}

export function addMonthsDateOnly(dateOnly, months) {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized || !Number.isInteger(months)) return null;

  const [year, month, day] = normalized.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}

export function eventStartDateOnly(event) {
  const start = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  if (start) return start;

  return normalizeOccurrenceDates(event?.occurrence_dates)[0] ?? null;
}

export function isEventWithinDisplayWindow(event, todayDateOnly, { monthsAhead = 6 } = {}) {
  const start = eventStartDateOnly(event);
  const cutoff = addMonthsDateOnly(todayDateOnly, monthsAhead);

  if (!start || !cutoff) return true;
  return start <= cutoff;
}

export function inferScheduleType(event) {
  const explicitType =
    typeof event?.schedule_type === "string" && VALID_SCHEDULE_TYPES.has(event.schedule_type)
      ? event.schedule_type
      : null;

  if (explicitType && explicitType !== "unknown") return explicitType;

  const occurrenceDates = normalizeOccurrenceDates(event?.occurrence_dates);
  if (occurrenceDates.length > 0) return "occurrence_set";

  const start = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  const end = normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at);

  if (start && end && start !== end) return "range";
  if (start || end) return "occurrence_set";

  return explicitType ?? "unknown";
}

export function classifyEventTiming(event, todayDateOnly) {
  const today = normalizeDateOnly(todayDateOnly);
  const start = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  const end = normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at) ?? start;
  const occurrenceDates = normalizeOccurrenceDates(event?.occurrence_dates);
  const scheduleType = inferScheduleType(event);

  if (!today) return "ongoing";

  if (scheduleType === "range") {
    if (start && start > today) return "upcoming";
    if (end && end < today) return "past";
    if (start || end) return "ongoing";
  }

  if (scheduleType === "occurrence_set") {
    const dates = occurrenceDates.length > 0
      ? occurrenceDates
      : [start ?? end].filter(Boolean);

    if (dates.length === 0) return "ongoing";
    if (dates.some((date) => date === today)) return "ongoing";

    const nextDate = dates.find((date) => date > today);
    if (nextDate) return "upcoming";

    const latestDate = dates[dates.length - 1];
    if (latestDate && latestDate < today) return "past";

    return "ongoing";
  }

  if (start && start > today) return "upcoming";
  if (end && end < today) return "past";

  return "ongoing";
}

export function buildScheduleFields({ startDate = null, endDate = null, occurrenceDates = [] } = {}) {
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
      scheduleType === "occurrence_set"
        ? normalizedOccurrenceDates.length > 0
          ? normalizedOccurrenceDates
          : normalizedStartDate
            ? [normalizedStartDate]
            : []
        : [],
  };
}
