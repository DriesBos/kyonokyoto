// Starred (favourite) events, kept per browser. Same key and update event as the old Astro site,
// so stars saved there come back, and GoogleMapCanvas (which listens for STARS_UPDATED_EVENT and
// reads card[data-starred]) shows star markers without changes.
//
// Storage v2: an array of { id, savedAt, endsAt|null } entries. The old format (an array of id
// strings) still reads. Entries whose event ended more than STAR_RETENTION_DAYS ago are dropped.
export const STARRED_EVENTS_KEY = 'kyo_starred_events';
export const STARS_UPDATED_EVENT = 'event-stars:updated';
export const STAR_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StarredEntry = { id: string; savedAt: string | null; endsAt: string | null };

const entryFrom = (item: unknown): StarredEntry | null => {
  if (typeof item === 'string') return item ? { id: item, savedAt: null, endsAt: null } : null;
  if (!item || typeof item !== 'object') return null;
  const { id, savedAt, endsAt } = item as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  return {
    id,
    savedAt: typeof savedAt === 'string' ? savedAt : null,
    endsAt: typeof endsAt === 'string' ? endsAt : null,
  };
};

const expired = (entry: StarredEntry, now: number) => {
  if (!entry.endsAt) return false;
  const ends = Date.parse(entry.endsAt);
  return Number.isFinite(ends) && ends < now - STAR_RETENTION_DAYS * DAY_MS;
};

export function parseStarredEntries(
  raw: string | null | undefined,
  now: number = Date.now(),
): StarredEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const entries: StarredEntry[] = [];
  for (const item of parsed) {
    const entry = entryFrom(item);
    if (!entry || seen.has(entry.id) || expired(entry, now)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export function parseStarredIds(raw: string | null | undefined, now?: number): string[] {
  return parseStarredEntries(raw, now).map((entry) => entry.id);
}

export function toggleStarredId(ids: readonly string[], eventId: string): string[] {
  return ids.includes(eventId) ? ids.filter((id) => id !== eventId) : [...ids, eventId];
}

export function toggleStarredEntry(
  entries: readonly StarredEntry[],
  eventId: string,
  endsAt: string | null,
  savedAt: string = new Date().toISOString(),
): StarredEntry[] {
  return entries.some((entry) => entry.id === eventId)
    ? entries.filter((entry) => entry.id !== eventId)
    : [...entries, { id: eventId, savedAt, endsAt }];
}

// Cached so useSyncExternalStore gets a stable snapshot between changes.
let cachedRaw: string | null | undefined;
let cachedEntries: StarredEntry[] = [];
let cachedIds: string[] = [];
let storageBlocked = false;

const readRaw = () => {
  try {
    return window.localStorage.getItem(STARRED_EVENTS_KEY);
  } catch {
    return null;
  }
};

function refreshCache() {
  const raw = readRaw();
  // Storage blocked (private mode): keep the in-memory copy from the last write.
  if (storageBlocked) return;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEntries = parseStarredEntries(raw);
    cachedIds = cachedEntries.map((entry) => entry.id);
  }
}

export function readStarredEntries(): StarredEntry[] {
  refreshCache();
  return cachedEntries;
}

export function readStarredIds(): string[] {
  refreshCache();
  return cachedIds;
}

export function writeStarredEntries(entries: readonly StarredEntry[]) {
  const raw = JSON.stringify(entries);
  try {
    window.localStorage.setItem(STARRED_EVENTS_KEY, raw);
  } catch {
    storageBlocked = true;
  }
  cachedRaw = raw;
  cachedEntries = [...entries];
  cachedIds = cachedEntries.map((entry) => entry.id);
  document.dispatchEvent(
    new CustomEvent(STARS_UPDATED_EVENT, { detail: { starredEventIds: [...cachedIds] } }),
  );
}

// Id-only writer kept for existing callers: known entries keep their dates, new ids get none.
export function writeStarredIds(ids: readonly string[]) {
  const known = new Map(readStarredEntries().map((entry) => [entry.id, entry]));
  writeStarredEntries(ids.map((id) => known.get(id) ?? { id, savedAt: null, endsAt: null }));
}

export function toggleStarredEvent(eventId: string, endsAt: string | null) {
  writeStarredEntries(toggleStarredEntry(readStarredEntries(), eventId, endsAt));
}

export function subscribeStarredIds(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STARRED_EVENTS_KEY) {
      onChange();
      document.dispatchEvent(new CustomEvent(STARS_UPDATED_EVENT));
    }
  };
  document.addEventListener(STARS_UPDATED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    document.removeEventListener(STARS_UPDATED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
