// Starred (favourite) events, kept per browser. Same key and update event as the old Astro site,
// so stars saved there come back, and GoogleMapCanvas (which listens for STARS_UPDATED_EVENT and
// reads card[data-starred]) shows star markers without changes.
export const STARRED_EVENTS_KEY = 'kyo_starred_events';
export const STARS_UPDATED_EVENT = 'event-stars:updated';

export function parseStarredIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((item): item is string => typeof item === 'string' && item !== ''),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

export function toggleStarredId(ids: readonly string[], eventId: string): string[] {
  return ids.includes(eventId) ? ids.filter((id) => id !== eventId) : [...ids, eventId];
}

// Cached so useSyncExternalStore gets a stable snapshot between changes.
let cachedRaw: string | null | undefined;
let cachedIds: string[] = [];

export function readStarredIds(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STARRED_EVENTS_KEY);
  } catch {}
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIds = parseStarredIds(raw);
  }
  return cachedIds;
}

export function writeStarredIds(ids: readonly string[]) {
  try {
    window.localStorage.setItem(STARRED_EVENTS_KEY, JSON.stringify(ids));
  } catch {}
  // Keep the in-memory copy current even when storage is blocked (private mode).
  cachedRaw = JSON.stringify(ids);
  cachedIds = [...ids];
  document.dispatchEvent(
    new CustomEvent(STARS_UPDATED_EVENT, { detail: { starredEventIds: [...ids] } }),
  );
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
