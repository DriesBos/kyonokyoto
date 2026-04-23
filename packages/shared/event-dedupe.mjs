import { normalizeDateOnly } from "./event-schedule.mjs";

const TIMESTAMP_FIELDS = ["updated_at", "last_seen_at", "created_at"];

function normalizeIdentityPart(value) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function canonicalizeEventUrl(value) {
  if (typeof value !== "string") return null;

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  try {
    const url = new URL(trimmedValue);
    const sortedSearchParams = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    });

    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.search = "";

    for (const [key, currentValue] of sortedSearchParams) {
      url.searchParams.append(key, currentValue);
    }

    return url.toString();
  } catch (error) {
    return trimmedValue.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function getEventHost(event) {
  const canonicalUrl = canonicalizeEventUrl(event?.source_url);
  if (canonicalUrl) {
    try {
      return new URL(canonicalUrl).hostname;
    } catch (error) {
      return canonicalUrl;
    }
  }

  return normalizeIdentityPart(event?.institution_name ?? event?.venue_name);
}

export function buildEventUrlIdentityKey(event) {
  const canonicalUrl = canonicalizeEventUrl(event?.source_url);
  return canonicalUrl ? `url:${canonicalUrl}` : null;
}

export function buildEventSemanticIdentityKey(event) {
  const title = normalizeIdentityPart(event?.title);
  if (!title) return null;

  const host = getEventHost(event) || "unknown-host";
  const startDate = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at) ?? "unknown-start";
  const endDate = normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at) ?? startDate;

  return `semantic:${host}|${title}|${startDate}|${endDate}`;
}

export function buildEventDedupeKey(event) {
  return buildEventUrlIdentityKey(event) ?? buildEventSemanticIdentityKey(event) ?? `title:${normalizeIdentityPart(event?.title) || "unknown-title"}`;
}

function getEventTimestamp(event) {
  for (const field of TIMESTAMP_FIELDS) {
    const value = typeof event?.[field] === "string" ? event[field] : null;
    const timestamp = value ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(timestamp)) return timestamp;
  }

  return 0;
}

function getTextLength(value) {
  return typeof value === "string" ? value.trim().length : 0;
}

function getArrayLength(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

export function scoreEventRecord(event) {
  let score = 0;

  score += getTextLength(event?.description) > 0 ? 40 : 0;
  score += getTextLength(event?.primary_image_url) > 0 ? 20 : 0;
  score += Math.min(getArrayLength(event?.image_urls), 4) * 3;
  score += Math.min(getArrayLength(event?.categories), 4) * 2;
  score += getTextLength(event?.artist_name) > 0 ? 8 : 0;
  score += getTextLength(event?.venue_name) > 0 ? 6 : 0;
  score += getTextLength(event?.address_text) > 0 ? 6 : 0;
  score += getTextLength(event?.date_text) > 0 ? 6 : 0;
  score += normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at) ? 12 : 0;
  score += normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at) ? 12 : 0;
  score += Math.min(getTextLength(event?.institution_name), 48) / 4;

  return score;
}

export function compareEventRecords(leftEvent, rightEvent) {
  const scoreDifference = scoreEventRecord(leftEvent) - scoreEventRecord(rightEvent);
  if (scoreDifference !== 0) return scoreDifference;

  return getEventTimestamp(leftEvent) - getEventTimestamp(rightEvent);
}

export function dedupeEvents(events) {
  const identityToGroup = new Map();
  const groups = [];

  for (const event of Array.isArray(events) ? events : []) {
    const identityKeys = [buildEventUrlIdentityKey(event), buildEventSemanticIdentityKey(event)].filter(Boolean);
    const matchedGroup = identityKeys.map((key) => identityToGroup.get(key)).find(Boolean);

    if (matchedGroup) {
      if (compareEventRecords(event, matchedGroup.preferredEvent) > 0) {
        matchedGroup.preferredEvent = event;
      }

      for (const key of identityKeys) {
        identityToGroup.set(key, matchedGroup);
      }

      continue;
    }

    const group = {
      preferredEvent: event,
    };

    groups.push(group);

    for (const key of identityKeys) {
      identityToGroup.set(key, group);
    }
  }

  return groups.map((group) => group.preferredEvent);
}
